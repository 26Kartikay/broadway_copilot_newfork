import { logger } from '../../utils/logger';
import { prisma } from '../prisma';
import { EMBEDDING_MODEL, EMBEDDING_DIM } from './embeddingGenerator';
import type { BatchItem } from './types';

export class BatchProcessor {
  private buffer: BatchItem[] = [];
  private readonly batchSize: number;
  private flushedCount = 0;
  private errorCount = 0;

  constructor(batchSize: number) {
    this.batchSize = batchSize;
  }

  add(item: BatchItem): Promise<void> {
    this.buffer.push(item);
    if (this.buffer.length >= this.batchSize) {
      return this.flush();
    }
    return Promise.resolve();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0, this.buffer.length);
    logger.info({ count: batch.length }, '[Automation] Flushing batch to database');

    for (const item of batch) {
      try {
        await commitProduct(item);
        this.flushedCount++;
      } catch (err) {
        this.errorCount++;
        logger.error(
          {
            err: err instanceof Error ? err.message : String(err),
            productId: item.productId,
            barcode: item.barcode,
          },
          '[Automation] Failed to commit product to DB',
        );
      }
    }
  }

  get stats() {
    return { flushed: this.flushedCount, errors: this.errorCount, pending: this.buffer.length };
  }
}

async function commitProduct(item: BatchItem): Promise<void> {
  const now = new Date();
  const vectorStr = `[${item.embedding.join(',')}]`;

  const componentTagsUpdate: Record<string, unknown> = {
    subCategory: item.tags.subCategory,
    productType: item.tags.productType,
    gender: item.tags.gender,
    ageGroup: item.tags.ageGroup,
    colorPalette: null,
    allTags: item.tags.allTags,
    occasions: item.tags.occasions,
    style: item.tags.style,
    fit: item.tags.fit,
    colors: item.tags.colors,
    shortDescription: item.tags.shortDescription,
    formattedDescription: item.tags.formattedDescription,
  };

  await prisma.$executeRawUnsafe(
    `UPDATE "Product"
     SET
       "searchDoc"       = $1,
       "embedding"       = $2::vector,
       "embeddingModel"  = $3,
       "embeddingDim"    = $4,
       "embeddingAt"     = $5::timestamptz,
       "legacyCategory"  = $6,
       "subCategory"     = $7,
       "productType"     = $8,
       "allTags"         = $9,
       "llmDescription"  = $10,
       "taggedBy"        = 'automation',
       "taggedAt"        = $11::timestamptz,
       "embeddingStatus" = 'completed',
       "automationErrors" = ARRAY[]::text[],
       "componentTags"   = $12::jsonb,
       "updatedAt"       = $13::timestamptz
     WHERE id = $14`,
    item.searchDoc,
    vectorStr,
    EMBEDDING_MODEL,
    EMBEDDING_DIM,
    now,
    item.tags.legacyCategory,
    item.tags.subCategory,
    item.tags.productType,
    item.tags.allTags,
    item.tags.formattedDescription,
    now,
    JSON.stringify(componentTagsUpdate),
    now,
    item.productId,
  );
}

export async function markProductFailed(
  productId: string,
  barcode: string,
  reason: string,
  runId: string,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "Product"
     SET "embeddingStatus" = 'failed',
         "automationErrors" = array_append("automationErrors", $1::text),
         "updatedAt" = $2::timestamptz
     WHERE id = $3`,
    reason,
    new Date(),
    productId,
  );

  await prisma.automationFailure
    .upsert({
      where: { productId_runId: { productId, runId } },
      create: { productId, barcode, reason, runId },
      update: { reason, retryCount: { increment: 1 }, lastRetried: new Date() },
    })
    .catch(() => {
      /* ignore duplicate failures */
    });
}
