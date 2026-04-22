import { createClient } from 'redis';

import { logger } from '../utils/logger';

const globalForRedis = globalThis as typeof globalThis & {
  redis?: ReturnType<typeof createClient>;
};

function redactRedisUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '[invalid-url]';
  }
}

/** Counters and timestamps for ops / observability (logs + optional metrics export). */
export const redisMetrics = {
  disconnectEvents: 0,
  readyEvents: 0,
  lastDisconnectAt: null as number | null,
  lastReadyAt: null as number | null,
  /** Milliseconds between last disconnect and subsequent `ready` (null if unknown). */
  lastReconnectDurationMs: null as number | null,
  connectionErrorEvents: 0,
  lastReconnectStrategyLog: null as { retries: number; delayMs: number; at: number } | null,
};

let backgroundConnectTimer: ReturnType<typeof setInterval> | undefined;

function clearBackgroundConnectTimer(): void {
  if (backgroundConnectTimer !== undefined) {
    clearInterval(backgroundConnectTimer);
    backgroundConnectTimer = undefined;
  }
}

function scheduleBackgroundRedisConnect(): void {
  if (backgroundConnectTimer !== undefined) return;
  logger.info('Scheduling background Redis connect every 10s until success');
  backgroundConnectTimer = setInterval(() => {
    void (async () => {
      try {
        if (!redis.isOpen) {
          await redis.connect();
          logger.info('Redis connected after earlier startup failure');
          clearBackgroundConnectTimer();
        }
      } catch (err: unknown) {
        logger.debug(
          { err: err instanceof Error ? err.message : String(err) },
          'Background Redis connect attempt failed; will retry',
        );
      }
    })();
  }, 10_000);
}

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis =
  globalForRedis.redis ||
  createClient({
    url: redisUrl,
    /** Queue commands while reconnecting instead of failing immediately. */
    disableOfflineQueue: false,
    /** Proactive PING for idle connections (NAT / LB friendly). */
    pingInterval: 30_000,
    socket: {
      keepAlive: true,
      connectTimeout: 15_000,
      reconnectStrategy: (retries, cause) => {
        const delayMs = Math.min(50 * 2 ** Math.min(retries, 16), 30_000);
        redisMetrics.lastReconnectStrategyLog = { retries, delayMs, at: Date.now() };
        logger.warn(
          {
            retries,
            delayMs,
            cause: cause instanceof Error ? cause.message : String(cause),
          },
          'Redis reconnectStrategy: scheduling reconnect',
        );
        return delayMs;
      },
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

redis.on('error', (err) => {
  redisMetrics.connectionErrorEvents += 1;
  logger.error({ err: err.message, name: err.name }, 'Redis client error');
});

redis.on('connect', () => {
  logger.info('Redis socket connect');
});

redis.on('ready', () => {
  redisMetrics.readyEvents += 1;
  const now = Date.now();
  if (redisMetrics.lastDisconnectAt !== null) {
    redisMetrics.lastReconnectDurationMs = now - redisMetrics.lastDisconnectAt;
    logger.info(
      {
        reconnectDurationMs: redisMetrics.lastReconnectDurationMs,
        disconnectEvents: redisMetrics.disconnectEvents,
        connectionErrorEvents: redisMetrics.connectionErrorEvents,
      },
      'Redis client ready',
    );
  } else {
    logger.info('Redis client ready');
  }
  redisMetrics.lastReadyAt = now;
});

redis.on('reconnecting', () => {
  logger.info('Redis client reconnecting');
});

redis.on('end', () => {
  redisMetrics.disconnectEvents += 1;
  redisMetrics.lastDisconnectAt = Date.now();
  logger.warn(
    {
      disconnectEvents: redisMetrics.disconnectEvents,
      lastReadyAt: redisMetrics.lastReadyAt,
    },
    'Redis client connection ended',
  );
});

/**
 * Best-effort PING for health checks. Does not call `connect()` implicitly.
 */
export async function getRedisHealthSnapshot(): Promise<{
  status: 'ok' | 'down';
  pingMs?: number;
  detail?: string;
  metrics: typeof redisMetrics;
}> {
  const metrics = { ...redisMetrics };
  if (!redis.isOpen) {
    return { status: 'down', detail: 'client_not_open', metrics };
  }
  try {
    const t0 = Date.now();
    await redis.ping();
    return { status: 'ok', pingMs: Date.now() - t0, metrics };
  } catch (err: unknown) {
    return {
      status: 'down',
      detail: err instanceof Error ? err.message : String(err),
      metrics,
    };
  }
}

/**
 * Connects to Redis. Does not throw: API can start without Redis and recover later.
 */
export async function connectRedis(): Promise<void> {
  try {
    if (!redis.isOpen) {
      await redis.connect();
    }
    logger.info({ url: redactRedisUrl(redisUrl) }, 'Redis connected at startup');
    clearBackgroundConnectTimer();
  } catch (err: unknown) {
    logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        url: redactRedisUrl(redisUrl),
      },
      'Redis unavailable at startup; continuing without Redis until background connect succeeds',
    );
    scheduleBackgroundRedisConnect();
  }
}
