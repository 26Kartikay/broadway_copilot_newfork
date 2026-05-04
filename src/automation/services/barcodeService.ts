import 'dotenv/config';
import { logger } from '../../utils/logger';
import { prisma } from '../../lib/prisma';
import { fetchAllBarcodes } from '../../lib/automation/barcodeFetcher';
import type { BarcodeSyncResult } from '../../lib/automation/types';
import { createId } from '@paralleldrive/cuid2';

/** Links rows in AvailableBarcode to Product when barcode matches. Returns count linked. */
export async function linkAvailableBarcodesToProducts(): Promise<number> {
  // Single JOIN UPDATE — avoids O(n) queries when many pending rows exist.
  const updated = await prisma.$executeRawUnsafe(
    `WITH picked AS (
       SELECT DISTINCT ON ("barcode") id, "barcode"
       FROM "Product"
       WHERE "barcode" IS NOT NULL
       ORDER BY "barcode", "createdAt" DESC
     )
     UPDATE "AvailableBarcode" AS ab
     SET "productId" = picked.id,
         status = 'processed',
         "processedAt" = NOW()
     FROM picked
     WHERE ab."productId" IS NULL
       AND ab.status = 'pending'
       AND ab.barcode = picked."barcode"`,
  );
  return typeof updated === 'bigint' ? Number(updated) : Number(updated);
}

export async function syncBarcodes(): Promise<BarcodeSyncResult> {
  const startTime = Date.now();
  const runId = createId();
  let newBarcodes = 0;
  let updatedBarcodes = 0;
  let linkedProducts = 0;
  let errors = 0;

  const run = await prisma.automationRun.create({
    data: {
      id: runId,
      name: 'BarcodeSync',
      startTime: new Date(),
      status: 'running',
    },
  });

  logger.info({ runId }, '[BarcodeSync] Starting barcode synchronization');

  try {
    const barcodes = await fetchAllBarcodes((fetched, total) => {
      if (fetched % 500 === 0) {
        logger.info({ fetched, total }, '[BarcodeSync] Fetch progress');
      }
    });

    if (barcodes.length === 0) {
      logger.warn('[BarcodeSync] No barcodes fetched from Broadway API');
    }

    // Upsert barcodes in batches of 500
    const BATCH = 500;
    for (let i = 0; i < barcodes.length; i += BATCH) {
      const chunk = barcodes.slice(i, i + BATCH);

      for (const item of chunk) {
        if (!item.barcode) continue;
        try {
          const existing = await prisma.availableBarcode.findUnique({
            where: { barcode: item.barcode },
          });

          if (existing) {
            await prisma.availableBarcode.update({
              where: { barcode: item.barcode },
              data: {
                externalId: item.id,
                name: item.name,
                brand: item.brand ?? null,
                category: item.category ?? null,
                lastChecked: new Date(),
                status: 'pending',
              },
            });
            updatedBarcodes++;
          } else {
            await prisma.availableBarcode.create({
              data: {
                barcode: item.barcode,
                externalId: item.id,
                name: item.name,
                brand: item.brand ?? null,
                category: item.category ?? null,
                status: 'pending',
              },
            });
            newBarcodes++;
          }
        } catch (err) {
          errors++;
          logger.error(
            { err: err instanceof Error ? err.message : String(err), barcode: item.barcode },
            '[BarcodeSync] Failed to upsert barcode',
          );
        }
      }

      logger.info({ processed: Math.min(i + BATCH, barcodes.length), total: barcodes.length }, '[BarcodeSync] DB upsert progress');
    }

    linkedProducts = await linkAvailableBarcodesToProducts();

    const totalFetched = barcodes.length;
    const durationMs = Date.now() - startTime;

    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: 'completed',
        endTime: new Date(),
        totalTasks: totalFetched,
        successCount: newBarcodes + updatedBarcodes,
        failureCount: errors,
        averageDuration: totalFetched > 0 ? durationMs / totalFetched : 0,
        metrics: { newBarcodes, updatedBarcodes, linkedProducts, errors, durationMs },
      },
    });

    logger.info(
      { totalFetched, newBarcodes, updatedBarcodes, linkedProducts, errors, durationMs },
      '[BarcodeSync] Synchronization complete',
    );

    return { totalFetched, newBarcodes, updatedBarcodes, linkedProducts, errors, durationMs };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errorMsg }, '[BarcodeSync] Fatal error during sync');

    await prisma.automationRun.update({
      where: { id: run.id },
      data: { status: 'failed', endTime: new Date(), errors: [errorMsg] },
    });

    throw err;
  }
}
