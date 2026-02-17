import pino, { LoggerOptions } from 'pino';

const isDevelopment = process.env.NODE_ENV === 'development';

type PinoLevelLabel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const levelToSeverity: Record<PinoLevelLabel, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

/**
 * Centralized logger instance using Pino with Cloud Logging-friendly fields.
 *
 * - Production: JSON to stdout (best for Cloud Run / Cloud Logging).
 * - Development: pretty printed logs for readability.
 */
const loggerOptions: LoggerOptions = {
  level: isDevelopment ? 'debug' : 'info',
  messageKey: 'message',
  base: null, // omit pid/hostname noise; Cloud Run already provides resource metadata
  formatters: {
    level(label) {
      return { severity: levelToSeverity[label as PinoLevelLabel] ?? 'DEFAULT' };
    },
  },
};

if (isDevelopment) {
  loggerOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      messageKey: 'message',
    },
  };
}

export const logger = pino(loggerOptions);
