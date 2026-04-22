import { logger } from '../utils/logger';
import { redis } from './redis';
import { isRecoverableRedisOrTransportError } from './redisTransportErrors';

/**
 * Runs a Redis command with graceful degradation: on disconnect or transport errors returns `fallback`.
 * Non-transport errors are rethrown.
 */
export async function withRedis<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    if (!redis.isOpen) {
      logger.warn({ label }, 'Redis client not open; using fallback');
      return fallback;
    }
    return await fn();
  } catch (err: unknown) {
    if (isRecoverableRedisOrTransportError(err)) {
      logger.warn(
        { label, err: err instanceof Error ? err.message : String(err) },
        'Redis command failed; using fallback',
      );
      return fallback;
    }
    throw err;
  }
}

/**
 * Best-effort Redis side effect (e.g. status keys). Swallows recoverable errors only.
 */
export async function runSafeRedisVoid(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    if (!redis.isOpen) {
      logger.warn({ label }, 'Redis client not open; skipping side-effect');
      return;
    }
    await fn();
  } catch (err: unknown) {
    if (isRecoverableRedisOrTransportError(err)) {
      logger.warn(
        { label, err: err instanceof Error ? err.message : String(err) },
        'Redis side-effect skipped after transport error',
      );
      return;
    }
    throw err;
  }
}
