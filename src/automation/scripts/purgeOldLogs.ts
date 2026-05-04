import 'dotenv/config';
import { prisma } from '../../lib/prisma';
import { purgeDbLogsOlderThanDays } from '../../lib/logRetention';
import { cronConfig } from '../../lib/automation/config';

function parseDays(argv: string[]): number {
  const i = argv.indexOf('--days');
  if (i >= 0) {
    const raw = argv[i + 1];
    if (raw) {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n)) return n;
    }
  }
  return cronConfig.logRetentionDays;
}

async function main() {
  const days = parseDays(process.argv.slice(2));
  console.log(`[PurgeOldLogs] Removing ServiceLog + ApiRequestLog older than ${days} days…`);

  const result = await purgeDbLogsOlderThanDays(days);
  console.log(
    `[PurgeOldLogs] Deleted ServiceLog=${result.serviceLogDeleted}, ApiRequestLog=${result.apiRequestLogDeleted} (cutoff ${result.cutoff.toISOString()})`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('[PurgeOldLogs] Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
