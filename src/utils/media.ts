import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { extension as extFromMime } from 'mime-types';
import { createCanvas, loadImage } from 'canvas';

import { BadRequestError, InternalServerError } from './errors';
import { logger } from './logger';
import { ensureDir, userUploadDir } from './paths';

/**
 * Checks if a URL is a data URL (base64 encoded).
 */
export function isDataUrl(url: string): boolean {
  return url.startsWith('data:');
}

/**
 * Checks if the server URL is publicly accessible (not localhost).
 */
export function isPublicServerUrl(): boolean {
  const serverUrl = process.env.SERVER_URL || '';
  return (
    serverUrl.length > 0 &&
    !serverUrl.includes('localhost') &&
    !serverUrl.includes('127.0.0.1') &&
    !serverUrl.includes('0.0.0.0')
  );
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
 * Processes media for use with AI models.
 * 
 * - If the URL is already a data URL, returns it as-is (works locally and in prod)
 * - If in production with public SERVER_URL, downloads and returns public URL
 * - If in development (localhost), downloads and converts to data URL for OpenAI compatibility
 *
 * @param url - Media URL (can be data URL or remote URL)
 * @param userId - User ID for organizing uploads
 * @param mimeType - MIME type (e.g., 'image/jpeg')
 * @returns URL suitable for OpenAI (data URL locally, public URL in production)
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

    const baseUrl = process.env.SERVER_URL?.replace(/\/$/, '') || '';
    const serverUrl = `${baseUrl}/uploads/${userId}/${filename}`;

    // Determine the URL to use for AI
    let aiUrl: string;
    if (isPublicServerUrl()) {
      // Production: Use public URL that OpenAI can access
      aiUrl = serverUrl;
      logger.debug({ userId, filename, mimeType: actualMimeType }, 'Using public URL for AI');
    } else {
      // Development: Use data URL since OpenAI can't access localhost
      aiUrl = bufferToDataUrl(buffer, actualMimeType);
      logger.debug({ userId, filename, mimeType: actualMimeType }, 'Using data URL for AI (localhost)');
    }

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

/**
 * Converts a localhost URL from the database to a data URL for AI compatibility.
 * This handles old messages that were stored with localhost URLs.
 * 
 * @param url - URL that might be a localhost URL
 * @returns Data URL if localhost, original URL otherwise
 */
export async function convertLocalhostUrlToDataUrl(url: string): Promise<string> {
  // If already a data URL or not a localhost URL, return as-is
  if (isDataUrl(url)) {
    return url;
  }

  // Check if it's a localhost URL that needs conversion
  const isLocalhostUrl = 
    url.includes('localhost') || 
    url.includes('127.0.0.1') || 
    url.includes('0.0.0.0');

  if (!isLocalhostUrl) {
    return url;
  }

  try {
    // Extract the file path from the URL (e.g., /uploads/userId/filename.ext)
    const urlObj = new URL(url);
    const uploadsMatch = urlObj.pathname.match(/^\/uploads\/([^/]+)\/(.+)$/);
    
    if (!uploadsMatch || !uploadsMatch[1] || !uploadsMatch[2]) {
      logger.warn({ url }, 'Could not parse localhost URL for conversion');
      return url;
    }

    const userId: string = uploadsMatch[1];
    const filename: string = uploadsMatch[2];
    const filePath = path.join(userUploadDir(userId), filename);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      logger.warn({ url, filePath }, 'File not found for localhost URL conversion');
      return url;
    }

    // Read the file and convert to data URL
    const buffer = await fs.readFile(filePath);
    const ext = path.extname(filename).toLowerCase().slice(1);
    
    // Map extension to MIME type
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
    };
    const mimeType = mimeTypes[ext] || 'image/jpeg';

    const dataUrl = bufferToDataUrl(buffer, mimeType);
    logger.debug({ url, filePath }, 'Converted localhost URL to data URL');
    return dataUrl;
  } catch (err) {
    logger.warn({ url, error: err instanceof Error ? err.message : String(err) }, 'Failed to convert localhost URL');
    return url;
  }
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
