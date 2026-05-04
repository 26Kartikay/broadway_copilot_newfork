import 'dotenv/config';
import { prisma } from '../../lib/prisma';
import { runProductAutomation } from '../../lib/automation/orchestrator';

async function main() {
  console.log('[RetryFailed] Marking failed products as pending for retry...');

  const maxRetries = parseInt(process.env.PRODUCT_AUTOMATION_RETRY_ATTEMPTS ?? '3', 10);

  const failures = await prisma.automationFailure.findMany({
    where: { retryCount: { lt: maxRetries } },
    select: { productId: true },
  });

  if (failures.length === 0) {
    console.log('[RetryFailed] No products to retry.');
    process.exit(0);
  }

  const productIds = [...new Set(failures.map((f: { productId: string }) => f.productId))];

  await prisma.$executeRawUnsafe(
    `UPDATE "Product" SET "embeddingStatus" = 'pending' WHERE id = ANY($1::text[])`,
    productIds,
  );

  console.log(`[RetryFailed] Reset ${productIds.length} products to pending. Running automation...`);

  try {
    const metrics = await runProductAutomation({ maxProducts: productIds.length, skipEmbedded: false });

    console.log('\n=== RETRY SUMMARY ===');
    console.log(`Success: ${metrics.successCount}`);
    console.log(`Failed:  ${metrics.failureCount}`);

    process.exit(metrics.failureCount > 0 && metrics.successCount === 0 ? 1 : 0);
  } catch (err) {
    console.error('[RetryFailed] Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
