import 'dotenv/config';
import { logger } from '../../utils/logger';
import { prisma } from '../../lib/prisma';
import { runProductAutomation } from '../../lib/automation/orchestrator';
import { getProductTaggerSchedule, isProductTaggerEnabled } from './cronSchedules';

// Simple cron scheduler — avoids adding node-cron dependency.
// Parses "0 2 * * *" (minute hour * * *) and schedules daily runs.
function nextRunMs(cronExpr: string): number {
  const parts = cronExpr.split(' ');
  const minute = parseInt(parts[0] ?? '0', 10);
  const hour = parseInt(parts[1] ?? '2', 10);

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
  logger.info('[ProductTaggerCron] Running scheduled product automation');
  try {
    const metrics = await runProductAutomation();
    logger.info(
      {
        totalTasks: metrics.totalTasks,
        success: metrics.successCount,
        failed: metrics.failureCount,
        avgMs: Math.round(metrics.averageDuration),
      },
      '[ProductTaggerCron] Run complete',
    );
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[ProductTaggerCron] Run failed',
    );
  }
}

async function scheduledLoop() {
  const schedule = getProductTaggerSchedule();

  if (!isProductTaggerEnabled()) {
    logger.info('[ProductTaggerCron] Disabled via config. Exiting.');
    process.exit(0);
  }

  logger.info({ schedule }, '[ProductTaggerCron] Starting cron loop');

  // Run immediately on start if CRON_RUN_ON_START=true
  if (process.env.CRON_RUN_ON_START === 'true') {
    await runOnce();
  }

  const loop = async () => {
    const delayMs = nextRunMs(schedule);
    const nextRun = new Date(Date.now() + delayMs);
    logger.info({ nextRun: nextRun.toISOString(), delayMs }, '[ProductTaggerCron] Next run scheduled');

    await new Promise(r => setTimeout(r, delayMs));
    await runOnce();
    void loop();
  };

  void loop();
}

scheduledLoop().catch(err => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ProductTaggerCron] Fatal error');
  prisma.$disconnect().finally(() => process.exit(1));
});

process.on('SIGTERM', () => {
  logger.info('[ProductTaggerCron] SIGTERM received, shutting down');
  prisma.$disconnect().finally(() => process.exit(0));
});
