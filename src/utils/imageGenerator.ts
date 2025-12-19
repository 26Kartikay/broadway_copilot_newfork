import { createCanvas, loadImage, registerFont } from 'canvas';
import fs from 'fs/promises';
import path from 'path';

import { InternalServerError } from './errors';
import { ensureDir, userUploadDir } from './paths';

// Color name to hex mapping for common colors
const COLOR_MAP: Record<string, string> = {
  // Warm colors
  red: '#FF0000',
  orange: '#FFA500',
  yellow: '#FFFF00',
  gold: '#FFD700',
  coral: '#FF7F50',
  peach: '#FFE5B4',
  // Cool colors
  blue: '#0000FF',
  navy: '#000080',
  teal: '#008080',
  turquoise: '#40E0D0',
  mint: '#98FF98',
  // Neutrals
  black: '#000000',
  white: '#FFFFFF',
  gray: '#808080',
  grey: '#808080',
  beige: '#F5F5DC',
  cream: '#FFFDD0',
  ivory: '#FFFFF0',
  // Purples
  purple: '#800080',
  lavender: '#E6E6FA',
  violet: '#8A2BE2',
  // Greens
  green: '#008000',
  olive: '#808000',
  emerald: '#50C878',
  // Browns
  brown: '#A52A2A',
  tan: '#D2B48C',
  camel: '#C19A6B',
  // Pinks
  pink: '#FFC0CB',
  rose: '#FF007F',
  blush: '#DE5D83',
  // Others
  silver: '#C0C0C0',
  bronze: '#CD7F32',
};

/**
 * Converts a color name to hex code, with fallback
 */
function colorNameToHex(colorName: string): string {
  const normalized = colorName.toLowerCase().trim();
  
  // Direct match
  if (COLOR_MAP[normalized]) {
    return COLOR_MAP[normalized];
  }
  
  // Try partial matches
  for (const [key, hex] of Object.entries(COLOR_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return hex;
    }
  }
  
  // Default fallback
  return '#808080';
}

/**
 * Generates a color analysis image from template
 */
export async function generateColorAnalysisImage(
  whatsappId: string,
  data: {
    palette_name: string | null;
    colors_suited: Array<{ name: string }>;
    colors_to_wear: { clothing: string[]; jewelry: string[] };
    colors_to_avoid: Array<{ name: string }>;
  },
): Promise<string> {
  const templatePath = path.join(process.cwd(), 'templates', 'color_analysis_template.svg');
  const templateBuffer = await fs.readFile(templatePath);
  
  // Load SVG as image (canvas can handle SVG)
  const templateImg = await loadImage(templateBuffer);
  
  // Scale factor for better quality (2x for retina)
  const scale = 2;
  const width = templateImg.width * scale;
  const height = templateImg.height * scale;
  
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Draw template
  ctx.drawImage(templateImg, 0, 0, width, height);
  
  // Set font (Nuething Sans - fallback to system sans-serif if not available)
  const fontSize = 16 * scale;
  const fontFamily = 'Nuething Sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Draw palette name on purple banner (centered on banner, approximately y=280 in original)
  if (data.palette_name) {
    ctx.font = `bold ${18 * scale}px ${fontFamily}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText(data.palette_name, width / 2, 280 * scale);
  }
  
  // Draw "Your Top Colors" section (left button area: x=32-170, y=333-404)
  ctx.font = `bold ${12 * scale}px ${fontFamily}`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  
  const topColorsY = 350 * scale;
  const topColorsX = 50 * scale;
  let currentY = topColorsY;
  
  // Draw color swatches for top colors
  data.colors_suited.slice(0, 5).forEach((color) => {
    const swatchSize = 18 * scale;
    const swatchX = topColorsX;
    const swatchY = currentY;
    
    // Draw color swatch
    ctx.fillStyle = colorNameToHex(color.name);
    ctx.fillRect(swatchX, swatchY, swatchSize, swatchSize);
    
    // Draw border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1 * scale;
    ctx.strokeRect(swatchX, swatchY, swatchSize, swatchSize);
    
    // Draw color name
    ctx.fillStyle = '#000000';
    ctx.font = `${11 * scale}px ${fontFamily}`;
    ctx.fillText(color.name, swatchX + swatchSize + 8 * scale, swatchY + swatchSize / 2);
    
    currentY += swatchSize + 6 * scale;
  });
  
  // Draw "Colors to Avoid" section (right button area: x=196-334, y=333-404)
  const avoidColorsY = 350 * scale;
  const avoidColorsX = 210 * scale;
  currentY = avoidColorsY;
  
  data.colors_to_avoid.slice(0, 5).forEach((color) => {
    const swatchSize = 18 * scale;
    const swatchX = avoidColorsX;
    const swatchY = currentY;
    
    // Draw color swatch
    ctx.fillStyle = colorNameToHex(color.name);
    ctx.fillRect(swatchX, swatchY, swatchSize, swatchSize);
    
    // Draw border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1 * scale;
    ctx.strokeRect(swatchX, swatchY, swatchSize, swatchSize);
    
    // Draw color name
    ctx.fillStyle = '#000000';
    ctx.font = `${11 * scale}px ${fontFamily}`;
    ctx.fillText(color.name, swatchX + swatchSize + 8 * scale, swatchY + swatchSize / 2);
    
    currentY += swatchSize + 6 * scale;
  });
  
  // Save image
  const userDir = userUploadDir(whatsappId);
  await ensureDir(userDir);
  
  const filename = `color_analysis_${Date.now()}.png`;
  const filepath = path.join(userDir, filename);
  
  const buffer = canvas.toBuffer('image/png');
  await fs.writeFile(filepath, buffer);
  
  // Get sanitized ID for URL
  const sanitizedId = whatsappId.replace(/[^a-zA-Z0-9_+]/g, '_');
  const relativePath = `/uploads/${sanitizedId}/${filename}`;
  
  // If SERVER_URL is set and public, return absolute URL, otherwise relative
  const serverUrl = process.env.SERVER_URL?.replace(/\/$/, '');
  if (serverUrl && !serverUrl.includes('localhost') && !serverUrl.includes('127.0.0.1')) {
    return `${serverUrl}${relativePath}`;
  }
  
  return relativePath;
}

/**
 * Generates a vibe check image from template
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
  
  // Load SVG as image
  const templateImg = await loadImage(templateBuffer);
  
  // Scale factor for better quality
  const scale = 2;
  const width = templateImg.width * scale;
  const height = templateImg.height * scale;
  
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Draw template
  ctx.drawImage(templateImg, 0, 0, width, height);
  
  // Set font
  const fontFamily = 'Nuething Sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Draw overall score on orange progress bar (orange shape at approximately y=166-210)
  // The orange bar spans from approximately x=30 to x=115, y=166 to y=210
  const barCenterX = 72 * scale; // Center of orange bar
  const barCenterY = 188 * scale; // Center of orange bar
  
  // Draw score text on the bar
  ctx.font = `bold ${20 * scale}px ${fontFamily}`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  const scoreText = `${data.overall_score.toFixed(1)}/10`;
  ctx.fillText(scoreText, barCenterX, barCenterY);
  
  // Draw category scores at bottom
  // Categories: Fit, Hair & Skin, Accessories, Colors
  // Text appears around y=240, spaced across width
  const categoryY = 245 * scale;
  const categories = [
    { label: 'Fit', score: data.fit_silhouette.score },
    { label: 'Hair & Skin', score: data.color_harmony.score },
    { label: 'Accessories', score: data.styling_details.score },
    { label: 'Colors', score: data.context_confidence.score },
  ];
  
  const categoryWidth = width / 4;
  categories.forEach((category, index) => {
    const categoryX = index * categoryWidth + categoryWidth / 2;
    
    // Draw category label
    ctx.font = `bold ${10 * scale}px ${fontFamily}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText(category.label, categoryX, categoryY);
    
    // Draw score below label
    ctx.font = `bold ${14 * scale}px ${fontFamily}`;
    ctx.fillText(`${category.score.toFixed(1)}`, categoryX, categoryY + 18 * scale);
  });
  
  // Save image
  const userDir = userUploadDir(whatsappId);
  await ensureDir(userDir);
  
  const filename = `vibe_check_${Date.now()}.png`;
  const filepath = path.join(userDir, filename);
  
  const buffer = canvas.toBuffer('image/png');
  await fs.writeFile(filepath, buffer);
  
  // Get sanitized ID for URL
  const sanitizedId = whatsappId.replace(/[^a-zA-Z0-9_+]/g, '_');
  const relativePath = `/uploads/${sanitizedId}/${filename}`;
  
  // If SERVER_URL is set and public, return absolute URL, otherwise relative
  const serverUrl = process.env.SERVER_URL?.replace(/\/$/, '');
  if (serverUrl && !serverUrl.includes('localhost') && !serverUrl.includes('127.0.0.1')) {
    return `${serverUrl}${relativePath}`;
  }
  
  return relativePath;
}

