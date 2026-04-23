import {
  ClientClosedError,
  ClientOfflineError,
  ConnectionTimeoutError,
  DisconnectsClientError,
  ReconnectStrategyError,
  SocketClosedUnexpectedlyError,
  SocketTimeoutError,
} from 'redis';

const RECOVERABLE_NODE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
]);

function walkErrorChain(err: unknown, visit: (e: Error) => boolean): boolean {
  let current: unknown = err;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (visit(current)) return true;
    current = current.cause;
  }
  return false;
}

/**
 * True for Redis client / socket / transport failures that should not take down the Node process.
 * Used by global handlers and safe Redis wrappers.
 */
export function isRecoverableRedisOrTransportError(err: unknown): boolean {
  if (err instanceof SocketClosedUnexpectedlyError) return true;
  if (err instanceof ConnectionTimeoutError) return true;
  if (err instanceof SocketTimeoutError) return true;
  if (err instanceof ClientClosedError) return true;
  if (err instanceof ClientOfflineError) return true;
  if (err instanceof DisconnectsClientError) return true;
  if (err instanceof ReconnectStrategyError) return true;

  return walkErrorChain(err, (e) => {
    const code =
      'code' in e && typeof (e as NodeJS.ErrnoException).code === 'string'
        ? (e as NodeJS.ErrnoException).code
        : undefined;
    if (code && RECOVERABLE_NODE_CODES.has(code)) return true;
    const msg = `${e.name} ${e.message}`.toLowerCase();
    if (msg.includes('socket closed unexpectedly')) return true;
    if (msg.includes('redis') && (msg.includes('econnreset') || msg.includes('broken pipe')))
      return true;
    return false;
  });
}
