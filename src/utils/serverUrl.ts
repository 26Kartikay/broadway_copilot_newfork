/**
 * Fixes common misconfiguration where `SERVER_URL` was set to a whole `.env` line
 * (e.g. value literally `SERVER_URL=https://example.com`) instead of just the URL.
 */
function stripMistakenEnvLinePrefixes(s: string): string {
  let t = s.trim();
  let changed = true;
  while (changed) {
    changed = false;
    if (/^server_url=/i.test(t)) {
      t = t.replace(/^server_url=/i, '').trim();
      changed = true;
    }
  }
  return t;
}

/** Public base URL (no trailing slash) from env, safe for building `/uploads/...` links. */
export function getServerUrlBase(): string {
  const raw = process.env.SERVER_URL;
  if (!raw) return '';
  return stripMistakenEnvLinePrefixes(raw).replace(/\/$/, '');
}

/**
 * Normalizes URLs stored in DB or message content (same mistaken prefix, or junk before https://).
 */
export function normalizeHttpUrlReference(input: string): string {
  let s = stripMistakenEnvLinePrefixes(input);
  if (!s) return s;
  if (s.startsWith('data:')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  const m = s.match(/https?:\/\/[^?\s'"<>]+/i);
  return m ? m[0] : s;
}
