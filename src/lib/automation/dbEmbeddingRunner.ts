import { logger } from '../../utils/logger';
import { prisma } from '../prisma';
import { automationConfig } from './config';
import { BatchProcessor, markProductFailed } from './batchProcessor';
import { buildSearchDoc, generateEmbeddingWithRetry } from './embeddingGenerator';
import { getAutomationProductQueue } from './orchestrator';
import { prismaProductToBroadwayShape, prismaProductToExtractedTags } from './productDbAdapters';
import type { AutomationMetrics } from './types';
import type { ProcessableProduct, ProductProcessResult } from './types';
import { runWithConcurrencyStream } from './workerPool';
import { createId } from '@paralleldrive/cuid2';

async function processOneProductDbOnly(
  product: ProcessableProduct,
  timeoutMs: number,
): Promise<ProductProcessResult> {
  const start = Date.now();
  const barcode = product.barcode ?? '';

  try {
    const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error('Product processing timeout')), timeoutMs),
        ),
      ]);

    const full = await withTimeout(
      prisma.product.findUniqueOrThrow({
        where: { id: product.id },
      }),
    );

    const tags = prismaProductToExtractedTags(full);
    const apiProduct = prismaProductToBroadwayShape(full);
    const searchDoc = buildSearchDoc(apiProduct, tags);
    const embedding = await withTimeout(
      generateEmbeddingWithRetry(searchDoc, automationConfig.retryAttempts),
    );

    return {
      productId: product.id,
      barcode,
      success: true,
      durationMs: Date.now() - start,
      tags,
      embedding,
      searchDoc,
    };
  } catch (err) {
    return {
      productId: product.id,
      barcode,
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Tag + embed pipeline using only DB + OpenAI embeddings (no Broadway HTTP fetch).
 * Expects Product rows to already carry names, tags, and descriptions from CSV / mapping.
 */
export async function runDbOnlyEmbeddingPipeline(options?: {
  maxProducts?: number;
  concurrency?: number;
  batchSize?: number;
  skipEmbedded?: boolean;
}): Promise<AutomationMetrics> {
  const maxProducts = options?.maxProducts ?? automationConfig.maxPerRun;
  const concurrency = options?.concurrency ?? automationConfig.concurrency;
  const batchSize = options?.batchSize ?? automationConfig.batchSize;
  const skipEmbedded = options?.skipEmbedded ?? automationConfig.skipEmbedded;

  const runId = createId();
  const startTime = new Date();

  const run = await prisma.automationRun.create({
    data: { id: runId, name: 'ProductTaggerDbOnly', startTime, status: 'running' },
  });

  logger.info(
    { runId, maxProducts, concurrency, batchSize, skipEmbedded },
    '[Automation] Starting DB-only embedding run (no Broadway API)',
  );

  const products = await getAutomationProductQueue(maxProducts, skipEmbedded);

  if (products.length === 0) {
    logger.info('[Automation] No products to process (DB-only)');
    await prisma.automationRun.update({
      where: { id: run.id },
      data: { status: 'completed', endTime: new Date(), totalTasks: 0 },
    });
    return {
      totalTasks: 0,
      successCount: 0,
      failureCount: 0,
      averageDuration: 0,
      errors: [],
      startTime,
      endTime: new Date(),
    };
  }

  const processor = new BatchProcessor(batchSize);
  const metrics: AutomationMetrics = {
    totalTasks: products.length,
    successCount: 0,
    failureCount: 0,
    averageDuration: 0,
    errors: [],
    startTime,
  };
  let totalDuration = 0;

  const tasks = products.map((p) => () =>
    processOneProductDbOnly(p, automationConfig.timeoutMs),
  );

  await runWithConcurrencyStream(tasks, concurrency, async (result) => {
    totalDuration += result.durationMs;

    if (result.success && result.tags && result.embedding && result.searchDoc) {
      await processor.add({
        productId: result.productId,
        barcode: result.barcode,
        tags: result.tags,
        embedding: result.embedding,
        searchDoc: result.searchDoc,
      });
      metrics.successCount++;
    } else {
      metrics.failureCount++;
      const errMsg = result.error ?? 'Unknown error';
      metrics.errors.push(`${result.barcode}: ${errMsg}`);
      await markProductFailed(result.productId, result.barcode, errMsg, runId).catch(() => {});
    }
  });

  await processor.flush();

  metrics.endTime = new Date();
  metrics.averageDuration = products.length > 0 ? totalDuration / products.length : 0;

  const processorStats = processor.stats;

  await prisma.automationRun.update({
    where: { id: run.id },
    data: {
      status: 'completed',
      endTime: metrics.endTime,
      totalTasks: metrics.totalTasks,
      successCount: metrics.successCount,
      failureCount: metrics.failureCount,
      averageDuration: metrics.averageDuration,
      errors: metrics.errors.slice(0, 100),
      metrics: {
        mode: 'db_only',
        processorFlushed: processorStats.flushed,
        processorErrors: processorStats.errors,
        durationMs: metrics.endTime.getTime() - startTime.getTime(),
      },
    },
  });

  logger.info(
    {
      runId,
      totalTasks: metrics.totalTasks,
      success: metrics.successCount,
      failed: metrics.failureCount,
    },
    '[Automation] DB-only run complete',
  );

  return metrics;
}
