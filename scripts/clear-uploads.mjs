#!/usr/bin/env node
/**
 * Standalone: delete all files under ./uploads (same root as the app uses).
 * Usage: node scripts/clear-uploads.mjs
 */
import fs from 'fs/promises';
import path from 'path';

const root = path.resolve(process.cwd(), 'uploads');

async function countFilesRecursive(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return 0;
    throw err;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      total += await countFilesRecursive(full);
    } else {
      total += 1;
    }
  }
  return total;
}

const fileCountBefore = await countFilesRecursive(root);
console.log(
  JSON.stringify({
    phase: 'before',
    root,
    fileCountBefore,
    note: 'recursive count (nested dirs included)',
  }),
);

let deleted = 0;

async function purgeDir(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await purgeDir(full);
      await fs.rm(full, { recursive: false }).catch(() => {});
    } else {
      await fs.unlink(full);
      deleted += 1;
    }
  }
}

await purgeDir(root);

const fileCountAfter = await countFilesRecursive(root);
console.log(
  JSON.stringify({
    phase: 'after',
    root,
    fileCountBefore,
    deletedFiles: deleted,
    fileCountAfter,
  }),
);
