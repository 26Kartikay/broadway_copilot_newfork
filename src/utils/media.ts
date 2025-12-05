import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { extension as extFromMime } from 'mime-types';

import { BadRequestError, InternalServerError } from './errors';
import { logger } from './logger';
import { ensureDir, userUploadDir } from './paths';

/**
 * Downloads media from a URL and saves it locally.
 *
 * @param url - Media URL to download from
 * @param userId - User ID for organizing uploads in user directory
 * @param mimeType - MIME type (e.g., 'image/jpeg')
 * @returns Public URL to the downloaded file
 */
export async function downloadMedia(
  url: string,
  userId: string,
  mimeType: string,
): Promise<string> {
  if (!mimeType) {
    throw new BadRequestError('MIME type is required');
  }

  try {
    const extension = extFromMime(mimeType);
    const filename = `media_${randomUUID()}${extension ? `.${extension}` : ''}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new InternalServerError(`Failed to download media: ${response.status}`);
    }

    const uploadDir = userUploadDir(userId);
    await ensureDir(uploadDir);
    const filePath = path.join(uploadDir, filename);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    const baseUrl = process.env.SERVER_URL?.replace(/\/$/, '') || '';
    const publicUrl = `${baseUrl}/uploads/${userId}/${filename}`;
    logger.debug(
      { userId, filename, filePath, mimeType, size: buffer.length },
      'Media downloaded and saved',
    );

    return publicUrl;
  } catch (err: unknown) {
    throw new InternalServerError('Failed to download media', {
      cause: err,
    });
  }
}

/**
 * @deprecated Use downloadMedia instead. This function is kept for backward compatibility.
 */
export const downloadTwilioMedia = downloadMedia;
