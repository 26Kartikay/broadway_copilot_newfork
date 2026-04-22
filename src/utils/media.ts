import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { createCanvas, loadImage } from 'canvas';
import { extension as extFromMime } from 'mime-types';

import { BadRequestError, InternalServerError } from './errors';
import { logger } from './logger';
import { ensureDir, userUploadDir } from './paths';
import { getServerUrlBase, normalizeHttpUrlReference } from './serverUrl';

/**
 * Checks if a URL is a data URL (base64 encoded).
 */
export function isDataUrl(url: string): boolean {
  return url.startsWith('data:');
}

/**
 * Converts a data URL to a Buffer.
 */
export function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches || !matches[1] || !matches[2]) {
    throw new BadRequestError('Invalid data URL format');
  }
  const mimeType: string = matches[1];
  const base64Data: string = matches[2];
  const buffer = Buffer.from(base64Data, 'base64');
  return { buffer, mimeType };
}

/**
 * Converts a Buffer to a data URL.
 */
export function bufferToDataUrl(buffer: Buffer, mimeType: string): string {
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Compresses and resizes an image to reduce file size.
 *
 * @param buffer - Image buffer
 * @param mimeType - Original MIME type
 * @param maxWidth - Maximum width in pixels (default: 1920)
 * @param maxHeight - Maximum height in pixels (default: 1920)
 * @param quality - JPEG quality 0-1 (default: 0.85)
 * @returns Compressed image buffer and updated MIME type
 */
export async function compressImage(
  buffer: Buffer,
  mimeType: string,
  maxWidth: number = 1920,
  maxHeight: number = 1920,
  quality: number = 0.85,
): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    // Only compress image types
    if (!mimeType.startsWith('image/')) {
      return { buffer, mimeType };
    }

    // Load image from buffer
    const img = await loadImage(buffer);

    // Calculate new dimensions while maintaining aspect ratio
    let width = img.width;
    let height = img.height;

    if (width <= maxWidth && height <= maxHeight) {
      // Image is already small enough, return as-is
      return { buffer, mimeType };
    }

    if (width > height) {
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
    } else {
      if (height > maxHeight) {
        width = Math.round((width * maxHeight) / height);
        height = maxHeight;
      }
    }

    // Create canvas and draw resized image
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    // Convert to JPEG for better compression (unless it's PNG with transparency or WebP)
    const isPng = mimeType === 'image/png';
    const isWebP = mimeType === 'image/webp';
    const outputMimeType = isPng || isWebP ? mimeType : 'image/jpeg';

    // Convert canvas to buffer
    let compressedBuffer: Buffer;
    if (outputMimeType === 'image/png') {
      compressedBuffer = canvas.toBuffer('image/png');
    } else {
      compressedBuffer = canvas.toBuffer('image/jpeg', { quality });
    }

    logger.debug(
      {
        originalSize: buffer.length,
        compressedSize: compressedBuffer.length,
        reduction: `${((1 - compressedBuffer.length / buffer.length) * 100).toFixed(1)}%`,
        originalDimensions: `${img.width}x${img.height}`,
        newDimensions: `${width}x${height}`,
        mimeType: outputMimeType,
      },
      'Image compressed',
    );

    return { buffer: compressedBuffer, mimeType: outputMimeType };
  } catch (error) {
    // If compression fails, return original buffer
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), mimeType },
      'Failed to compress image, using original',
    );
    return { buffer, mimeType };
  }
}

/**
 * Processes media for use with AI models: saves under uploads, returns a data URL for vision
 * and a public `serverUrl` for clients/DB (built from {@link getServerUrlBase}).
 *
 * @param url - Media URL (can be data URL or remote URL)
 * @param userId - User ID for organizing uploads
 * @param mimeType - MIME type (e.g., 'image/jpeg')
 * @returns `aiUrl` as data URL for vision (OpenAI never fetches our URLs). `serverUrl` is the public URL for clients/DB.
 */
export async function processMediaForAI(
  url: string,
  userId: string,
  mimeType: string,
): Promise<{ aiUrl: string; serverUrl: string }> {
  if (!mimeType) {
    throw new BadRequestError('MIME type is required');
  }

  try {
    let buffer: Buffer;
    let actualMimeType = mimeType;

    // If it's a data URL, extract the buffer
    if (isDataUrl(url)) {
      const result = dataUrlToBuffer(url);
      buffer = result.buffer;
      actualMimeType = result.mimeType;
    } else {
      // Download from remote URL
      const response = await fetch(url);
      if (!response.ok) {
        throw new InternalServerError(`Failed to download media: ${response.status}`);
      }
      buffer = Buffer.from(await response.arrayBuffer());
    }

    // Compress image to reduce storage usage
    const compressed = await compressImage(buffer, actualMimeType);
    buffer = compressed.buffer;
    actualMimeType = compressed.mimeType;

    // Save to local filesystem
    const extension = extFromMime(actualMimeType);
    const filename = `media_${randomUUID()}${extension ? `.${extension}` : ''}`;
    const uploadDir = userUploadDir(userId);
    await ensureDir(uploadDir);
    const filePath = path.join(uploadDir, filename);
    await fs.writeFile(filePath, buffer);

    const baseUrl = getServerUrlBase();
    const serverUrl = `${baseUrl}/uploads/${userId}/${filename}`;

    // Vision: always data URL so OpenAI does not fetch SERVER_URL (often blocked, wrong host, or /chatbot-only edge).
    const aiUrl = bufferToDataUrl(buffer, actualMimeType);
    logger.debug({ userId, filename, mimeType: actualMimeType }, 'Using data URL for AI (OpenAI fetch bypass)');

    logger.debug(
      { userId, filename, filePath, mimeType: actualMimeType, size: buffer.length },
      'Media processed and saved',
    );

    return { aiUrl, serverUrl };
  } catch (err: unknown) {
    if (err instanceof BadRequestError || err instanceof InternalServerError) {
      throw err;
    }
    throw new InternalServerError('Failed to process media', { cause: err });
  }
}

function mimeTypeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase().slice(1);
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return mimeTypes[ext] || 'image/jpeg';
}

function parseUploadsPath(url: string): { userId: string; filename: string } | null {
  try {
    const urlObj = new URL(url);
    const uploadsMatch = urlObj.pathname.match(/^\/uploads\/([^/]+)\/(.+)$/);
    if (!uploadsMatch?.[1] || !uploadsMatch[2]) return null;
    return { userId: uploadsMatch[1], filename: uploadsMatch[2] };
  } catch {
    return null;
  }
}

/**
 * Resolves stored image URLs to data URLs for vision models (avoids OpenAI fetching HTTPS URLs).
 */
export async function resolveImageUrlForVisionModels(url: string): Promise<string> {
  if (isDataUrl(url)) {
    return url;
  }

  const normalized = normalizeHttpUrlReference(url);

  const parsed = parseUploadsPath(normalized);
  if (parsed) {
    const filePath = path.join(userUploadDir(parsed.userId), parsed.filename);
    try {
      await fs.access(filePath);
      const buffer = await fs.readFile(filePath);
      const mimeType = mimeTypeFromFilename(parsed.filename);
      logger.debug({ url: normalized.slice(0, 120), filePath }, 'Resolved uploads URL from disk for vision');
      return bufferToDataUrl(buffer, mimeType);
    } catch {
      logger.debug({ url: normalized.slice(0, 120), filePath }, 'Uploads file not on disk; trying HTTP fetch');
    }
  }

  try {
    const signal = AbortSignal.timeout(25_000);
    const response = await fetch(normalized, {
      signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'BroadwayCopilot/1.0 (vision-prefetch)' },
    });
    if (!response.ok) {
      throw new InternalServerError(
        `Could not fetch image for vision (HTTP ${response.status}): ${normalized.slice(0, 200)}`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const ct = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
    logger.debug({ url: normalized.slice(0, 120) }, 'Resolved image URL via HTTP fetch for vision');
    return bufferToDataUrl(buffer, ct);
  } catch (err: unknown) {
    if (err instanceof InternalServerError) throw err;
    logger.error(
      { url: normalized.slice(0, 200), err: err instanceof Error ? err.message : String(err) },
      'Failed to resolve image URL for vision models',
    );
    throw new InternalServerError('Could not load image for analysis.', { cause: err });
  }
}

/** @deprecated Use {@link resolveImageUrlForVisionModels} */
export async function convertLocalhostUrlToDataUrl(url: string): Promise<string> {
  return resolveImageUrlForVisionModels(url);
}

/**
 * Downloads media from a URL and saves it locally.
 * @deprecated Use processMediaForAI instead for better local/production handling.
 */
export async function downloadMedia(
  url: string,
  userId: string,
  mimeType: string,
): Promise<string> {
  const { aiUrl } = await processMediaForAI(url, userId, mimeType);
  return aiUrl;
}

/**
 * @deprecated Use processMediaForAI instead.
 */
export const downloadTwilioMedia = downloadMedia;
