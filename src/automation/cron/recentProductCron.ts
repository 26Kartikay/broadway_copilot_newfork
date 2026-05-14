import 'dotenv/config';
import { logger } from '../../utils/logger';
import { prisma } from '../../lib/prisma';
import { syncRecentProducts } from '../services/recentProductService';
import { runProductAutomation } from '../../lib/automation/orchestrator';
import { getRecentProductSyncSchedule, isRecentProductSyncEnabled } from './cronSchedules';

function nextRunMs(cronExpr: string): number {
  const parts = cronExpr.split(' ');
  const minute = parseInt(parts[0] ?? '0', 10);
  const hourPart = parts[1] ?? '*';

  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(minute);

  if (hourPart === '*') {
    next.setHours(now.getHours() + 1);
  } else if (hourPart.includes('*/')) {
    const interval = parseInt(hourPart.split('/')[1] || '1', 10);
    const nextHour = Math.ceil((now.getHours() + 0.1) / interval) * interval;
    next.setHours(nextHour);
  } else {
    // Specific hours like "0,12"
    const hours = hourPart.split(',').map(h => parseInt(h, 10)).sort((a, b) => a - b);
    let targetHour = hours.find(h => h > now.getHours());
    if (targetHour === undefined) {
      targetHour = hours[0];
      next.setDate(next.getDate() + 1);
    }
    next.setHours(targetHour!);
  }

  if (next <= now) {
    next.setHours(next.getHours() + 1);
  }

  return next.getTime() - now.getTime();
}

async function runOnce() {
  logger.info('[RecentProductCron] Starting recent SKU synchronization');
  try {
    const syncResult = await syncRecentProducts();
    logger.info(syncResult, '[RecentProductCron] Sync complete');

    if (syncResult.newProducts > 0 || syncResult.updatedProducts > 0) {
      logger.info({ new: syncResult.newProducts }, '[RecentProductCron] New products found. Triggering automation...');
      const metrics = await runProductAutomation({
        maxProducts: 500,
        skipEmbedded: true
      });
      logger.info({ 
        success: metrics.successCount, 
        failed: metrics.failureCount 
      }, '[RecentProductCron] Automation run complete');
    } else {
      logger.info('[RecentProductCron] No new products to process');
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[RecentProductCron] Job failed',
    );
  }
}

async function scheduledLoop() {
  const schedule = getRecentProductSyncSchedule();

  if (!isRecentProductSyncEnabled()) {
    logger.info('[RecentProductCron] Disabled via config. Exiting.');
    process.exit(0);
  }

  logger.info({ schedule }, '[RecentProductCron] Starting cron loop');

  if (process.env.CRON_RUN_ON_START === 'true') {
    await runOnce();
  }

  const loop = async () => {
    const delayMs = nextRunMs(schedule);
    const nextRun = new Date(Date.now() + delayMs);
    logger.info({ nextRun: nextRun.toISOString(), delayMs }, '[RecentProductCron] Next run scheduled');

    await new Promise(r => setTimeout(r, delayMs));
    await runOnce();
    void loop();
  };

  void loop();
}

scheduledLoop().catch(err => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, '[RecentProductCron] Fatal error');
  prisma.$disconnect().finally(() => process.exit(1));
});

process.on('SIGTERM', () => {
  logger.info('[RecentProductCron] SIGTERM received, shutting down');
  prisma.$disconnect().finally(() => process.exit(0));
});
