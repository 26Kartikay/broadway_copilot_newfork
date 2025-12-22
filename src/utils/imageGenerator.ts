import { createCanvas, loadImage, registerFont } from 'canvas';
import fs from 'fs/promises';
import path from 'path';

import { InternalServerError } from './errors';
import { logger } from './logger';
import { ensureDir, userUploadDir } from './paths';

// Color name to hex mapping
const COLOR_MAP: Record<string, string> = {
  red: '#FF0000',
  orange: '#FFA500',
  yellow: '#FFFF00',
  gold: '#FFD700',
  coral: '#FF7F50',
  peach: '#FFE5B4',
  terracotta: '#E2725B',
  rust: '#B7410E',
  mustard: '#FFDB58',
  blue: '#0000FF',
  navy: '#000080',
  teal: '#008080',
  turquoise: '#40E0D0',
  mint: '#98FF98',
  black: '#000000',
  white: '#FFFFFF',
  gray: '#808080',
  grey: '#808080',
  'cool gray': '#8C92AC',
  beige: '#F5F5DC',
  cream: '#FFFDD0',
  ivory: '#FFFFF0',
  purple: '#800080',
  lavender: '#E6E6FA',
  violet: '#8A2BE2',
  green: '#008000',
  olive: '#808000',
  emerald: '#50C878',
  brown: '#A52A2A',
  tan: '#D2B48C',
  camel: '#C19A6B',
  pink: '#FFC0CB',
  rose: '#FF007F',
  blush: '#DE5D83',
  silver: '#C0C0C0',
  bronze: '#CD7F32',
};

function colorNameToHex(colorName: string): string {
  const normalized = colorName.toLowerCase().trim();
  if (COLOR_MAP[normalized]) return COLOR_MAP[normalized];
  
  for (const [key, hex] of Object.entries(COLOR_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) return hex;
  }
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