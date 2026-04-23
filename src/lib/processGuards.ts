import { logger } from '../utils/logger';
import { isRecoverableRedisOrTransportError } from './redisTransportErrors';

let installed = false;

/**
 * Registers process-level handlers. Recoverable Redis / TCP errors are logged and swallowed
 * so the HTTP server keeps running; other uncaught exceptions still exit the process.
 */
export function registerProcessGuards(): void {
  if (installed) return;
  installed = true;

  process.on('unhandledRejection', (reason: unknown) => {
    if (isRecoverableRedisOrTransportError(reason)) {
      logger.warn(
        {
          reason: reason instanceof Error ? reason.message : String(reason),
          name: reason instanceof Error ? reason.name : undefined,
        },
        'Unhandled promise rejection (recoverable transport/Redis); continuing',
      );
      return;
    }
    logger.fatal(
      {
        err: reason instanceof Error ? reason : undefined,
        reason: reason instanceof Error ? reason.message : String(reason),
      },
      'Unhandled promise rejection',
    );
  });

  process.on('uncaughtException', (err: unknown) => {
    if (isRecoverableRedisOrTransportError(err)) {
      logger.warn(
        {
          err:
            err instanceof Error ? { message: err.message, name: err.name, stack: err.stack } : err,
        },
        'Uncaught exception (recoverable transport/Redis); not exiting',
      );
      return;
    }
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
}
