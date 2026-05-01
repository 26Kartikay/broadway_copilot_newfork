/**
 * Shrink HTTP chat bodies for ApiRequestLog storage (avoid huge base64 / megabyte JSON).
 */

const MAX_STRING = 12_000;
const MAX_MEDIA_URL_PREVIEW = 512;

function truncateStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/** Incoming POST /api/chat body — safe for logs and dashboard export. */
export function sanitizeChatRequestForLog(body: unknown): Record<string, unknown> {
  if (body == null || typeof body !== 'object') {
    return { _parseNote: 'non-object body' };
  }
  const b = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof b.userId === 'string') out.userId = b.userId;
  if (typeof b.text === 'string') out.text = truncateStr(b.text, MAX_STRING);
  if (typeof b.profileName === 'string') out.profileName = b.profileName;
  if (typeof b.messageId === 'string') out.messageId = b.messageId;
  if (b.button != null && typeof b.button === 'object') out.button = b.button as Record<string, unknown>;
  if (Array.isArray(b.media)) {
    out.media = b.media.map((item: unknown) => {
      if (!item || typeof item !== 'object') return item;
      const m = item as Record<string, unknown>;
      const url = typeof m.url === 'string' ? truncateStr(m.url, MAX_MEDIA_URL_PREVIEW) : m.url;
      return {
        ...m,
        url,
        ...(typeof m.url === 'string' && m.url.length > MAX_MEDIA_URL_PREVIEW
          ? { _urlTruncated: true }
          : {}),
      };
    });
  }
  return out;
}

const MAX_RESPONSE_STRING = 12_000;

/** Outgoing /api/chat JSON — deep-truncate long strings (replies, captions, URLs). */
export function sanitizeChatResponseForLog(response: unknown): Record<string, unknown> {
  function walk(v: unknown, depth: number): unknown {
    if (depth > 24) return '[max depth]';
    if (typeof v === 'string') return truncateStr(v, MAX_RESPONSE_STRING);
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        o[k] = walk(val, depth + 1);
      }
      return o;
    }
    return v;
  }
  const w = walk(response, 0);
  return typeof w === 'object' && w !== null && !Array.isArray(w)
    ? (w as Record<string, unknown>)
    : { value: w };
}
