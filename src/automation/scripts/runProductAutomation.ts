import 'dotenv/config';
import { prisma } from '../../lib/prisma';
import { runProductAutomation } from '../../lib/automation/orchestrator';
import { automationConfig } from '../../lib/automation/config';

async function main() {
  const args = process.argv.slice(2);
  const maxProducts = args.includes('--max')
    ? parseInt(args[args.indexOf('--max') + 1] ?? '100', 10)
    : automationConfig.maxPerRun;
  const force = args.includes('--force');

  console.log(`[ProductAutomation] Starting run (max=${maxProducts}, force=${force})`);

  try {
    const metrics = await runProductAutomation({
      maxProducts,
      skipEmbedded: !force,
    });

    console.log('\n=== AUTOMATION RUN SUMMARY ===');
    console.log(`Total tasks:      ${metrics.totalTasks}`);
    console.log(`Success:          ${metrics.successCount}`);
    console.log(`Failed:           ${metrics.failureCount}`);
    console.log(`Avg duration:     ${Math.round(metrics.averageDuration)}ms`);
    if (metrics.errors.length > 0) {
      console.log(`\nFirst errors:`);
      metrics.errors.slice(0, 5).forEach(e => console.log(`  - ${e}`));
    }

    process.exit(metrics.failureCount > 0 && metrics.successCount === 0 ? 1 : 0);
  } catch (err) {
    console.error('[ProductAutomation] Fatal error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
