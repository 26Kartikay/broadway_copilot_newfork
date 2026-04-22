import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const VISION_MODEL = "claude-opus-4-7";

const VIBE_CHECK_PROMPT = `
Analyze this outfit as a Broadway fashion stylist.
Score each dimension 1-10:
- fit_silhouette: How well the fit and silhouette works
- color_harmony: How well colors work together  
- styling_details: Accessories, layering, finishing touches
- context_confidence: How appropriate for the likely occasion

Return JSON only:
{
  "comment": "overall stylish commentary",
  "fit_silhouette_score": 0,
  "fit_silhouette_explanation": "",
  "color_harmony_score": 0,
  "color_harmony_explanation": "",
  "styling_details_score": 0,
  "styling_details_explanation": "",
  "context_confidence_score": 0,
  "context_confidence_explanation": "",
  "overall_score": 0,
  "recommendations": []
}
`;

export interface VibeCheckInput {
  userId: string;
  imageBase64?: string;
  mimeType?: string;
  description?: string;
}

export async function vibeCheck(input: VibeCheckInput) {
  const { userId, imageBase64, mimeType, description } = input;

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
              text: VIBE_CHECK_PROMPT
            }
          ]
        }]
      });

      const text = (response.content[0] as any).text;
      result = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text);
    } else {
      const textPrompt = `Analyze this outfit description: ${description}. ${VIBE_CHECK_PROMPT}`;
      const response = await anthropic.messages.create({
        model: VISION_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: textPrompt }]
      });
      const text = (response.content[0] as any).text;
      result = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text);
    }

    const userExists = await prisma.user.findUnique({ where: { id: userId } });
    if (userExists) {
      await prisma.vibeCheck.create({
        data: {
          userId,
          comment: result.comment,
          fit_silhouette_score: result.fit_silhouette_score,
          fit_silhouette_explanation: result.fit_silhouette_explanation,
          color_harmony_score: result.color_harmony_score,
          color_harmony_explanation: result.color_harmony_explanation,
          styling_details_score: result.styling_details_score,
          styling_details_explanation: result.styling_details_explanation,
          context_confidence_score: result.context_confidence_score,
          context_confidence_explanation: result.context_confidence_explanation,
          overall_score: result.overall_score,
          recommendations: result.recommendations,
          prompt: description || "image_upload"
        }
      });

      await prisma.user.update({
        where: { id: userId },
        data: { lastVibeCheckAt: new Date() }
      });
    }

    return result;

  } catch (err) {
    logger.error({ err, userId }, 'Error in vibeCheck tool');
    return { error: String(err) };
  }
}
