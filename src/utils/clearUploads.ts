import fs from 'fs/promises';
import path from 'path';

import { logger } from './logger';
import { staticUploadsMount } from './paths';

async function countFilesRecursive(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as NodeJS.ErrnoException).code
        : undefined;
    if (code === 'ENOENT') {
      return 0;
    }
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

/**
 * Deletes all files under the app uploads root (user subfolders included).
 * Removes empty subdirectories; leaves the root `uploads` directory in place.
 */
export async function clearUploadsDirectory(): Promise<number> {
  const root = staticUploadsMount();
  const fileCountBefore = await countFilesRecursive(root);

  logger.info(
    { root, fileCountBefore },
    'Uploads purge starting (recursive file count, nested dirs included)',
  );

  let deleted = 0;

  async function purgeDir(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as NodeJS.ErrnoException).code
          : undefined;
      if (code === 'ENOENT') {
        return;
      }
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

  logger.info(
    {
      root,
      fileCountBefore,
      deletedFiles: deleted,
      fileCountAfter,
    },
    'Uploads directory purge completed',
  );

  return deleted;
}
