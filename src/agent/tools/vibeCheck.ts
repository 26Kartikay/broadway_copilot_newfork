import type OpenAI from 'openai';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { normalizeHttpUrlReference } from '../../utils/serverUrl';
import { openaiVisionUserCompletion } from '../openaiVision';

/** Same JSON shape as legacy vibeCheck node (vision LLM structured output). */
const VIBE_CHECK_PROMPT = `
Analyze this outfit as a Broadway fashion stylist.

Return JSON only in this exact shape (scores 0–10, fractional allowed):
{
  "comment": "Overall stylish commentary on the outfit.",
  "fit": { "score": 0, "explanation": "Assessment of fit and silhouette." },
  "hair_and_skin": { "score": 0, "explanation": "Hair styling and skin / color harmony." },
  "accessories": { "score": 0, "explanation": "Accessories and finishing details." },
  "recommendations": ["Actionable style suggestion 1", "Suggestion 2"],
  "identified_outfit": "Short description of main items (e.g. blue denim jacket and white chinos).",
  "prompt": "The user context or image context you analyzed.",
  "follow_up": "One short follow-up question to keep the chat going."
}
`;

const MIN_SCORE = 6.0;

export interface VibeCheckInput {
  userId: string;
  imageBase64?: string;
  mimeType?: string;
  description?: string;
  sourceImageUrl?: string;
}

function clampScore(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (Number.isNaN(v)) return MIN_SCORE;
  return Math.max(MIN_SCORE, Math.min(10, v));
}

export async function vibeCheck(input: VibeCheckInput) {
  const { userId, imageBase64, mimeType, description, sourceImageUrl } = input;

  try {
    let result: Record<string, unknown>;

    if (imageBase64 && mimeType) {
      const content: OpenAI.Chat.ChatCompletionContentPart[] = [
        {
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${imageBase64}` },
        },
        { type: 'text', text: VIBE_CHECK_PROMPT },
      ];
      const text = await openaiVisionUserCompletion({ content, max_tokens: 1024 });
      result = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text) as Record<string, unknown>;
    } else {
      const textPrompt = `Analyze this outfit description: ${description ?? ''}. ${VIBE_CHECK_PROMPT}`;
      const text = await openaiVisionUserCompletion({
        content: [{ type: 'text', text: textPrompt }],
        max_tokens: 1024,
      });
      result = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text) as Record<string, unknown>;
    }

    let fitRaw = result.fit as { score?: number; explanation?: string } | undefined;
    let hairRaw = result.hair_and_skin as { score?: number; explanation?: string } | undefined;
    let accRaw = result.accessories as { score?: number; explanation?: string } | undefined;

    if (!fitRaw && result.fit_silhouette_score != null) {
      fitRaw = {
        score: Number(result.fit_silhouette_score),
        explanation: String(result.fit_silhouette_explanation ?? ''),
      };
    }
    if (!hairRaw && result.color_harmony_score != null) {
      hairRaw = {
        score: Number(result.color_harmony_score),
        explanation: String(result.color_harmony_explanation ?? ''),
      };
    }
    if (!accRaw && result.styling_details_score != null) {
      accRaw = {
        score: Number(result.styling_details_score),
        explanation: String(result.styling_details_explanation ?? ''),
      };
    }

    const clampedFit = {
      score: clampScore(fitRaw?.score),
      explanation: String(fitRaw?.explanation ?? ''),
    };
    const clampedHairAndSkin = {
      score: clampScore(hairRaw?.score),
      explanation: String(hairRaw?.explanation ?? ''),
    };
    const clampedAccessories = {
      score: clampScore(accRaw?.score),
      explanation: String(accRaw?.explanation ?? ''),
    };

    const vibeCheckResult =
      (clampedFit.score + clampedHairAndSkin.score + clampedAccessories.score) / 3;

    const recommendations = Array.isArray(result.recommendations)
      ? (result.recommendations as unknown[]).map((x) => String(x))
      : [];

    let userImageUrl: string | null = null;
    if (sourceImageUrl?.trim()) {
      userImageUrl = normalizeHttpUrlReference(sourceImageUrl.trim()) || null;
    }

    const userExists = await prisma.user.findUnique({ where: { id: userId } });
    if (userExists) {
      await prisma.vibeCheck.create({
        data: {
          userId,
          comment: String(result.comment ?? ''),
          fit_silhouette_score: clampedFit.score,
          fit_silhouette_explanation: clampedFit.explanation,
          color_harmony_score: clampedHairAndSkin.score,
          color_harmony_explanation: clampedHairAndSkin.explanation,
          styling_details_score: clampedAccessories.score,
          styling_details_explanation: clampedAccessories.explanation,
          context_confidence_score: 0,
          context_confidence_explanation: '',
          overall_score: vibeCheckResult,
          recommendations,
          prompt: String(result.prompt ?? description ?? 'image_upload'),
        },
      });

      await prisma.user.update({
        where: { id: userId },
        data: { lastVibeCheckAt: new Date() },
      });
    }

    return {
      comment: String(result.comment ?? ''),
      fit: clampedFit,
      hair_and_skin: clampedHairAndSkin,
      accessories: clampedAccessories,
      vibe_check_result: vibeCheckResult,
      recommendations,
      user_image_url: userImageUrl,
      identified_outfit: String(result.identified_outfit ?? ''),
      follow_up: String(result.follow_up ?? ''),
    };
  } catch (err) {
    logger.error({ err, userId }, 'Error in vibeCheck tool');
    return { error: String(err) };
  }
}
