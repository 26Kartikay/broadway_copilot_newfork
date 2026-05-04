import { logger } from '../../utils/logger';
import { prisma } from '../prisma';
import { automationConfig } from './config';
import { BatchProcessor, markProductFailed } from './batchProcessor';
import { buildSearchDoc, generateEmbeddingWithRetry } from './embeddingGenerator';
import { fetchProductByBarcode } from './productFetcher';
import { extractTagsFromProduct } from './tagExtractor';
import type { AutomationMetrics, ProcessableProduct, ProductProcessResult } from './types';
import { runWithConcurrencyStream } from './workerPool';
import { createId } from '@paralleldrive/cuid2';

export async function getAutomationProductQueue(
  limit: number,
  skipEmbedded: boolean,
): Promise<ProcessableProduct[]> {
  const whereClause = skipEmbedded
    ? `WHERE "barcode" IS NOT NULL AND "isActive" = true AND "embeddingStatus" = 'pending'`
    : `WHERE "barcode" IS NOT NULL AND "isActive" = true AND "embeddingStatus" IN ('pending', 'failed')`;

  return prisma.$queryRawUnsafe<ProcessableProduct[]>(
    `SELECT id, barcode, name, brand, category::text AS category, "embeddingStatus"
     FROM "Product"
     ${whereClause}
     ORDER BY "createdAt" DESC
     LIMIT $1`,
    limit,
  );
}

async function processOneProduct(
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

    const apiProduct = await withTimeout(fetchProductByBarcode(barcode, timeoutMs));

    const tags = await withTimeout(extractTagsFromProduct(apiProduct));
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

export async function runProductAutomation(options?: {
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
    data: { id: runId, name: 'ProductTagger', startTime, status: 'running' },
  });

  logger.info(
    { runId, maxProducts, concurrency, batchSize, skipEmbedded },
    '[Automation] Starting product automation run',
  );

  const products = await getAutomationProductQueue(maxProducts, skipEmbedded);

  if (products.length === 0) {
    logger.info('[Automation] No products to process');
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

  logger.info({ count: products.length }, '[Automation] Product queue loaded');

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

  const tasks = products.map(product => () =>
    processOneProduct(product, automationConfig.timeoutMs),
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

      logger.debug(
        { productId: result.productId, barcode: result.barcode, durationMs: result.durationMs },
        '[Automation] Product processed successfully',
      );
    } else {
      metrics.failureCount++;
      const errMsg = result.error ?? 'Unknown error';
      metrics.errors.push(`${result.barcode}: ${errMsg}`);

      await markProductFailed(result.productId, result.barcode, errMsg, runId).catch(() => {});

      logger.warn(
        { productId: result.productId, barcode: result.barcode, error: errMsg },
        '[Automation] Product processing failed',
      );
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
      avgDurationMs: Math.round(metrics.averageDuration),
    },
    '[Automation] Run complete',
  );

  return metrics;
}
