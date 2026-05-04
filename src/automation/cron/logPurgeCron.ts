import 'dotenv/config';
import { logger } from '../../utils/logger';
import { prisma } from '../../lib/prisma';
import { purgeDbLogsOlderThanDays } from '../../lib/logRetention';
import { getLogPurgeSchedule, getLogRetentionDays, isLogPurgeEnabled } from './cronSchedules';
import { cronConfig } from '../../lib/automation/config';

function nextRunMs(cronExpr: string): number {
  const parts = cronExpr.split(' ');
  const minute = parseInt(parts[0] ?? '0', 10);
  const hour = parseInt(parts[1] ?? '3', 10);

  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(minute);
  next.setHours(hour);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

async function runOnce() {
  const days = getLogRetentionDays();
  logger.info(
    { days, schedule: getLogPurgeSchedule() },
    '[LogPurgeCron] Deleting DB logs older than retention window',
  );
  try {
    const result = await purgeDbLogsOlderThanDays(days);
    logger.info(
      {
        serviceLogDeleted: result.serviceLogDeleted,
        apiRequestLogDeleted: result.apiRequestLogDeleted,
        cutoff: result.cutoff.toISOString(),
        retainDays: days,
      },
      '[LogPurgeCron] Purge complete',
    );
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[LogPurgeCron] Purge failed',
    );
  }
}

async function scheduledLoop() {
  if (!isLogPurgeEnabled()) {
    logger.info('[LogPurgeCron] Disabled via CRON_LOG_PURGE_ENABLED. Exiting.');
    process.exit(0);
  }

  const schedule = getLogPurgeSchedule();
  logger.info(
    { schedule, retainDays: cronConfig.logRetentionDays },
    '[LogPurgeCron] Starting cron loop',
  );

  if (process.env.CRON_RUN_ON_START === 'true') {
    await runOnce();
  }

  const loop = async () => {
    const delayMs = nextRunMs(schedule);
    const nextRun = new Date(Date.now() + delayMs);
    logger.info({ nextRun: nextRun.toISOString(), delayMs }, '[LogPurgeCron] Next run scheduled');

    await new Promise((r) => setTimeout(r, delayMs));
    await runOnce();
    void loop();
  };

  void loop();
}

scheduledLoop().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, '[LogPurgeCron] Fatal error');
  prisma.$disconnect().finally(() => process.exit(1));
});

process.on('SIGTERM', () => {
  logger.info('[LogPurgeCron] SIGTERM received, shutting down');
  prisma.$disconnect().finally(() => process.exit(0));
});
