import { formatColorCombos, shuffleArray } from '../../data/colorAnalysisHelpers';
import {
  getPaletteData,
  isValidPalette,
  resolveSeasonalPalette,
} from '../../data/seasonalPalettes';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { normalizeHttpUrlReference } from '../../utils/serverUrl';
import { isGuestUser } from '../../utils/user';
import { openaiVisionCompletion } from '../openaiVision';
import { setStagedColorAnalysis } from '../memory/redis';
import { analyticsService } from '../../services/analyticsService';
import { randomUUID } from 'crypto';

const COLOR_ANALYSIS_VISION_PROMPT = `
Analyze this person's coloring for seasonal color analysis.
Identify: skin tone, undertone (warm/cool/neutral), eye color, hair color.

STEP 0 — IMAGE QUALITY (faces only for this task)
Set "quality_ok": true if a real human face is clearly visible with enough detail to judge undertone (slight warmth/cool from lighting is OK).
Set "quality_ok": false ONLY for unusable inputs: no face, extreme blur, pitch black, face fully covered, or not a person. If false, set "palette_name": "" and still include "quality_issue": "one short sentence for the user".

You MUST set "palette_name" to exactly ONE of these twelve identifiers (UPPER_SNAKE_CASE, no spaces) when quality_ok is true:
LIGHT_SPRING, TRUE_SPRING, BRIGHT_SPRING, LIGHT_SUMMER, TRUE_SUMMER, SOFT_SUMMER,
SOFT_AUTUMN, TRUE_AUTUMN, DARK_AUTUMN, TRUE_WINTER, BRIGHT_WINTER, DARK_WINTER

Return JSON only in this format:
{
  "quality_ok": true,
  "quality_issue": "",
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
  sourceImageUrl?: string;
  sessionId?: string;
}

export async function analyzeColorSeason(input: ColorAnalysisInput) {
  const { imageBase64, mimeType, userId, skinTone, hairColor, eyeColor, sourceImageUrl, sessionId: providedSessionId } = input;
  const startTime = Date.now();
  const sessionId = providedSessionId || randomUUID();

  analyticsService.track({
    eventName: 'ai_analysis_requested',
    userId,
    sessionId,
    vibeSessionId: sessionId,
    flowType: 'color_analysis',
    platform: 'web',
    properties: {
      model_version: 'gpt-4o',
      image_count: imageBase64 ? 1 : 0,
      user_text_included: !!(skinTone || hairColor || eyeColor),
    },
  });

  try {
    let result: Record<string, unknown>;

    if (imageBase64 && mimeType) {
      const text = await openaiVisionCompletion({
        prompt: COLOR_ANALYSIS_VISION_PROMPT,
        imageBase64,
        mimeType,
        maxTokens: 1024,
      });
      result = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text) as Record<string, unknown>;

      const qOk = result.quality_ok !== false && String(result.quality_ok) !== 'false';
      if (!qOk) {
        analyticsService.track({
          eventName: 'ai_analysis_failed',
          userId,
          sessionId,
          vibeSessionId: sessionId,
          flowType: 'color_analysis',
          platform: 'web',
          properties: {
            error_code: 'QUALITY_REJECT',
            retry_attempted: false,
            latency_ms: Date.now() - startTime,
          },
        });
        return {
          error: String(result.quality_issue || "This photo isn't quite usable for a color read."),
          quality_reject: true,
        };
      }
    } else {
      const textPrompt = `Based on these details: Skin tone: ${skinTone}, Hair: ${hairColor}, Eyes: ${eyeColor}. No photo was supplied — set "quality_ok": true. ${COLOR_ANALYSIS_VISION_PROMPT}`;
      const text = await openaiVisionCompletion({ prompt: textPrompt, maxTokens: 1024 });
      result = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text) as Record<string, unknown>;
    }

    const rawPalette = String(result.palette_name ?? '');
    const canonical =
      resolveSeasonalPalette(rawPalette) ??
      resolveSeasonalPalette(String(result.palette_description ?? ''));

    if (!canonical || !isValidPalette(canonical)) {
      logger.error({ userId, rawPalette }, 'Invalid palette from color analysis vision model');
      analyticsService.track({
        eventName: 'ai_analysis_failed',
        userId,
        sessionId,
        vibeSessionId: sessionId,
        flowType: 'color_analysis',
        platform: 'web',
        properties: {
          error_code: 'INVALID_PALETTE',
          retry_attempted: false,
          latency_ms: Date.now() - startTime,
        },
      });
      return { error: `Invalid palette_name from model: ${rawPalette}` };
    }

    const paletteData = getPaletteData(canonical);

    analyticsService.track({
      eventName: 'ai_analysis_completed',
      userId,
      sessionId,
      vibeSessionId: sessionId,
      flowType: 'color_analysis',
      platform: 'web',
      properties: {
        latency_ms: Date.now() - startTime,
        score_overall: 100,
        score_drip_fit: 0,
        score_hair_skin: 0,
        score_accessories: 0,
        palette_name: canonical,
        top_colors: Array.isArray(result.colors_suited) ? (result.colors_suited as any[]).map(String) : [],
      },
    });

    let userImageUrl: string | null = null;
    if (sourceImageUrl?.trim()) {
      userImageUrl = normalizeHttpUrlReference(sourceImageUrl.trim()) || null;
    }

    const topColors = shuffleArray([...paletteData.topColors]);
    const twoColorCombos = shuffleArray(
      formatColorCombos(paletteData.twoColorCombos, paletteData.topColors),
    );

    const userRow = await prisma.user.findUnique({ where: { id: userId } });
    if (userRow && !isGuestUser(userRow)) {
      await setStagedColorAnalysis(userId, {
        skin_tone: String(result.skin_tone ?? ''),
        eye_color: String(result.eye_color ?? ''),
        hair_color: String(result.hair_color ?? ''),
        undertone: String(result.undertone ?? ''),
        compliment: String(result.compliment ?? ''),
        palette_name: canonical,
        palette_description: paletteData.description,
        colors_suited: Array.isArray(result.colors_suited)
          ? (result.colors_suited as unknown[]).map(String)
          : [],
        colors_to_wear: result.colors_to_wear ?? [],
        colors_to_avoid: result.colors_to_avoid ?? [],
      });
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
    analyticsService.track({
      eventName: 'ai_analysis_failed',
      userId,
      sessionId,
      vibeSessionId: sessionId,
      flowType: 'color_analysis',
      platform: 'web',
      properties: {
        error_code: 'COLOR_ANALYSIS_ERROR',
        retry_attempted: false,
        latency_ms: Date.now() - startTime,
      },
    });
    return { error: String(err) };
  }
}
