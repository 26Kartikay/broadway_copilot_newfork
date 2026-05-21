import 'dotenv/config';
import { logger } from '../../utils/logger';
import { prisma } from '../../lib/prisma';
import { isVibeCheckReminderEnabled } from './cronSchedules';

// 10:00 AM IST = 04:30 AM UTC
const TARGET_HOUR_UTC = 4;
const TARGET_MINUTE_UTC = 30;
const BATCH_SIZE = 500;

const COMMS_SERVICE_URL = (process.env.COMMS_SERVICE_URL ?? 'http://localhost:8001').replace(/\/$/, '');

// Set VIBE_CHECK_REMINDER_INTERVAL_MS=60000 to fire every 1 min (testing only)
const TEST_INTERVAL_MS = process.env.VIBE_CHECK_REMINDER_INTERVAL_MS
  ? parseInt(process.env.VIBE_CHECK_REMINDER_INTERVAL_MS, 10)
  : null;

// Mon=0 … Sun=6 (aligned to IST day at 10 AM)
const MALE_MESSAGES: { title: string; body: string }[] = [
  { title: 'Vibe Check ⚡😎',           body: 'Did you Vibe Check today? ⚡😎' },
  { title: 'Vibe Check 🔥👀',           body: 'Your mood called… time for a Vibe Check 🔥👀' },
  { title: 'Midweek Vibe Check 😌⚙️',   body: 'Midweek chaos? Do a Vibe Check 😌⚙️' },
  { title: 'Real Ones Vibe Check 👊✨',  body: 'Real ones never skip the Vibe Check 👊✨' },
  { title: 'Weekend Vibe Check 🎉😏',   body: 'Weekend starts after the Vibe Check 🎉😏' },
  { title: 'Main Character 🎬🔥',       body: 'Main character energy needs a Vibe Check 🎬🔥' },
  { title: 'Sunday Vibe Check 🌙⚡',    body: 'Before tomorrow hits… Vibe Check 🌙⚡' },
];

const FEMALE_MESSAGES: { title: string; body: string }[] = [
  { title: 'Vibe Check 💅✨',           body: 'Hey queen, did you Vibe Check today? 💅✨' },
  { title: 'Pretty Energy 🌸👀',        body: 'Pretty energy starts with a Vibe Check 🌸👀' },
  { title: 'Glow Check 💖⚡',           body: 'Glow check = Vibe Check 💖⚡' },
  { title: 'Soft Reminder 🌷✨',        body: 'Soft reminder to do your Vibe Check 🌷✨' },
  { title: 'Hot Girl Weekend 🎀😌',     body: 'Hot girl weekend begins with a Vibe Check 🎀😌' },
  { title: 'Aura Check 👑💫',           body: 'Your aura deserves a Vibe Check 👑💫' },
  { title: 'Reset Your Energy 🌙💖',    body: 'Reset your energy with a Vibe Check 🌙💖' },
];

const DEFAULT_MESSAGES: { title: string; body: string }[] = [
  { title: 'Vibe Check ⚡',             body: 'Did you Vibe Check today? ⚡' },
  { title: 'Vibe Check 🔥',             body: 'Your mood called… time for a Vibe Check 🔥' },
  { title: 'Midweek Vibe Check 😌',     body: 'Midweek chaos? Do a Vibe Check 😌' },
  { title: 'Vibe Check 👊',             body: 'Real ones never skip the Vibe Check 👊' },
  { title: 'Weekend Vibe Check 🎉',     body: 'Weekend starts after the Vibe Check 🎉' },
  { title: 'Main Character 🎬',         body: 'Main character energy needs a Vibe Check 🎬' },
  { title: 'Sunday Vibe Check 🌙',      body: 'Before tomorrow hits… Vibe Check 🌙' },
];

/** Returns the IST day-of-week index where Mon=0, Tue=1, … Sun=6. */
function istDayIndex(): number {
  const nowUtcMs = Date.now();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(nowUtcMs + istOffsetMs);
  // getUTCDay(): 0=Sun,1=Mon,…,6=Sat → remap to Mon=0…Sun=6
  const jsDay = istDate.getUTCDay(); // 0=Sun
  return jsDay === 0 ? 6 : jsDay - 1; // Sun→6, Mon→0, …
}

function nextRunMs(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(TARGET_MINUTE_UTC);
  next.setUTCHours(TARGET_HOUR_UTC);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

async function dispatchBatch(userIds: number[], title: string, body: string): Promise<void> {
  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const batch = userIds.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch(`${COMMS_SERVICE_URL}/v1/dispatch/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_ids: batch,
          title,
          body,
          caller_service: 'broadway_copilot',
          variables: { action: 'vibe_check', screen: 'chat' },
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        logger.error({ status: res.status, body: text, batchStart: i }, '[VibeCheckReminderCron] Batch failed');
      } else {
        logger.info({ batchStart: i, batchSize: batch.length }, '[VibeCheckReminderCron] Batch dispatched');
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), batchStart: i },
        '[VibeCheckReminderCron] Batch request error',
      );
    }
  }
}

async function runOnce() {
  const dayIdx = istDayIndex();
  logger.info({ dayIndex: dayIdx }, '[VibeCheckReminderCron] Starting daily vibe check push');

  const users = await prisma.user.findMany({
    where: { isGuest: false },
    select: { appUserId: true, confirmedGender: true, inferredGender: true },
  });

  if (users.length === 0) {
    logger.info('[VibeCheckReminderCron] No eligible users, skipping');
    return;
  }

  const maleIds: number[] = [];
  const femaleIds: number[] = [];
  const defaultIds: number[] = [];

  for (const user of users) {
    const id = parseInt(user.appUserId, 10);
    if (isNaN(id)) continue;

    const gender = user.confirmedGender ?? user.inferredGender;
    if (gender === 'MALE') maleIds.push(id);
    else if (gender === 'FEMALE') femaleIds.push(id);
    else defaultIds.push(id);
  }

  logger.info(
    { male: maleIds.length, female: femaleIds.length, unknown: defaultIds.length },
    '[VibeCheckReminderCron] Users by gender',
  );

  const maleMsg = MALE_MESSAGES[dayIdx]!;
  const femaleMsg = FEMALE_MESSAGES[dayIdx]!;
  const defaultMsg = DEFAULT_MESSAGES[dayIdx]!;

  if (maleIds.length > 0) await dispatchBatch(maleIds, maleMsg.title, maleMsg.body);
  if (femaleIds.length > 0) await dispatchBatch(femaleIds, femaleMsg.title, femaleMsg.body);
  if (defaultIds.length > 0) await dispatchBatch(defaultIds, defaultMsg.title, defaultMsg.body);

  logger.info('[VibeCheckReminderCron] Done');
}

async function scheduledLoop() {
  if (!isVibeCheckReminderEnabled()) {
    logger.info('[VibeCheckReminderCron] Disabled via CRON_VIBE_CHECK_REMINDER_ENABLED. Exiting.');
    process.exit(0);
  }

  if (TEST_INTERVAL_MS) {
    logger.warn({ intervalMs: TEST_INTERVAL_MS }, '[VibeCheckReminderCron] TEST MODE — running on fixed interval');
  } else {
    logger.info('[VibeCheckReminderCron] Starting — fires daily at 10:00 AM IST (04:30 UTC)');
  }

  if (process.env.CRON_RUN_ON_START === 'true') {
    await runOnce();
  }

  const loop = async () => {
    const delayMs = TEST_INTERVAL_MS ?? nextRunMs();
    const nextRun = new Date(Date.now() + delayMs);
    logger.info({ nextRun: nextRun.toISOString(), delayMs }, '[VibeCheckReminderCron] Next run scheduled');
    await new Promise((r) => setTimeout(r, delayMs));
    await runOnce();
    void loop();
  };

  void loop();
}

scheduledLoop().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, '[VibeCheckReminderCron] Fatal error');
  prisma.$disconnect().finally(() => process.exit(1));
});

process.on('SIGTERM', () => {
  logger.info('[VibeCheckReminderCron] SIGTERM received, shutting down');
  prisma.$disconnect().finally(() => process.exit(0));
});
