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
    colors_suited: Array<{ name: string }>;
    colors_to_wear: { clothing: string[]; jewelry: string[] };
    colors_to_avoid: Array<{ name: string }>;
    userImageUrl?: string | null;
  },
): Promise<string> {
  const templatePath = path.join(process.cwd(), 'templates', 'color_analysis_template.svg');
  const templateBuffer = await fs.readFile(templatePath);
  const templateImg = await loadImage(templateBuffer);

  const scale = 2;
  const width = templateImg.width * scale;
  const height = templateImg.height * scale;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fill background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // 1. Draw Template Background
  ctx.drawImage(templateImg, 0, 0, width, height);

  const fontFamily = 'Nuething Sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const globalTiltAngle = -0.04; // Used for text in banner

  // 2. Draw User Image INSIDE the black circular part of the template
  if (data.userImageUrl) {
    try {
      const userImg = await loadImage(data.userImageUrl);
      // Coordinates adjusted to center within the black circle of the template
      const imageSize = 180 * scale; 
      const centerX = width / 2;
      const centerY = 135 * scale; // Positioned within the black top area

      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, imageSize / 2, 0, Math.PI * 2);
      ctx.clip();
      
      // Aspect ratio correction (Center Crop)
      const aspect = userImg.width / userImg.height;
      let drawW = imageSize;
      let drawH = imageSize;
      let offsetX = 0;
      let offsetY = 0;

      if (aspect > 1) {
          drawW = imageSize * aspect;
          offsetX = (imageSize - drawW) / 2;
      } else {
          drawH = imageSize / aspect;
          offsetY = (imageSize - drawH) / 2;
      }

      ctx.drawImage(userImg, centerX - imageSize / 2 + offsetX, centerY - imageSize / 2 + offsetY, drawW, drawH);
      ctx.restore();
    } catch (err) {
      logger.warn({ err: (err as Error)?.message }, 'Failed to load user image');
    }
  }

  // 3. Draw Palette Name in Purple Banner (Tilted)
  if (data.palette_name) {
    ctx.save();
    ctx.font = `bold ${22 * scale}px ${fontFamily}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    
    // Positioned in the purple banner area
    const bannerX = width / 2;
    const bannerY = 275 * scale; 
    
    ctx.translate(bannerX, bannerY);
    ctx.rotate(globalTiltAngle); // Tilt the text to match the banner
    ctx.fillText(data.palette_name.toUpperCase(), 0, 0);
    ctx.restore();
  }

  // 4. Draw Color Swatches (Normal / Not Tilted)
  const swatchSize = 18 * scale;
  const swatchSpacing = 10 * scale;
  const swatchesPerRow = 3;

  const drawSwatches = (colors: any[], startX: number, startY: number) => {
    ctx.save();
    // No ctx.rotate() here so they appear straight
    colors.slice(0, 6).forEach((color, index) => {
      const row = Math.floor(index / swatchesPerRow);
      const col = index % swatchesPerRow;
      
      const x = startX + col * (swatchSize + swatchSpacing);
      const y = startY + row * (swatchSize + 22 * scale);

      // Swatch Box
      ctx.fillStyle = colorNameToHex(color.name);
      ctx.fillRect(x, y, swatchSize, swatchSize);
      
      // Border
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1 * scale;
      ctx.strokeRect(x, y, swatchSize, swatchSize);
      
      // Text
      ctx.fillStyle = '#000000';
      ctx.font = `bold ${8 * scale}px ${fontFamily}`;
      ctx.textAlign = 'center';
      ctx.fillText(color.name, x + swatchSize / 2, y + swatchSize + 12 * scale);
    });
    ctx.restore();
  };

  // Suited Colors Position
  drawSwatches(data.colors_suited, 55 * scale, 360 * scale);
  
  // Avoid Colors Position
  drawSwatches(data.colors_to_avoid, 215 * scale, 360 * scale);

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
  },
): Promise<string> {
  const templatePath = path.join(process.cwd(), 'templates', 'vibe_check_template.svg');
  const templateBuffer = await fs.readFile(templatePath);
  const templateImg = await loadImage(templateBuffer);
  
  const scale = 2;
  const width = templateImg.width * scale;
  const height = templateImg.height * scale;
  
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  ctx.drawImage(templateImg, 0, 0, width, height);
  
  const fontFamily = 'Nuething Sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  
  // Overall Score
  const barCenterX = 72 * scale;
  const barCenterY = 188 * scale;
  ctx.font = `bold ${20 * scale}px ${fontFamily}`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.fillText(`${data.overall_score.toFixed(1)}/10`, barCenterX, barCenterY);
  
  // Categories
  const categoryY = 245 * scale;
  const categories = [
    { label: 'Fit', score: data.fit_silhouette.score },
    { label: 'Hair & Skin', score: data.color_harmony.score },
    { label: 'Accessories', score: data.styling_details.score },
    { label: 'Colors', score: data.context_confidence.score },
  ];
  
  const categoryWidth = width / 4;
  categories.forEach((cat, i) => {
    const x = i * categoryWidth + categoryWidth / 2;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${10 * scale}px ${fontFamily}`;
    ctx.fillText(cat.label, x, categoryY);
    ctx.font = `bold ${14 * scale}px ${fontFamily}`;
    ctx.fillText(`${cat.score.toFixed(1)}`, x, categoryY + 18 * scale);
  });
  
  const userDir = userUploadDir(whatsappId);
  await ensureDir(userDir);
  const filename = `vibe_check_${Date.now()}.png`;
  const filepath = path.join(userDir, filename);
  await fs.writeFile(filepath, canvas.toBuffer('image/png'));
  
  const sanitizedId = whatsappId.replace(/[^a-zA-Z0-9_+]/g, '_');
  return `/uploads/${sanitizedId}/${filename}`;
}