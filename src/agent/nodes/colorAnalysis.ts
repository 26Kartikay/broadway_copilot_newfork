import { z } from 'zod';

import { getTextLLM, getVisionLLM } from '../../lib/ai';
import { SystemMessage } from '../../lib/ai/core/messages';
import { getPaletteData, isValidPalette, SeasonalPalette } from '../../data/seasonalPalettes';
import { prisma } from '../../lib/prisma';
import { numImagesInMessage } from '../../utils/context';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';

import { PendingType } from '@prisma/client';
import { GraphState, Replies } from '../state';

/**
 * Schema for the LLM output in color analysis.
 * The model should only return the palette name (one of 12 allowed values).
 */
const LLMOutputSchema = z.object({
  quality_ok: z
    .boolean()
    .describe('Whether the image quality is sufficient for analysis.'),
  palette_name: z
    .enum([
      'LIGHT_SPRING',
      'WARM_SPRING',
      'CLEAR_SPRING',
      'LIGHT_SUMMER',
      'COOL_SUMMER',
      'SOFT_SUMMER',
      'SOFT_AUTUMN',
      'WARM_AUTUMN',
      'DEEP_AUTUMN',
      'COOL_WINTER',
      'CLEAR_WINTER',
      'DEEP_WINTER',
    ])
    .nullable()
    .describe('The seasonal color palette identifier (must be one of the 12 allowed values).'),
  error_message: z
    .string()
    .nullable()
    .describe('Error message to show if image quality is poor (null if quality_ok is true).'),
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

    logger.debug({ userId, output }, 'Color analysis LLM output');

    // Handle poor image quality case
    if (!output.quality_ok || !output.palette_name) {
      const errorMessage = output.error_message || 'Oops, can you try sending a clearer picture of your face? 💖';
      const replies: Replies = [{ reply_type: 'text', reply_text: errorMessage }];
      return {
        ...state,
        assistantReply: replies,
        pending: PendingType.COLOR_ANALYSIS_IMAGE,
      };
    }

    // Validate palette name
    const paletteName = output.palette_name;
    if (!isValidPalette(paletteName)) {
      logger.error({ userId, paletteName }, 'Invalid palette name returned from LLM');
      throw new InternalServerError(`Invalid palette name: ${paletteName}`);
    }

    // Get palette data from mapping
    const paletteData = getPaletteData(paletteName);

    // Save results to DB
    const [, user] = await prisma.$transaction([
      prisma.colorAnalysis.create({
        data: {
          userId,
          palette_name: paletteName,
          colors_suited: paletteData.topColors,
          colors_to_wear: {
            two_color_combos: paletteData.twoColorCombos,
            three_color_combos: paletteData.threeColorCombos,
          },
          colors_to_avoid: null, // Not used in new format
        },
      }),
      prisma.user.update({
        where: { id: state.user.id },
        data: { lastColorAnalysisAt: new Date() },
      }),
    ]);

    // Return color analysis card reply with full data
    const replies: Replies = [
      {
        reply_type: 'color_analysis_card',
        palette_name: paletteName,
        description: paletteData.description,
        top_colors: paletteData.topColors,
        two_color_combos: paletteData.twoColorCombos,
        three_color_combos: paletteData.threeColorCombos,
      },
    ];

    logger.debug({ userId, messageId, paletteName }, 'Color analysis completed successfully');

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
