#!/usr/bin/env node
/**
 * Batch-evaluate color analysis via POST /api/chat (same path as the web UI).
 *
 * CSV columns (your sheet): sno, name, gender, correct_palette, derived_palette
 * Optional: image_url — if set (http...), used instead of celeb_images lookup.
 * Extra columns (e.g. status, correction_note) are preserved in the output.
 *
 * Images: files in celeb_images/ whose basename (without extension) matches `name`
 * (case-insensitive, trims, collapses spaces, strips trailing dots).
 *
 * Usage:
 *   BASE_URL=http://localhost:8080 node scripts/color-analysis-eval/run-eval.mjs [dataset.csv]
 *
 * Options:
 *   --celeb-dir path/to/celeb_images   (default: ./celeb_images or CELEB_IMAGES_DIR)
 *   --remote-first                     use image_url when present, even if celeb_images matches
 *   --delay-ms 500
 *   --out path/to/results.csv
 *   --reuse-user-ids          use color_eval_<sno> only (can hit SAVE_COLOR_ANALYSIS from old DB state)
 *
 * Each run uses userId color_eval_<sno>_<runId> by default so Postgres never reuses a conversation
 * that is still waiting on “save palette?” — otherwise the graph routes to handleSaveColorAnalysis,
 * ignores your new photo, and replies “No problem. I won't save your color palette.”
 *
 * The app must serve /celeb_images (see src/index.ts) so the server can fetch URLs.
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PALETTES = [
  'LIGHT_SPRING',
  'TRUE_SPRING',
  'BRIGHT_SPRING',
  'LIGHT_SUMMER',
  'TRUE_SUMMER',
  'SOFT_SUMMER',
  'SOFT_AUTUMN',
  'TRUE_AUTUMN',
  'DARK_AUTUMN',
  'TRUE_WINTER',
  'BRIGHT_WINTER',
  'DARK_WINTER',
];

const PALETTE_SET = new Set(PALETTES);

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (!inQ && c === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let li = 1; li < lines.length; li++) {
    const vals = parseCsvLine(lines[li]);
    if (vals.every((v) => String(v).trim() === '')) continue;
    const row = {};
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

function escapeCsvCell(v) {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers, rows) {
  const head = headers.map(escapeCsvCell).join(',');
  const body = rows.map((r) => headers.map((h) => escapeCsvCell(r[h] ?? '')).join(','));
  return [head, ...body].join('\n') + '\n';
}

function normalizePalette(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  const asKey = s.toUpperCase().replace(/\s+/g, '_');
  if (PALETTE_SET.has(asKey)) return asKey;
  return null;
}

function normalizeCelebKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\.+$/, '');
}

function mimeFromFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
  };
  return map[ext] || 'image/jpeg';
}

/** @returns {Map<string, string>} key -> exact filename on disk */
function buildCelebIndex(celebDir) {
  const map = new Map();
  if (!fs.existsSync(celebDir)) return map;
  for (const ent of fs.readdirSync(celebDir, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    const base = path.basename(ent.name, path.extname(ent.name));
    const key = normalizeCelebKey(base);
    if (map.has(key)) {
      console.error(`warn: duplicate celeb key "${key}" (${map.get(key)} vs ${ent.name}), using ${ent.name}`);
    }
    map.set(key, ent.name);
  }
  return map;
}

/**
 * Prefer celeb_images when `name` matches a file — remote URLs (e.g. Wikimedia) often fail
 * inside Docker (403 / blocks) and were hiding your local portraits.
 * Pass --remote-first to use image_url when both exist (old behavior).
 */
function resolveImageForRow(row, celebIndex, baseUrl, preferRemoteFirst) {
  const explicit = String(row.image_url ?? '').trim();
  const isHttp = explicit.startsWith('http://') || explicit.startsWith('https://');

  const nameKey = normalizeCelebKey(row.name);
  const localFile = nameKey ? celebIndex.get(nameKey) : null;

  const localResolved =
    localFile != null
      ? {
          url: `${baseUrl.replace(/\/$/, '')}/celeb_images/${encodeURIComponent(localFile)}`,
          contentType: mimeFromFilename(localFile),
          source: localFile,
        }
      : null;

  let filename = '';
  if (isHttp) {
    try {
      filename = path.basename(new URL(explicit).pathname);
    } catch {
      filename = '';
    }
  }
  const remoteResolved = isHttp
    ? {
        url: explicit,
        contentType: mimeFromFilename(filename || explicit),
        source: 'image_url',
      }
    : null;

  if (preferRemoteFirst && remoteResolved) return remoteResolved;
  if (localResolved) return localResolved;
  if (remoteResolved) return remoteResolved;

  if (!nameKey) {
    return { url: null, contentType: null, source: null, error: 'missing name' };
  }
  return {
    url: null,
    contentType: null,
    source: null,
    error: `no file in celeb_images for name "${row.name}" (key: ${nameKey}) and no image_url`,
  };
}

function extractPaletteFromReplies(replies) {
  if (!Array.isArray(replies)) return { palette: null, note: 'no_replies' };
  const card = replies.find((r) => r && r.reply_type === 'color_analysis_card' && r.palette_name);
  if (card) return { palette: card.palette_name, note: null };

  const uploadAsk = replies.find((r) => r && r.reply_type === 'color_analysis_image_upload_request');
  if (uploadAsk && uploadAsk.reply_text) {
    return {
      palette: null,
      note: `no_image_ingested (server asked for photo): ${String(uploadAsk.reply_text).slice(0, 160)}`,
    };
  }

  const text = replies.find(
    (r) =>
      r &&
      r.reply_text &&
      (r.reply_type === 'text' || r.reply_type === 'text_only'),
  );
  if (text) return { palette: null, note: `text_reply: ${String(text.reply_text).slice(0, 160)}` };

  const types = replies.map((r) => (r && r.reply_type) || '?').join(', ');
  return { palette: null, note: `no_color_card (reply_types: ${types || 'empty'})` };
}

async function runOne(baseUrl, row, delayMs, celebIndex, preferRemoteFirst, evalRunSuffix) {
  const sno = String(row.sno ?? '').trim();
  const correct = normalizePalette(row.correct_palette);

  const resolved = resolveImageForRow(row, celebIndex, baseUrl, preferRemoteFirst);
  if (resolved.error) {
    return { derived_palette: '', match: '', error: resolved.error, resolved_image: '' };
  }
  const { url: imageUrl, contentType } = resolved;

  if (!correct) {
    return {
      derived_palette: '',
      match: '',
      error: `invalid correct_palette: ${row.correct_palette}`,
      resolved_image: resolved.source || '',
    };
  }

  const slug = sno || String(row.name || '')
    .trim()
    .slice(0, 40)
    .replace(/\s+/g, '_');
  const userId = evalRunSuffix
    ? `color_eval_${slug}_${evalRunSuffix}`
    : `color_eval_${slug || cryptoRandomId()}`;

  const body = {
    userId,
    text: 'Color analysis',
    profileName: row.name ? String(row.name).trim() : undefined,
    media: [{ url: imageUrl, contentType }],
    button: { payload: 'color_analysis', text: 'Color analysis', type: 'quick_reply' },
  };

  let res;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      derived_palette: '',
      match: '',
      error: `fetch failed: ${msg}`,
      resolved_image: resolved.source || imageUrl,
    };
  }

  if (!res.ok) {
    const errText = await res.text();
    return {
      derived_palette: '',
      match: '',
      error: `HTTP ${res.status}: ${errText.slice(0, 200)}`,
      resolved_image: resolved.source || imageUrl,
    };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return {
      derived_palette: '',
      match: '',
      error: 'invalid JSON response',
      resolved_image: resolved.source || imageUrl,
    };
  }
  const { palette, note } = extractPaletteFromReplies(data.replies);

  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

  if (!palette) {
    return {
      derived_palette: '',
      match: 'no',
      error: note || 'unknown',
      resolved_image: resolved.source || imageUrl,
    };
  }

  const match = palette === correct ? 'yes' : 'no';
  return {
    derived_palette: palette,
    match,
    error: '',
    resolved_image: resolved.source || imageUrl,
  };
}

function cryptoRandomId() {
  return `u_${Math.random().toString(36).slice(2, 10)}`;
}

function parseArgs(argv) {
  let csvPath = path.join(__dirname, 'dataset.csv');
  let delayMs = 0;
  let outPath = null;
  let preferRemoteFirst = false;
  let reuseUserIds = false;
  let celebDir = process.env.CELEB_IMAGES_DIR || path.join(process.cwd(), 'celeb_images');
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--delay-ms' && argv[i + 1]) {
      delayMs = Number(argv[++i]) || 0;
    } else if (a === '--out' && argv[i + 1]) {
      outPath = argv[++i];
    } else if (a === '--remote-first') {
      preferRemoteFirst = true;
    } else if (a === '--reuse-user-ids') {
      reuseUserIds = true;
    } else if (a === '--celeb-dir' && argv[i + 1]) {
      const p = argv[++i];
      celebDir = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    } else if (!a.startsWith('-')) {
      csvPath = path.isAbsolute(a) ? a : path.join(process.cwd(), a);
    }
  }
  return { csvPath, delayMs, outPath, celebDir, preferRemoteFirst, reuseUserIds };
}

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
  const { csvPath, delayMs, outPath, celebDir, preferRemoteFirst, reuseUserIds } =
    parseArgs(process.argv);

  const evalRunSuffix = reuseUserIds
    ? ''
    : (process.env.EVAL_RUN_ID?.trim() || randomUUID());

  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    console.error('Expected columns: sno, name, gender, correct_palette, derived_palette');
    process.exit(1);
  }

  const celebIndex = buildCelebIndex(celebDir);
  console.error(
    `BASE_URL=${baseUrl}  celeb_dir=${celebDir}  indexed_files=${celebIndex.size}  delay_ms=${delayMs}  prefer_remote_first=${preferRemoteFirst}  reuse_user_ids=${reuseUserIds}  eval_run_suffix=${evalRunSuffix || '(none)'}`,
  );

  const raw = fs.readFileSync(csvPath, 'utf8');
  const { headers, rows } = parseCsv(raw);
  if (headers.length === 0) {
    console.error('Empty CSV');
    process.exit(1);
  }

  let nCorrect = 0;
  let nTotal = 0;

  const outHeaders = [...new Set([...headers, 'derived_palette', 'match', 'eval_error', 'resolved_image'])];

  for (const row of rows) {
    const r = await runOne(baseUrl, row, delayMs, celebIndex, preferRemoteFirst, evalRunSuffix);
    row.derived_palette = r.derived_palette;
    row.match = r.match;
    row.eval_error = r.error || '';
    row.resolved_image = r.resolved_image || '';

    if (r.derived_palette && normalizePalette(row.correct_palette)) {
      nTotal++;
      if (r.match === 'yes') nCorrect++;
    }

    const line = [
      row.sno,
      row.name,
      row.correct_palette,
      row.derived_palette || '(none)',
      row.match || '-',
      row.resolved_image || '-',
      r.error || 'ok',
    ].join('\t');
    console.error(line);
  }

  const summary = nTotal ? `${nCorrect}/${nTotal} exact palette match` : 'no scored rows (check errors)';
  console.error(`\n${summary}`);

  const out = outPath || csvPath.replace(/\.csv$/i, '') + '.results.csv';
  fs.writeFileSync(out, toCsv(outHeaders, rows), 'utf8');
  console.error(`Wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
