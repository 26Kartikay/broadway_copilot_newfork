import { z } from 'zod';

import { getTextLLM, getVisionLLM } from '../../lib/ai';
import { SystemMessage } from '../../lib/ai/core/messages';
import { prisma } from '../../lib/prisma';
import { numImagesInMessage } from '../../utils/context';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';

import { PendingType } from '@prisma/client';
import { GraphState, Replies } from '../state';

/**
 * Schema for a color object with name.
 */
const ColorObjectSchema = z.object({
  name: z
    .string()
    .describe("A concise, shopper-friendly color name (e.g., 'Warm Ivory', 'Deep Espresso')."),
});

/**
 * Schema for the LLM output in color analysis.
 */
const LLMOutputSchema = z.object({
  compliment: z
    .string()
    .describe("A short compliment for the user (e.g., 'Looking sharp and confident!')."),
  palette_name: z
    .string()
    .nullable()
    .describe("The seasonal color palette name (e.g., 'Deep Winter', 'Soft Summer')."),
  palette_description: z
    .string()
    .nullable()
    .describe(
      "Why this palette suits the user (e.g., 'Your strong contrast and cool undertones shine in the Deep Winter palette...').",
    ),
  colors_suited: z
    .array(ColorObjectSchema)
    .describe('Main representative colors from the palette.'),
  colors_to_wear: z.object({
    clothing: z.array(z.string()).describe('Recommended clothing colors.'),
    jewelry: z
      .array(z.string())
      .describe('Recommended jewelry tones (e.g., Silver, Rose Gold, White Gold).'),
  }),
  colors_to_avoid: z
    .array(ColorObjectSchema)
    .describe('Colors that clash with the palette and should be avoided.'),
  follow_up: z
    .string()
    .describe(
      "A short, natural follow-up question to keep the chat going (e.g., 'Would you like me to suggest outfits in your palette?' or 'Want me to show how this palette works for makeup too?').",
    ),
});

const NoImageLLMOutputSchema = z.object({
  reply_text: z
    .string()
    .describe('The text to send to the user explaining they need to send an image.'),
});

/**
 * Performs color analysis from a portrait and returns a WhatsApp-friendly text reply; logs and persists results.
 * @param state The current agent state.
 */
export async function colorAnalysis(state: GraphState): Promise<GraphState> {
  const userId = state.user.id;
  const messageId = state.input.MessageSid;

  const imageCount = numImagesInMessage(state.conversationHistoryWithImages);

  // No image case
  if (imageCount === 0) {
    const systemPromptText = await loadPrompt('handlers/analysis/no_image_request.txt');
    const systemPrompt = new SystemMessage(
      systemPromptText.replace('{analysis_type}', 'color analysis'),
    );

    const response = await getTextLLM()
      .withStructuredOutput(NoImageLLMOutputSchema)
      .run(systemPrompt, state.conversationHistoryTextOnly, state.traceBuffer, 'colorAnalysis');


    const replies: Replies = [{ reply_type: 'text', reply_text: response.reply_text }];
    return {
      ...state,
      assistantReply: replies,
      pending: PendingType.COLOR_ANALYSIS_IMAGE,
    };
  }

  // Image present: run color analysis
  try {
    const systemPromptText = await loadPrompt('handlers/analysis/color_analysis.txt');
    const systemPrompt = new SystemMessage(systemPromptText);

    const output = await getVisionLLM()
      .withStructuredOutput(LLMOutputSchema)
      .run(systemPrompt, state.conversationHistoryWithImages, state.traceBuffer, 'colorAnalysis');

    // Save results to DB (excluding follow-up)
    const [, user] = await prisma.$transaction([
      prisma.colorAnalysis.create({
        data: {
          userId,
          compliment: output.compliment,
          palette_name: output.palette_name ?? null,
          palette_description: output.palette_description ?? null,
          colors_suited: output.colors_suited,
          colors_to_wear: output.colors_to_wear,
          colors_to_avoid: output.colors_to_avoid,
        },
      }),
      prisma.user.update({
        where: { id: state.user.id },
        data: { lastColorAnalysisAt: new Date() },
      }),
    ]);

    // Beautifully formatted WhatsApp message
    const formattedMessage = `
💫 *${output.compliment}*

🎨 *Your Color Palette:* _${output.palette_name ?? 'Unknown'}_

🩵  ${output.palette_description ?? 'N/A'}

👗 *Best Clothing Colors:* ${output.colors_to_wear.clothing.join(', ')}
💍 *Jewelry That Shines on You:* ${output.colors_to_wear.jewelry.join(', ')}
🚫 *Colors to Avoid:* ${output.colors_to_avoid.map((c) => c.name).join(', ')}

${output.follow_up}
`;

    const replies: Replies = [{ reply_type: 'text', reply_text: formattedMessage.trim() }];

    logger.debug({ userId, messageId, replies }, 'Color analysis completed successfully');

    return {
      ...state,
      user,
      assistantReply: replies,
      pending: PendingType.NONE,
    };
  } catch (err: unknown) {
    throw new InternalServerError('Color analysis failed', { cause: err });
  }
}
