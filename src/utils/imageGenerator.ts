import { createCanvas, loadImage, registerFont, CanvasRenderingContext2D } from 'canvas';
import fs from 'fs/promises';
import path from 'path';
import colornames from 'colornames';

import { InternalServerError } from './errors';
import { logger } from './logger';
import { ensureDir, userUploadDir } from './paths';

// Register Poppins fonts for image generation
try {
  registerFont(path.join(process.cwd(), 'fonts', 'Poppins-Regular.ttf'), { family: 'Poppins', weight: 'normal' });
  registerFont(path.join(process.cwd(), 'fonts', 'Poppins-Medium.ttf'), { family: 'Poppins', weight: '500' });
  registerFont(path.join(process.cwd(), 'fonts', 'Poppins-Bold.ttf'), { family: 'Poppins', weight: 'bold' });
  logger.info('Poppins fonts registered successfully');
} catch (error) {
  logger.warn({ error: (error as Error)?.message }, 'Failed to register Poppins fonts');
}

// Helper function to set font with proper error handling
function setFont(ctx: CanvasRenderingContext2D, size: number, weight: 'normal' | 'bold' | '500' = 'normal', scale: number = 1): void {
  try {
    const fontSize = Math.round(size * scale);
    ctx.font = `${weight} ${fontSize}px Poppins, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  } catch (error) {
    logger.warn({ error: (error as Error)?.message }, `Failed to set font: ${weight} ${size}px`);
    // Fallback to system font
    ctx.font = `${weight} ${Math.round(size * scale)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  }
}

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
  const swatchSize = 15 * scale; // Half the previous size (was 20 * scale)
  const swatchSpacing = 15 * scale; // Decreased spacing (was 17 * scale)
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
      const y = startY + row * (swatchSize + 15 * scale); // Increased spacing between rows

      logger.debug({ color: color.name, hex: color.hex, x, y, swatchSize }, 'Drawing color swatch');

      // Rounded rectangle swatch - no border
      const radius = 3 * scale; // Smaller rounded corners for smaller swatches
      ctx.fillStyle = color.hex;

      // Draw rounded rectangle
      ctx.beginPath();
      ctx.roundRect(x, y, swatchSize, swatchSize, radius);
      ctx.fill();

      // Text - bold font for all text, handle multi-line for names with more than 2 words
      ctx.fillStyle = '#000000';
      ctx.font = `bold ${5 * scale}px Poppins`; // Bold font with larger size for readability
      ctx.textAlign = 'center';

      const words = color.name.split(' ');
      if (words.length > 1) {
        // More than 1 word: first word on first line, remaining words on second line
        const firstLine = words[0];
        const secondLine = words.slice(1).join(' ');
        const lineHeight = 6 * scale;
        ctx.fillText(firstLine, x + swatchSize / 2, y + swatchSize + 8 * scale);
        ctx.fillText(secondLine, x + swatchSize / 2, y + swatchSize + 8 * scale + lineHeight);
      } else {
        ctx.fillText(color.name, x + swatchSize / 2, y + swatchSize + 8 * scale);
      }
    });
    ctx.restore();
  };

  // Suited Colors Position - Updated to 30, 300 from template
  drawSwatches(data.colors_suited, 30 * scale, 290 * scale);

  // Avoid Colors Position - Updated to 180, 300 from template
  drawSwatches(data.colors_to_avoid, 180 * scale, 290 * scale);

  // 3. Draw User Image centered according to new template
  if (data.userImageUrl) {
    try {
      const userImg = await loadImage(data.userImageUrl);
      const imageWidth = 293 * scale; // Template width (293px)
      const imageHeight = 200 * scale; // Appropriate height for centering
      const imageX = (width - imageWidth) / 2; // Centered horizontally
      const imageY = 50 * scale; // Positioned from top

      ctx.save();
      ctx.beginPath();
      ctx.rect(imageX, imageY, imageWidth, imageHeight);
      ctx.clip();

      // Fit to frame logic - show entire image, centered
      const aspect = userImg.width / userImg.height;
      const frameAspect = imageWidth / imageHeight;
      let drawW, drawH, offsetX, offsetY;

      if (aspect > frameAspect) {
        // Image is wider - fit to width, center vertically
        drawW = imageWidth;
        drawH = imageWidth / aspect;
        offsetX = 0;
        offsetY = (imageHeight - drawH) / 2;
      } else {
        // Image is taller - fit to height, center horizontally
        drawH = imageHeight;
        drawW = imageHeight * aspect;
        offsetX = (imageWidth - drawW) / 2;
        offsetY = 0;
      }

      ctx.drawImage(userImg, imageX + offsetX, imageY + offsetY, drawW, drawH);
      ctx.restore();
    } catch (err) {
      logger.warn({ err: (err as Error)?.message }, 'Failed to load user image');
    }
  }

  // 3. Draw Banner Template on top (centered horizontally at 260px Y position)
  const bannerScale = 0.75; // 1/4 size
  const bannerWidth = bannerTemplateImg.width * scale * bannerScale;
  const bannerHeight = bannerTemplateImg.height * scale * bannerScale;
  const bannerX = (293 / 2 - bannerTemplateImg.width * bannerScale / 2) * scale; // Center horizontally (293px template width)
  const bannerY = 235 * scale; // Updated Y position

  ctx.drawImage(bannerTemplateImg, bannerX, bannerY, bannerWidth, bannerHeight);

  // 4. Draw Palette Name on the banner
  if (data.palette_name) {
    ctx.save();
    ctx.font = `bold ${12 * scale}px Poppins`; // Bold font
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';

    // Positioned at the center of the banner
    const textX = bannerX + bannerWidth / 2;
    const textY = bannerY + bannerHeight / 2 + 10 * scale; // Center vertically with slight offset (moved 5 pixels down)

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
    comment?: string;
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

// 2. Draw Categories (scores) - positioned at 190px scaled Y coordinate
const categoryTextY = 190 * scale; // Position at 190px scaled

const categories = [
  { score: data.fit_silhouette.score },
  { score: data.styling_details.score },
  { score: data.color_harmony.score },
];

const categoryXs = [72 * scale, 130 * scale, 200 * scale];

const categoryColors = ['#eb92aa', '#75cfe7', '#a57bc4'];

ctx.save();
ctx.font = `bold ${18 * scale}px Poppins`; // Bold font
ctx.textAlign = 'center';
ctx.textBaseline = 'middle'; // 🔥 CRITICAL FIX

categories.forEach((cat, i) => {
  ctx.fillStyle = categoryColors[i]!;
  ctx.fillText(
    `${(cat.score ?? 0).toFixed(1)}`,
    categoryXs[i]!,
    categoryTextY
  );
});

ctx.restore();


  // 3. Draw User Image centered according to template - cropped to 80% height to show scores
  if (data.userImageUrl) {
    try {
      const userImg = await loadImage(data.userImageUrl);
      const imageWidth = 286 * scale; // Template black rectangle width
      const imageHeight = 167 * scale; // Template height reduced by 5% (176 * 0.95 ≈ 167)
      const imageX = (293 / 2 - 286 / 2) * scale; // Center horizontally in 293px template
      const imageY = 0; // Start from top like template

      ctx.save();
      ctx.beginPath();
      ctx.rect(imageX, imageY, imageWidth, imageHeight);
      ctx.clip();

      // Fit to frame logic - show entire image, centered
      const aspect = userImg.width / userImg.height;
      const frameAspect = imageWidth / imageHeight;
      let drawW, drawH, offsetX, offsetY;

      if (aspect > frameAspect) {
        // Image is wider - fit to width, center vertically
        drawW = imageWidth;
        drawH = imageWidth / aspect;
        offsetX = 0;
        offsetY = (imageHeight - drawH) / 2;
      } else {
        // Image is taller - fit to height, center horizontally
        drawH = imageHeight;
        drawW = imageHeight * aspect;
        offsetX = (imageWidth - drawW) / 2;
        offsetY = 0;
      }

      ctx.drawImage(userImg, imageX + offsetX, imageY + offsetY, drawW, drawH);
      ctx.restore();
    } catch (err) {
      logger.warn({ err: (err as Error)?.message }, 'Failed to load user image');
    }
  }

  // 4. Draw Comment on top left (on top layer)
  if (data.comment) {
    ctx.save();
    ctx.font = `500 ${10 * scale}px Poppins`; // Medium weight, smaller font
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';

    const maxWidth = 120 * scale; // Max width for text wrapping
    const lineHeight = 12 * scale;
    const x = 20 * scale; // Top left position
    const y = 20 * scale;

    // Simple text wrapping
    const words = data.comment.split(' ');
    let line = '';
    let currentY = y;

    for (const word of words) {
      const testLine = line + word + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && line !== '') {
        ctx.fillText(line.trim(), x, currentY);
        line = word + ' ';
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line.trim(), x, currentY);
    ctx.restore();
  }

  // 5. Draw Banner Template
  const bannerScale = 0.75; // Scaled to 0.75 of overall rating
  const bannerWidth = bannerTemplateImg.width * scale * bannerScale;
  const bannerHeight = bannerTemplateImg.height * scale * bannerScale;
  const bannerX = 15 * scale;
  const bannerY = 100 * scale;

  ctx.save();
  ctx.translate(bannerX + bannerWidth / 2, bannerY + bannerHeight / 2);
  ctx.rotate(-0.1); // Slight tilt to the left
  ctx.drawImage(bannerTemplateImg, -bannerWidth / 2, -bannerHeight / 2, bannerWidth, bannerHeight);

  // Overall Score over banner (same rotation)
  ctx.font = `bold ${17 * scale}px Poppins`; // Bold font
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.fillText(`${data.overall_score.toFixed(1)}/10`, 0, 15 * scale); // Move 15px down total
  ctx.restore();
  
  const userDir = userUploadDir(whatsappId);
  await ensureDir(userDir);
  const filename = `vibe_check_${Date.now()}.png`;
  const filepath = path.join(userDir, filename);
  await fs.writeFile(filepath, canvas.toBuffer('image/png'));
  
  const sanitizedId = whatsappId.replace(/[^a-zA-Z0-9_+]/g, '_');
  return `/uploads/${sanitizedId}/${filename}`;
}
