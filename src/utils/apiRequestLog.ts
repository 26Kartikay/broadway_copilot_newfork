import { Severity } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { logger } from './logger';

const MAX_ENDPOINT = 2048;
const MAX_TEXT = 16000;

export function severityForHttpStatus(status: number): Severity {
  if (status >= 500) return Severity.ERROR;
  if (status >= 400) return Severity.WARNING;
  return Severity.INFO;
}

export interface ApiRequestLogInput {
  requestId?: string | null;
  severity: Severity;
  endpoint: string;
  httpStatus: number;
  latencyMs: number;
  userId?: string | null;
  userName?: string | null;
  intent?: string | null;
  intentV2?: string | null;
  error?: string | null;
}

/**
 * Persists one HTTP API row (non-blocking). Used for /api/* request completion.
 */
export function persistApiRequestLog(input: ApiRequestLogInput): void {
  const endpoint =
    input.endpoint.length > MAX_ENDPOINT ? input.endpoint.slice(0, MAX_ENDPOINT) : input.endpoint;
  const clip = (s: string | null | undefined) => {
    if (s == null || s === '') return null;
    return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s;
  };

  void prisma.apiRequestLog
    .create({
      data: {
        requestId: input.requestId ?? null,
        severity: input.severity,
        endpoint,
        httpStatus: input.httpStatus,
        latencyMs: input.latencyMs,
        userId: input.userId ?? null,
        userName: clip(input.userName ?? null),
        intent: clip(input.intent ?? null),
        intentV2: clip(input.intentV2 ?? null),
        error: clip(input.error ?? null),
      },
    })
    .catch((err: unknown) => {
      logger.error({ err }, 'persistApiRequestLog: insert failed');
    });
}
