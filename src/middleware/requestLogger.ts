import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

import { logger } from '../utils/logger';

function getGcpProjectId(): string | undefined {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
}

function parseCloudTraceContext(
  headerValue: string,
): { traceId?: string; spanId?: string; sampled?: boolean } {
  // Format: TRACE_ID/SPAN_ID;o=TRACE_TRUE
  const [traceAndSpan, options] = headerValue.split(';');
  if (!traceAndSpan) {
    return {};
  }
  const [traceId, spanId] = traceAndSpan.split('/');
  const sampled = options?.trim() === 'o=1';
  const result: { traceId?: string; spanId?: string; sampled?: boolean } = {};
  if (traceId) {
    result.traceId = traceId;
  }
  if (spanId) {
    result.spanId = spanId;
  }
  if (sampled !== undefined) {
    result.sampled = sampled;
  }
  return result;
}

export function getGcpTraceFields(req: Request): Record<string, unknown> {
  const headerValue = req.get('x-cloud-trace-context');
  if (!headerValue) return {};

  const { traceId, spanId, sampled } = parseCloudTraceContext(headerValue);
  if (!traceId) return {};

  const projectId = getGcpProjectId();
  const trace = projectId ? `projects/${projectId}/traces/${traceId}` : undefined;

  return {
    ...(trace ? { 'logging.googleapis.com/trace': trace } : null),
    ...(spanId ? { 'logging.googleapis.com/spanId': spanId } : null),
    ...(sampled !== undefined ? { 'logging.googleapis.com/trace_sampled': sampled } : null),
  };
}

function getOrCreateRequestId(req: Request): string {
  const fromHeader = req.get('x-request-id');
  if (fromHeader) return fromHeader;

  const traceHeader = req.get('x-cloud-trace-context');
  if (traceHeader) {
    const { traceId } = parseCloudTraceContext(traceHeader);
    if (traceId) return traceId;
  }

  return randomUUID();
}

function toLatencySecondsString(latencyMs: number): string {
  return `${(latencyMs / 1000).toFixed(3)}s`;
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = getOrCreateRequestId(req);
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const contentLength = res.getHeader('content-length');
    const responseSize =
      typeof contentLength === 'string'
        ? parseInt(contentLength, 10)
        : typeof contentLength === 'number'
          ? contentLength
          : undefined;

    const httpRequest = {
      requestMethod: req.method,
      requestUrl: req.originalUrl || req.url,
      status: res.statusCode,
      userAgent: req.get('User-Agent'),
      referer: req.get('Referer'),
      remoteIp: req.ip,
      protocol: req.protocol,
      latency: toLatencySecondsString(latencyMs),
      ...(responseSize !== undefined ? { responseSize } : null),
    };

    const payload = {
      requestId,
      httpRequest,
      latencyMs: Math.round(latencyMs),
      ...getGcpTraceFields(req),
    };

    const msg = `${req.method} ${req.originalUrl || req.url}`;
    if (res.statusCode >= 500) {
      logger.error(payload, msg);
    } else if (res.statusCode >= 400) {
      logger.warn(payload, msg);
    } else {
      logger.info(payload, msg);
    }
  });

  next();
}


