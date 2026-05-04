import 'dotenv/config';
import { prisma } from '../../lib/prisma';
import {
  getBarcodeSyncCounts,
  getEmbeddingStatusCounts,
  getPendingRetryFailures,
  getRecentRuns,
} from '../services/automationMetrics';

async function monitor() {
  console.log('=== AUTOMATION MONITOR ===\n');

  const [taggerRuns, syncRuns, embeddingCounts, barcodeCounts, pendingRetries] = await Promise.all([
    getRecentRuns('ProductTagger', 5),
    getRecentRuns('BarcodeSync', 5),
    getEmbeddingStatusCounts(),
    getBarcodeSyncCounts(),
    getPendingRetryFailures(),
  ]);

  console.log('--- Product Embedding Status ---');
  for (const [status, count] of Object.entries(embeddingCounts)) {
    console.log(`  ${status.padEnd(12)}: ${count}`);
  }

  console.log('\n--- Barcode Sync Status ---');
  for (const [status, count] of Object.entries(barcodeCounts)) {
    console.log(`  ${status.padEnd(12)}: ${count}`);
  }
  console.log(`  Pending retries: ${pendingRetries}`);

  console.log('\n--- Recent ProductTagger Runs ---');
  if (taggerRuns.length === 0) {
    console.log('  No runs found.');
  }
  for (const run of taggerRuns) {
    console.log(
      `  [${run.status.toUpperCase().padEnd(9)}] ${run.startTime.toISOString().slice(0, 16)}` +
        ` | ${run.successCount}/${run.totalTasks} ok (${run.successRatePct}%)` +
        ` | ${run.durationSeconds ?? '?'}s`,
    );
  }

  console.log('\n--- Recent BarcodeSync Runs ---');
  if (syncRuns.length === 0) {
    console.log('  No runs found.');
  }
  for (const run of syncRuns) {
    console.log(
      `  [${run.status.toUpperCase().padEnd(9)}] ${run.startTime.toISOString().slice(0, 16)}` +
        ` | ${run.successCount}/${run.totalTasks} ok` +
        ` | ${run.durationSeconds ?? '?'}s`,
    );
  }

  console.log('');
}

monitor()
  .finally(() => prisma.$disconnect())
  .catch(err => {
    console.error('Monitor error:', err);
    process.exit(1);
  });
