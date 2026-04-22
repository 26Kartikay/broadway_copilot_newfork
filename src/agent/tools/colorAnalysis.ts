import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../lib/prisma';
import { invalidateContext } from '../memory/redis';
import { logger } from '../../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const VISION_MODEL = "claude-opus-4-7";

const COLOR_ANALYSIS_VISION_PROMPT = `
Analyze this person's coloring for seasonal color analysis.
Identify: skin tone, undertone (warm/cool/neutral), eye color, hair color.
Determine their color season from: Soft Autumn, True Autumn, Dark Autumn,
Soft Summer, True Summer, Light Summer, True Spring, Light Spring, Warm Spring,
True Winter, Dark Winter, Bright Winter.

Return JSON only in this format:
{
  "skin_tone": "Description of skin tone",
  "eye_color": "Description of eye color",  
  "hair_color": "Description of hair color",
  "undertone": "warm/cool/neutral",
  "palette_name": "Full Season Name",
  "palette_description": "Brief description of the palette",
  "compliment": "A brief stylistic compliment about their coloring",
  "colors_suited": ["Color 1", "Color 2", ...],
  "colors_to_wear": ["Color A", "Color B", ...],
  "colors_to_avoid": ["Color X", "Color Y", ...]
}
`;

export interface ColorAnalysisInput {
  imageBase64?: string;
  mimeType?: string;
  skinTone?: string;
  hairColor?: string;
  eyeColor?: string;
  userId: string;
}

export async function analyzeColorSeason(input: ColorAnalysisInput) {
  const { imageBase64, mimeType, userId, skinTone, hairColor, eyeColor } = input;

  try {
    let result: any;

    if (imageBase64 && mimeType) {
      const response = await anthropic.messages.create({
        model: VISION_MODEL,
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType as any,
                data: imageBase64
              }
            },
            {
              type: "text",
              text: COLOR_ANALYSIS_VISION_PROMPT
            }
          ]
        }]
      });

      const text = (response.content[0] as any).text;
      result = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text);
    } else {
      // Handle text-only description fallback
      const textPrompt = `Based on these details: Skin tone: ${skinTone}, Hair: ${hairColor}, Eyes: ${eyeColor}. ${COLOR_ANALYSIS_VISION_PROMPT}`;
      const response = await anthropic.messages.create({
        model: "claude-opus-4-7",
        max_tokens: 1024,
        messages: [{ role: "user", content: textPrompt }]
      });
      const text = (response.content[0] as any).text;
      result = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text);
    }

    const userExists = await prisma.user.findUnique({ where: { id: userId } });
    if (userExists) {
      // Save to Prisma
      await prisma.colorAnalysis.create({
        data: {
          userId,
          skin_tone: result.skin_tone,
          eye_color: result.eye_color,
          hair_color: result.hair_color,
          undertone: result.undertone,
          compliment: result.compliment,
          palette_name: result.palette_name,
          palette_description: result.palette_description,
          colors_suited: result.colors_suited,
          colors_to_wear: result.colors_to_wear,
          colors_to_avoid: result.colors_to_avoid
        }
      });

      // Update User
      await prisma.user.update({
        where: { id: userId },
        data: { lastColorAnalysisAt: new Date() }
      });

      // Invalidate Redis cache
      await invalidateContext(userId);
    }

    return {
      season: result.palette_name,
      description: result.palette_description,
      compliment: result.compliment
    };

  } catch (err) {
    logger.error({ err, userId }, 'Error in analyzeColorSeason tool');
    return { error: String(err) };
  }
}
