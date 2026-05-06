/**
 * Print how many active products still need embeddings (matches DB-only embedding queue when skipEmbedded=true).
 *
 * Usage:
 *   npx ts-node --transpile-only src/automation/scripts/countPendingEmbeddingProducts.ts
 *   npx ts-node --transpile-only src/automation/scripts/countPendingEmbeddingProducts.ts -- --include-failed
 */

import 'dotenv/config';
import { prisma } from '../../lib/prisma';

async function main(): Promise<void> {
  const includeFailed = process.argv.includes('--include-failed');

  const pending = await prisma.product.count({
    where: {
      isActive: true,
      barcode: { not: null },
      embeddingStatus: 'pending',
    },
  });

  const failed = includeFailed
    ? await prisma.product.count({
        where: {
          isActive: true,
          barcode: { not: null },
          embeddingStatus: 'failed',
        },
      })
    : 0;

  const pendingOrFailed = includeFailed ? pending + failed : pending;

  console.log(
    JSON.stringify(
      {
        pendingEmbedding: pending,
        ...(includeFailed ? { failedEmbedding: failed, wouldProcessPendingOrFailed: pendingOrFailed } : {}),
        note: includeFailed
          ? 'Embed with skipEmbedded=false to include failed rows.'
          : 'Default embed job (skipEmbedded=true) processes pendingEmbedding only, up to --max.',
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
