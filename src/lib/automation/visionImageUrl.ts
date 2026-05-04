import sharp from 'sharp';
import { logger } from '../../utils/logger';

/** Spreadsheet “no image” sentinels — not valid URLs. */
const CSV_IMAGE_MISSING = new Set([
  '',
  'na',
  'n/a',
  'n\\a',
  '#n/a',
  '#na',
  'null',
  'none',
  '-',
  '--',
  '.',
  'nil',
  'tbd',
  'tbc',
]);

/**
 * Returns a usable `http(s):` image URL, or `''` when the cell is empty or a spreadsheet placeholder (e.g. `NA`).
 */
export function normalizeCsvImageUrl(raw: string | undefined | null): string {
  const s = raw?.trim() ?? '';
  if (!s) return '';
  if (CSV_IMAGE_MISSING.has(s.toLowerCase())) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return s;
  } catch {
    return '';
  }
}

/** Formats OpenAI vision accepts when it fetches the URL itself. */
const OPENAI_URL_EXT = /\.(jpe?g|png|gif|webp)(\?|#|$)/i;

/** Often breaks remote fetch or OpenAI decode (AVIF common on Shopify CDNs). */
const LIKELY_BAD_EXT = /\.(avif|heic|svg|bmp|tiff?|ico)(\?|#|$)/i;

export function isUnsupportedImageApiError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /unsupported image|invalid[_ ]image|image.*format/i.test(m);
}

/**
 * Download image and return a JPEG data URL OpenAI vision always accepts.
 * Use when the original URL is AVIF/HEIC or when the API rejects remote fetch.
 */
export async function fetchImageAsJpegDataUrl(
  imageUrl: string,
  maxBytes = 5 * 1024 * 1024,
): Promise<string | null> {
  const url = imageUrl.trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  } catch {
    return null;
  }

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
      headers: { Accept: 'image/*,*/*' },
    });
    if (!res.ok) {
      logger.debug({ status: res.status, url: url.slice(0, 120) }, '[Automation] image fetch HTTP error');
      return null;
    }
    const len = res.headers.get('content-length');
    if (len && parseInt(len, 10) > maxBytes) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) return null;

    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (ct && !ct.startsWith('image/') && !ct.includes('octet-stream')) {
      logger.debug({ ct, url: url.slice(0, 120) }, '[Automation] image fetch non-image content-type');
      return null;
    }

    const jpeg = await sharp(buf).rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch (e) {
    logger.debug(
      { err: e instanceof Error ? e.message : String(e), url: url.slice(0, 120) },
      '[Automation] fetchImageAsJpegDataUrl failed',
    );
    return null;
  }
}

/** Whether we should fetch server-side before the first vision call (fast path skips fetch for obvious JPG/PNG URLs). */
export function shouldPrefetchImageForVision(
  imageUrl: string,
  mode: 'auto' | 'always_fetch',
): boolean {
  if (mode === 'always_fetch') return true;
  const pathOnly = imageUrl.trim().split(/[?#]/)[0] ?? '';
  if (LIKELY_BAD_EXT.test(pathOnly)) return true;
  if (!OPENAI_URL_EXT.test(pathOnly)) return true;
  return false;
}
