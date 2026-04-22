import type OpenAI from 'openai';
import { prisma } from '../../lib/prisma';
import { invalidateContext } from '../memory/redis';
import { logger } from '../../utils/logger';
import { normalizeHttpUrlReference } from '../../utils/serverUrl';
import { formatColorCombos, shuffleArray } from '../../data/colorAnalysisHelpers';
import { getPaletteData, isValidPalette, resolveSeasonalPalette } from '../../data/seasonalPalettes';
import { openaiVisionUserCompletion } from '../openaiVision';

const COLOR_ANALYSIS_VISION_PROMPT = `
Analyze this person's coloring for seasonal color analysis.
Identify: skin tone, undertone (warm/cool/neutral), eye color, hair color.

You MUST set "palette_name" to exactly ONE of these twelve identifiers (UPPER_SNAKE_CASE, no spaces):
LIGHT_SPRING, TRUE_SPRING, BRIGHT_SPRING, LIGHT_SUMMER, TRUE_SUMMER, SOFT_SUMMER,
SOFT_AUTUMN, TRUE_AUTUMN, DARK_AUTUMN, TRUE_WINTER, BRIGHT_WINTER, DARK_WINTER

Return JSON only in this format:
{
  "skin_tone": "Description of skin tone",
  "eye_color": "Description of eye color",
  "hair_color": "Description of hair color",
  "undertone": "warm/cool/neutral",
  "palette_name": "DARK_AUTUMN",
  "palette_description": "Brief description of the palette",
  "compliment": "A brief stylistic compliment about their coloring",
  "colors_suited": ["Color 1", "Color 2"],
  "colors_to_wear": ["Color A", "Color B"],
  "colors_to_avoid": ["Color X", "Color Y"]
}
`;

export interface ColorAnalysisInput {
  imageBase64?: string;
  mimeType?: string;
  skinTone?: string;
  hairColor?: string;
  eyeColor?: string;
  userId: string;
  /** HTTP chat: user's uploaded image URL for the card thumbnail (Prisma Media may not exist yet). */
  sourceImageUrl?: string;
}

export async function analyzeColorSeason(input: ColorAnalysisInput) {
  const { imageBase64, mimeType, userId, skinTone, hairColor, eyeColor, sourceImageUrl } = input;

  try {
    let result: Record<string, unknown>;

    if (imageBase64 && mimeType) {
      const content: OpenAI.Chat.ChatCompletionContentPart[] = [
        {
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${imageBase64}` },
        },
        { type: 'text', text: COLOR_ANALYSIS_VISION_PROMPT },
      ];
      const text = await openaiVisionUserCompletion({ content, max_tokens: 1024 });
      result = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text) as Record<string, unknown>;
    } else {
      const textPrompt = `Based on these details: Skin tone: ${skinTone}, Hair: ${hairColor}, Eyes: ${eyeColor}. ${COLOR_ANALYSIS_VISION_PROMPT}`;
      const text = await openaiVisionUserCompletion({
        content: [{ type: 'text', text: textPrompt }],
        max_tokens: 1024,
      });
      result = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text) as Record<string, unknown>;
    }

    const rawPalette = String(result.palette_name ?? '');
    const canonical =
      resolveSeasonalPalette(rawPalette) ??
      resolveSeasonalPalette(String(result.palette_description ?? ''));

    if (!canonical || !isValidPalette(canonical)) {
      logger.error({ userId, rawPalette }, 'Invalid palette from color analysis vision model');
      return { error: `Invalid palette_name from model: ${rawPalette}` };
    }

    const paletteData = getPaletteData(canonical);
    let userImageUrl: string | null = null;
    if (sourceImageUrl?.trim()) {
      userImageUrl = normalizeHttpUrlReference(sourceImageUrl.trim()) || null;
    }

    const topColors = shuffleArray([...paletteData.topColors]);
    const twoColorCombos = shuffleArray(
      formatColorCombos(paletteData.twoColorCombos, paletteData.topColors),
    );

    const userExists = await prisma.user.findUnique({ where: { id: userId } });
    if (userExists) {
      await prisma.colorAnalysis.create({
        data: {
          userId,
          skin_tone: String(result.skin_tone ?? ''),
          eye_color: String(result.eye_color ?? ''),
          hair_color: String(result.hair_color ?? ''),
          undertone: String(result.undertone ?? ''),
          compliment: String(result.compliment ?? ''),
          palette_name: canonical,
          palette_description: paletteData.description,
          colors_suited: (result.colors_suited as string[]) ?? [],
          colors_to_wear: (result.colors_to_wear as string[]) ?? [],
          colors_to_avoid: (result.colors_to_avoid as string[]) ?? [],
        },
      });

      await prisma.user.update({
        where: { id: userId },
        data: { lastColorAnalysisAt: new Date() },
      });

      await invalidateContext(userId);
    }

    return {
      palette_name: canonical,
      description: paletteData.description,
      top_colors: topColors,
      two_color_combos: twoColorCombos,
      user_image_url: userImageUrl,
      compliment: String(result.compliment ?? ''),
      season: canonical,
    };
  } catch (err) {
    logger.error({ err, userId }, 'Error in analyzeColorSeason tool');
    return { error: String(err) };
  }
}
