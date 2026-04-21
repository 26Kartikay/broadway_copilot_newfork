import { Severity } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from './logger';

export interface LogParams {
  severity: Severity;
  service: string;
  message: string;
  context?: any;
  userId?: string;
  appUserId?: string;
  whatsappId?: string;
  profileNameSnapshot?: string;
  conversationId?: string;
  graphRunId?: string;
  traceId?: string;
}

/**
 * Persists a log entry to the ServiceLog table in the database.
 * This is used for high-importance logs that should be visible in the admin dashboard.
 *
 * @param params The log parameters
 */
export async function persistLog(params: LogParams): Promise<void> {
  try {
    // We don't await this in the critical path to avoid adding latency to the user request.
    // However, for bootstrap or background tasks, it's fine.
    void prisma.serviceLog.create({
      data: {
        severity: params.severity,
        service: params.service,
        message: params.message,
        context: params.context || {},
        userId: params.userId,
        appUserId: params.appUserId,
        whatsappId: params.whatsappId,
        profileNameSnapshot: params.profileNameSnapshot,
        conversationId: params.conversationId,
        graphRunId: params.graphRunId,
        traceId: params.traceId,
      },
    }).catch(err => {
      // If DB logging fails, fallback to standard pino logger
      logger.error({ err, originalLog: params }, 'Failed to persist log to database');
    });
  } catch (err) {
    logger.error({ err, originalLog: params }, 'Exception in persistLog');
  }
}

/**
 * Wrapper for persistLog that automatically sets common fields from a request context if available.
 */
export function dbLog(severity: Severity, service: string, message: string, context?: any, metadata?: Partial<LogParams>) {
  return persistLog({
    severity,
    service,
    message,
    context,
    ...metadata
  });
}
