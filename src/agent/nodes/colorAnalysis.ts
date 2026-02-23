import { z } from 'zod';

import {
  ColorWithHex,
  isValidPalette,
  SEASONAL_PALETTES,
} from '../../data/seasonalPalettes';
import { getTextLLM, getVisionLLM } from '../../lib/ai';
import { SystemMessage } from '../../lib/ai/core/messages';
import { prisma } from '../../lib/prisma';
import { numImagesInMessage } from '../../utils/context';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { isGuestUser } from '../../utils/user';

import { AgeGroup, Gender, PendingType } from '@prisma/client';
import { GraphState, Replies } from '../state';
import { fetchColorAnalysis } from '../tools';

/**
 * Schema for the LLM output in color analysis.
 * The model should only return the palette name (one of 12 allowed values).
 */
const LLMOutputSchema = z.object({
  quality_ok: z.boolean().describe('Whether the image quality is sufficient for analysis.'),
  palette_name: z
    .enum([
      'LIGHT_SPRING',
      'TRUE_SPRING',
      'BRIGHT_SPRING',
      'LIGHT_SUMMER',
      'TRUE_SUMMER',
      'SOFT_SUMMER',
      'SOFT_AUTUMN',
      'TRUE_AUTUMN',
      'DARK_AUTUMN',
      'TRUE_WINTER',
      'BRIGHT_WINTER',
      'DARK_WINTER',
    ])
    .nullable()
    .describe('The seasonal color palette identifier (must be one of the 12 allowed values).'),
  error_message: z
    .string()
    .nullable()
    .describe('Error message to show if image quality is poor (null if quality_ok is true).'),
  inferred_gender: z
    .enum(['MALE', 'FEMALE'])
    .nullable()
    .describe('The inferred gender of the person in the image. Null if unable to infer.'),
  inferred_age_group: z
    .enum(['TEEN', 'ADULT', 'SENIOR'])
    .nullable()
    .describe('The inferred age group of the person in the image. Null if unable to infer.'),
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

  // No image case - check if user is asking to fetch existing color analysis
  if (imageCount === 0) {
    // If this came from a button click (color_analysis button), always start a new analysis
    // Don't fetch old results when user explicitly clicks the button to do a new analysis
    const isButtonClick = state.input.ButtonPayload === 'color_analysis';
    
    if (isButtonClick) {
      logger.debug({ userId }, 'Color analysis button clicked - starting new analysis');
      // Skip fetch logic and go straight to asking for image
    } else {
      // Check if user typed a message asking to fetch existing color analysis
      const userMessage = state.input.Body?.toLowerCase().trim() || '';
      
      // Regex patterns to detect requests to fetch existing color analysis
      const fetchColorAnalysisPatterns = [
        /\b(fetch|get|show|tell|what|see|view|display|retrieve)\s+(me\s+)?(my\s+)?(last\s+|latest\s+)?color\s+analysis/i,
        /\bcolor\s+analysis\s+(result|info|data|details)?/i,
        /\b(my\s+)?(last\s+|latest\s+)?color\s+analysis/i,
        /\bwhat\s+(is|are)\s+my\s+colors?/i,
        /\b(my\s+)?color\s+palette/i,
        /\b(my\s+)?(seasonal\s+)?palette/i,
        /\bshow\s+(me\s+)?(my\s+)?colors?/i,
        /\bfetch\s+(my\s+)?color/i,
        /\bget\s+(my\s+)?color/i,
      ];
      
      const isFetchRequest = fetchColorAnalysisPatterns.some(pattern => pattern.test(userMessage));
      
      // If user is asking to fetch existing color analysis, try to fetch and show it
      if (isFetchRequest) {
        try {
          logger.debug({ userId }, 'User requested to fetch existing color analysis');
          const colorAnalysisTool = fetchColorAnalysis(userId);
          const colorAnalysisResult = await colorAnalysisTool.func({});
          
          // Check if we got a valid result (object with palette_name)
          if (colorAnalysisResult && typeof colorAnalysisResult === 'object' && 'palette_name' in colorAnalysisResult) {
            const colorAnalysisData = colorAnalysisResult as any;
            const paletteName = colorAnalysisData.palette_name;
            
            if (paletteName && isValidPalette(paletteName)) {
              logger.debug({ userId, paletteName }, 'Found existing color analysis, displaying card');
              
              // Get palette data from mapping
              const paletteData = SEASONAL_PALETTES[paletteName as keyof typeof SEASONAL_PALETTES];
              if (paletteData) {
                // Try to get user image URL from the most recent color analysis
                let userImageUrl: string | null = null;
                try {
                  const colorAnalysisRecord = await prisma.colorAnalysis.findFirst({
                    where: { userId },
                    orderBy: { createdAt: 'desc' },
                  });

                  if (colorAnalysisRecord) {
                    const mediaItem = await prisma.media.findFirst({
                      where: {
                        message: {
                          conversation: {
                            userId,
                          },
                        },
                        createdAt: {
                          gte: new Date(colorAnalysisRecord.createdAt.getTime() - 5 * 60 * 1000),
                          lte: new Date(colorAnalysisRecord.createdAt.getTime() + 5 * 60 * 1000),
                        },
                      },
                      orderBy: { createdAt: 'desc' },
                    });
                    if (mediaItem?.serverUrl) {
                      userImageUrl = mediaItem.serverUrl;
                    }
                  }
                } catch (err) {
                  logger.debug({ userId, err }, 'Could not fetch user image for color analysis card');
                }

                // Create color analysis card
                const replies: Replies = [{
                  reply_type: 'color_analysis_card',
                  palette_name: paletteName,
                  description: paletteData.description,
                  top_colors: shuffleArray(paletteData.topColors),
                  two_color_combos: shuffleArray(
                    formatColorCombos(paletteData.twoColorCombos, paletteData.topColors),
                  ),
                  user_image_url: userImageUrl,
                }];

                return {
                  ...state,
                  assistantReply: replies,
                  pending: PendingType.NONE,
                };
              }
            }
          }
          
          // If no valid color analysis found, fall through to ask for new image
          logger.debug({ userId }, 'No existing color analysis found, asking for new image');
        } catch (err) {
          logger.warn({ userId, err: (err as Error)?.message }, 'Failed to fetch existing color analysis, asking for new image');
          // Fall through to ask for new image
        }
      }
    }
    
    // Ask for new image (either user wants new analysis or no existing analysis found)
    const systemPromptText = await loadPrompt('handlers/analysis/no_image_request.txt', state.user);
    const systemPrompt = new SystemMessage(
      systemPromptText.replace('{analysis_type}', 'color analysis'),
    );

    const response = await getTextLLM()
      .withStructuredOutput(NoImageLLMOutputSchema)
      .run(systemPrompt, state.conversationHistoryTextOnly, state.traceBuffer, 'colorAnalysis');

    const replies: Replies = [
      { reply_type: 'color_analysis_image_upload_request', reply_text: response.reply_text },
    ];
    return {
      ...state,
      assistantReply: replies,
      pending: PendingType.COLOR_ANALYSIS_IMAGE,
    };
  }

  // Image present: run color analysis
  try {
    const systemPromptTextRaw = await loadPrompt('handlers/analysis/color_analysis.txt', state.user);

    const gender = state.user.confirmedGender;
    const ageGroup = state.user.confirmedAgeGroup;
    let userContext = 'an adult';
    if (gender && ageGroup) {
      userContext = `a ${ageGroup.toLowerCase()} ${gender.toLowerCase()}`;
    } else if (gender) {
      userContext = `an adult ${gender.toLowerCase()}`;
    } else if (ageGroup) {
      userContext = `a ${ageGroup.toLowerCase()}`;
    }

    const systemPromptText = systemPromptTextRaw.replace('{user_context}', userContext);
    const systemPrompt = new SystemMessage(systemPromptText);

    const output = await getVisionLLM()
      .withStructuredOutput(LLMOutputSchema)
      .run(systemPrompt, state.conversationHistoryWithImages, state.traceBuffer, 'colorAnalysis');

    logger.debug({ userId, output }, 'Color analysis LLM output');

    // Handle poor image quality case
    if (!output.quality_ok || !output.palette_name) {
      const errorMessage =
        output.error_message || 'Oops, can you try sending a clearer picture of your face? 💖';
      const replies: Replies = [{ reply_type: 'text', reply_text: errorMessage }];
      return {
        ...state,
        assistantReply: replies,
        pending: PendingType.COLOR_ANALYSIS_IMAGE,
      };
    }

    // Validate palette name
    const paletteName = output.palette_name;
    if (!paletteName || !(paletteName in SEASONAL_PALETTES)) {
      logger.error({ userId, paletteName }, 'Invalid palette name returned from LLM');
      throw new InternalServerError(`Invalid palette name: ${paletteName}`);
    }

    // In production or for guests, do NOT update user - database is source of truth / no persistence
    const isProduction = process.env.NODE_ENV === 'production';
    const guestUser = isGuestUser(state.user);

    if (!isProduction && !guestUser) {
      const dataToUpdate: { inferredGender?: Gender; inferredAgeGroup?: AgeGroup } = {};
      if (output.inferred_gender && !state.user.confirmedGender) {
        dataToUpdate.inferredGender = Gender[output.inferred_gender];
      }
      if (output.inferred_age_group && !state.user.confirmedAgeGroup) {
        if (Object.values(AgeGroup).includes(output.inferred_age_group as AgeGroup)) {
          dataToUpdate.inferredAgeGroup = output.inferred_age_group as AgeGroup;
        } else {
          logger.warn({ userId, inferred_age_group: output.inferred_age_group }, 'Invalid age group value from LLM');
        }
      }
      if (Object.keys(dataToUpdate).length > 0) {
        await prisma.user.update({
          where: { id: userId },
          data: dataToUpdate,
        });
        logger.debug({ userId, ...dataToUpdate }, 'Updated inferred user properties.');
      }
    } else {
      logger.debug({ userId }, 'Skipping user update (production or guest)');
    }

    // Get palette data from mapping
    const paletteData = SEASONAL_PALETTES[paletteName as keyof typeof SEASONAL_PALETTES];

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
        two_color_combos: shuffleArray(
          formatColorCombos(paletteData.twoColorCombos, paletteData.topColors),
        ),
        user_image_url: userImageUrl,
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

    logger.debug(
      { userId, messageId, paletteName },
      'Color analysis completed, awaiting user confirmation to save.',
    );

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
