import { createCanvas, loadImage, registerFont } from 'canvas';
import fs from 'fs/promises';
import path from 'path';
import colornames from 'colornames';

import { InternalServerError } from './errors';
import { logger } from './logger';
import { ensureDir, userUploadDir } from './paths';

/**
 * Converts a color name to hex code using colornames library with fallback logic
 */
function colorNameToHex(colorName: string): string {
  const normalized = colorName.toLowerCase().trim();
  
  // Try direct lookup first
  const directMatch = colornames(normalized);
  if (directMatch) return directMatch;
  
  // Try with common variations
  const variations = [
    normalized.replace(/\s+/g, ''), // Remove spaces: "olive green" -> "olivegreen"
    normalized.replace(/\s+/g, '-'), // Replace spaces with hyphens: "olive green" -> "olive-green"
    normalized.replace(/\b(pastel|deep|light|dark|bright|soft|warm|cool|icy|muted)\b/g, '').trim(), // Remove descriptors
  ];
  
  for (const variant of variations) {
    if (variant && variant !== normalized) {
      const match = colornames(variant);
      if (match) return match;
    }
  }
  
  // Try partial matching - check if any color name contains the input or vice versa
  const allColors = colornames.all();
  for (const colorEntry of allColors) {
    const colorNameLower = colorEntry.name.toLowerCase();
    // Check if the input contains the color name or the color name contains the input
    if (normalized.includes(colorNameLower) || colorNameLower.includes(normalized)) {
      // Use the value property from the entry
      if (colorEntry.value) return colorEntry.value;
    }
  }
  
  // Try splitting compound names (e.g., "Olive Green" -> try "olive" and "green")
  const words = normalized.split(/\s+/);
  for (const word of words) {
    if (word.length > 2) { // Skip very short words
      const match = colornames(word);
      if (match) return match;
    }
  }
  
  // Fallback to gray if no match found
  return '#808080';
}

/**
 * Generates a color analysis image with user photo inside the black circle,
 * seasonal palette name in the purple banner (tilted), and swatches (straight).
 */
export async function generateColorAnalysisImage(
  whatsappId: string,
  data: {
    palette_name: string | null;
    colors_suited: Array<{ name: string; hex: string }>;
    colors_to_wear: { clothing: string[]; jewelry: string[] };
    colors_to_avoid: Array<{ name: string; hex: string }>;
    userImageUrl?: string | null;
  },
): Promise<string> {
  // Load base template
  const baseTemplatePath = path.join(process.cwd(), 'templates', 'Color_Analysis.svg');
  const baseTemplateBuffer = await fs.readFile(baseTemplatePath);
  const baseTemplateImg = await loadImage(baseTemplateBuffer);

  // Load banner template
  const bannerTemplatePath = path.join(process.cwd(), 'templates', 'Color_Analysis_banner.svg');
  const bannerTemplateBuffer = await fs.readFile(bannerTemplatePath);
  const bannerTemplateImg = await loadImage(bannerTemplateBuffer);

  const scale = 2;
  const width = baseTemplateImg.width * scale;
  const height = baseTemplateImg.height * scale;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fill background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // 1. Draw Base Template
  ctx.drawImage(baseTemplateImg, 0, 0, width, height);

  const fontFamily = 'Poppins, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const globalTiltAngle = -0.04; // Used for text in banner

  // 2. Draw Color Swatches on top of base template
  const swatchSize = 20 * scale;
  const swatchSpacing = 17 * scale; // Slightly decreased spacing between swatches
  const swatchesPerRow = 4; // 4 swatches total instead of 6

  const drawSwatches = (colors: any[], startX: number, startY: number) => {
    ctx.save();
    // No ctx.rotate() here so they appear straight
    colors.slice(0, 4).forEach((color, index) => { // Limit to 4 swatches
      if (!color || !color.name || !color.hex) {
        logger.warn({ color, index }, 'Skipping color swatch due to missing data');
        return; // Skip if missing data
      }

      const row = Math.floor(index / swatchesPerRow);
      const col = index % swatchesPerRow;

      const x = startX + col * (swatchSize + swatchSpacing);
      const y = startY + row * (swatchSize + 22 * scale);

      logger.debug({ color: color.name, hex: color.hex, x, y, swatchSize }, 'Drawing color swatch');

      // Rounded rectangle swatch - no border
      const radius = 6 * scale; // Rounded corners
      ctx.fillStyle = color.hex;

      // Draw rounded rectangle
      ctx.beginPath();
      ctx.roundRect(x, y, swatchSize, swatchSize, radius);
      ctx.fill();

      // Text - larger and bold
      ctx.fillStyle = '#000000';
      ctx.font = `bold ${30 * scale}px ${fontFamily}`; // Increased to 12 for larger text
      ctx.textAlign = 'center';
      ctx.fillText(color.name, x + swatchSize / 2, y + swatchSize + 16 * scale); // Adjusted y position
    });
    ctx.restore();
  };

  // Suited Colors Position - 220px from top, 28px from left
  drawSwatches(data.colors_suited, 28 * scale, 210 * scale);

  // Avoid Colors Position - 220px from top, 200px from left
  drawSwatches(data.colors_to_avoid, 200 * scale, 210 * scale);

  // 3. Draw User Image as full-width rectangle at left-top
  if (data.userImageUrl) {
    try {
      const userImg = await loadImage(data.userImageUrl);
      const imageWidth = 358 * scale; // Full template width
      const imageHeight = 180 * scale; // 300 pixels from top
      const imageX = 0; // Left aligned
      const imageY = 0; // Top aligned

      ctx.save();
      ctx.beginPath();
      ctx.rect(imageX, imageY, imageWidth, imageHeight);
      ctx.clip();

      // Cover/fit logic for rectangular area
      const aspect = userImg.width / userImg.height;
      let drawW = imageWidth;
      let drawH = imageHeight;
      let offsetX = 0;
      let offsetY = 0;

      if (aspect > imageWidth / imageHeight) {
        // Image is wider than target area - fit height, crop width
        drawH = imageHeight;
        drawW = imageHeight * aspect;
        offsetX = (imageWidth - drawW) / 2;
      } else {
        // Image is taller than target area - fit width, crop height
        drawW = imageWidth;
        drawH = imageWidth / aspect;
        offsetY = (imageHeight - drawH) / 2;
      }

      ctx.drawImage(userImg, imageX + offsetX, imageY + offsetY, drawW, drawH);
      ctx.restore();
    } catch (err) {
      logger.warn({ err: (err as Error)?.message }, 'Failed to load user image');
    }
  }

  // 3. Draw Banner Template on top (scaled to 1/4 size, centered, at 155 height)
  const bannerScale = 0.75; // 1/4 size
  const bannerWidth = bannerTemplateImg.width * scale * bannerScale;
  const bannerHeight = bannerTemplateImg.height * scale * bannerScale;
  const bannerX = (width - bannerWidth) / 2; // Centered horizontally
  const bannerY = 152 * scale; 

  ctx.drawImage(bannerTemplateImg, bannerX, bannerY, bannerWidth, bannerHeight);

  // 4. Draw Palette Name on the banner
  if (data.palette_name) {
    ctx.save();
    ctx.font = `bold ${50 * scale}px ${fontFamily}`; // Smaller font for smaller banner
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';

    // Positioned at the center of the banner
    const textX = bannerX + bannerWidth / 2;
    const textY = bannerY + bannerHeight / 2 + 6 * scale; // Center vertically with slight offset

    ctx.translate(textX, textY);
    ctx.rotate(globalTiltAngle); // Tilt the text to match the banner
    ctx.fillText(data.palette_name.toUpperCase(), 0, 0);
    ctx.restore();
  }



  // 5. Save and Return
  const userDir = userUploadDir(whatsappId);
  await ensureDir(userDir);
  const filename = `color_analysis_${Date.now()}.png`;
  const filepath = path.join(userDir, filename);
  
  await fs.writeFile(filepath, canvas.toBuffer('image/png'));

  const sanitizedId = whatsappId.replace(/[^a-zA-Z0-9_+]/g, '_');
  const relativePath = `/uploads/${sanitizedId}/${filename}`;
  const serverUrl = process.env.SERVER_URL?.replace(/\/$/, '');
  
  return (serverUrl && !serverUrl.includes('localhost')) ? `${serverUrl}${relativePath}` : relativePath;
}

/**
 * Vibe Check Image Generation
 */
export async function generateVibeCheckImage(
  whatsappId: string,
  data: {
    overall_score: number;
    fit_silhouette: { score: number; explanation: string };
    color_harmony: { score: number; explanation: string };
    styling_details: { score: number; explanation: string };
    context_confidence: { score: number; explanation: string };
    userImageUrl?: string | null;
  },
): Promise<string> {
  // Load base template
  const baseTemplatePath = path.join(process.cwd(), 'templates', 'Vibe_check.svg');
  const baseTemplateBuffer = await fs.readFile(baseTemplatePath);
  const baseTemplateImg = await loadImage(baseTemplateBuffer);

  // Load banner template
  const bannerTemplatePath = path.join(process.cwd(), 'templates', 'Vibe_Check_Banner.svg');
  const bannerTemplateBuffer = await fs.readFile(bannerTemplatePath);
  const bannerTemplateImg = await loadImage(bannerTemplateBuffer);

  const scale = 2;
  const width = baseTemplateImg.width * scale;
  const height = baseTemplateImg.height * scale;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fill background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // 1. Draw Base Template
  ctx.drawImage(baseTemplateImg, 0, 0, width, height);

  const fontFamily = 'Poppins, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  // 2. Draw Categories (scores)
  const categoryY = 260 * scale;
  const categories: Array<{ score: number }> = [
    { score: data.fit_silhouette.score },
    { score: data.styling_details.score },
    { score: data.color_harmony.score },
  ];

  const categoryXs = [90 * scale, 175 * scale, 260 * scale];
  categories.forEach((cat, i) => {
    const x = categoryXs[i]!;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${14 * scale}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${(cat.score ?? 0).toFixed(1)}`, x, categoryY);
  });

  // 3. Draw User Image
  if (data.userImageUrl) {
    try {
      const userImg = await loadImage(data.userImageUrl);
      const imageWidth = 358 * scale;
      const imageHeight = 220 * scale;
      const imageX = 0;
      const imageY = 0;

      ctx.save();
      ctx.beginPath();
      ctx.rect(imageX, imageY, imageWidth, imageHeight);
      ctx.clip();

      // Cover/fit logic
      const aspect = userImg.width / userImg.height;
      let drawW = imageWidth;
      let drawH = imageHeight;
      let offsetX = 0;
      let offsetY = 0;

      if (aspect > imageWidth / imageHeight) {
        drawH = imageHeight;
        drawW = imageHeight * aspect;
        offsetX = (imageWidth - drawW) / 2;
      } else {
        drawW = imageWidth;
        drawH = imageWidth / aspect;
        offsetY = (imageHeight - drawH) / 2;
      }

      ctx.drawImage(userImg, imageX + offsetX, imageY + offsetY, drawW, drawH);
      ctx.restore();
    } catch (err) {
      logger.warn({ err: (err as Error)?.message }, 'Failed to load user image');
    }
  }

  // 4. Draw Banner Template
  const bannerScale = 0.75;
  const bannerWidth = bannerTemplateImg.width * scale * bannerScale;
  const bannerHeight = bannerTemplateImg.height * scale * bannerScale;
  const bannerX = 15 * scale;
  const bannerY = 120 * scale;

  ctx.save();
  ctx.translate(bannerX + bannerWidth / 2, bannerY + bannerHeight / 2);
  ctx.rotate(-0.1); // Slight tilt to the left
  ctx.drawImage(bannerTemplateImg, -bannerWidth / 2, -bannerHeight / 2, bannerWidth, bannerHeight);

  // Overall Score over banner (same rotation)
  ctx.font = `bold ${50 * scale}px ${fontFamily}`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.fillText(`${data.overall_score.toFixed(1)}/10`, 0, 0);
  ctx.restore();
  
  const userDir = userUploadDir(whatsappId);
  await ensureDir(userDir);
  const filename = `vibe_check_${Date.now()}.png`;
  const filepath = path.join(userDir, filename);
  await fs.writeFile(filepath, canvas.toBuffer('image/png'));
  
  const sanitizedId = whatsappId.replace(/[^a-zA-Z0-9_+]/g, '_');
  return `/uploads/${sanitizedId}/${filename}`;
}
