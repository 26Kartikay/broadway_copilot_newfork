import 'dotenv/config';
import { logger } from '../../utils/logger';
import { prisma } from '../../lib/prisma';
import { syncBarcodes } from '../services/barcodeService';
import { getBarcodeSyncSchedule, isBarcodeSyncEnabled } from './cronSchedules';

function nextRunMs(cronExpr: string): number {
  const parts = cronExpr.split(' ');
  const minute = parseInt(parts[0] ?? '0', 10);
  const hour = parseInt(parts[1] ?? '1', 10);

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
  logger.info('[BarcodeSyncCron] Running scheduled barcode synchronization');
  try {
    const result = await syncBarcodes();
    logger.info(result, '[BarcodeSyncCron] Sync complete');
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[BarcodeSyncCron] Sync failed',
    );
  }
}

async function scheduledLoop() {
  const schedule = getBarcodeSyncSchedule();

  if (!isBarcodeSyncEnabled()) {
    logger.info('[BarcodeSyncCron] Disabled via config. Exiting.');
    process.exit(0);
  }

  logger.info({ schedule }, '[BarcodeSyncCron] Starting cron loop');

  if (process.env.CRON_RUN_ON_START === 'true') {
    await runOnce();
  }

  const loop = async () => {
    const delayMs = nextRunMs(schedule);
    const nextRun = new Date(Date.now() + delayMs);
    logger.info({ nextRun: nextRun.toISOString(), delayMs }, '[BarcodeSyncCron] Next run scheduled');

    await new Promise(r => setTimeout(r, delayMs));
    await runOnce();
    void loop();
  };

  void loop();
}

scheduledLoop().catch(err => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, '[BarcodeSyncCron] Fatal error');
  prisma.$disconnect().finally(() => process.exit(1));
});

process.on('SIGTERM', () => {
  logger.info('[BarcodeSyncCron] SIGTERM received, shutting down');
  prisma.$disconnect().finally(() => process.exit(0));
});
