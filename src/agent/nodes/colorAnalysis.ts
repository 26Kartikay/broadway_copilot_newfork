import { z } from 'zod';

import { getTextLLM, getVisionLLM } from '../../lib/ai';
import { ImagePart, SystemMessage } from '../../lib/ai/core/messages';
import { ColorWithHex, getPaletteData, isValidPalette, SeasonalPalette } from '../../data/seasonalPalettes';
import { Celebrity, celebrityPalettes } from '../../data/celebrityPalettes'; // Import Celebrity data
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

// Shuffle arrays to ensure variety in presentation
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i]!, shuffled[j]!] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}

/**
 * Formats color combination strings into structured data with hex codes.
 * @param combos An array of color combination strings (e.g., "Color1 & Color2").
 * @param allColors An array of all available colors with their hex codes.
 * @returns A structured array of color combinations with names and hex codes.
 */
function formatColorCombos(combos: string[], allColors: ColorWithHex[]): ColorWithHex[][] {
  const colorMap = new Map(allColors.map((color) => [color.name.toLowerCase(), color.hex]));

  return combos.map((combo) => {
    // Split by " & " or ", " and trim whitespace
    const colorNames = combo.split(/ & |, /).map((name) => name.trim());

    return colorNames.map((name) => {
      const hex = colorMap.get(name.toLowerCase());
      // Return a default or handle missing colors if necessary
      return { name, hex: hex || '#000000' };
    });
  });
}


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


    const replies: Replies = [{ reply_type: 'image_upload_request', reply_text: response.reply_text, require_image_upload: true }];
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

    // Determine color twin celebrities
    let colorTwins: Celebrity[] = [];
    const gender = state.user.confirmedGender || state.user.inferredGender; // Assuming 'male' or 'female'

    if (gender === 'male' && celebrityPalettes[paletteName]?.male) {
      colorTwins = shuffleArray(celebrityPalettes[paletteName].male);
    } else if (gender === 'female' && celebrityPalettes[paletteName]?.female) {
      colorTwins = shuffleArray(celebrityPalettes[paletteName].female);
    } else {
      // If gender is unknown or not explicitly male/female, provide a mix
      const maleCelebs = celebrityPalettes[paletteName]?.male || [];
      const femaleCelebs = celebrityPalettes[paletteName]?.female || [];
      colorTwins = shuffleArray([...maleCelebs, ...femaleCelebs]).slice(0, 4); // Limit to 4 mixed examples
    }

    // Find the latest message with an image in the conversation history
    const imageMessage = [...state.conversationHistoryWithImages]
      .reverse()
      .find((msg) => msg.content.some((part) => part.type === 'image_url'));

    let userImageUrl: string | null = null;
    if (imageMessage && imageMessage.meta?.messageId) {
      const mediaItem = await prisma.media.findFirst({
        where: { messageId: imageMessage.meta.messageId as string },
        orderBy: { createdAt: 'desc' },
      });
      if (mediaItem?.serverUrl) {
        userImageUrl = mediaItem.serverUrl;
      }
    }

    // Return color analysis card reply with a prompt to save the result.
    const replies: Replies = [
      {
        reply_type: 'color_analysis_card',
        palette_name: paletteName,
        description: paletteData.description,
        top_colors: shuffleArray(paletteData.topColors),
        two_color_combos: shuffleArray(formatColorCombos(paletteData.twoColorCombos, paletteData.topColors)),
        user_image_url: userImageUrl,
        color_twin: colorTwins, // Add the color twin celebrities
      },
      {
        reply_type: 'quick_reply',
        reply_text: 'Do you want to save this color analysis result?',
        buttons: [
          { text: 'Yes', id: 'save_color_analysis_yes' },
          { text: 'No', id: 'save_color_analysis_no' },
        ],
      },
    ];

    logger.debug({ userId, messageId, paletteName }, 'Color analysis completed, awaiting user confirmation to save.');

    return {
      ...state,
      assistantReply: replies,
      seasonalPaletteToSave: paletteName,
      pending: PendingType.SAVE_COLOR_ANALYSIS,
    };
  } catch (err: unknown) {
    throw new InternalServerError('Color analysis failed', { cause: err });
  }
}
