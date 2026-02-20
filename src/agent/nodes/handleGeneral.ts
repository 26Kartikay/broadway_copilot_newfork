import { Gender } from '@prisma/client';
import { z } from 'zod';
import { getTextLLM } from '../../lib/ai';
import { agentExecutor } from '../../lib/ai/agents/executor';
import { SystemMessage } from '../../lib/ai/core/messages';
import { prisma } from '../../lib/prisma';
import { getPaletteData, isValidPalette, type ColorWithHex, SEASONAL_PALETTES } from '../../data/seasonalPalettes';
import { WELCOME_IMAGE_URL } from '../../utils/constants';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { GraphState, Replies } from '../state';
import { fetchColorAnalysis, fetchRelevantMemories } from '../tools';

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
 */
function formatColorCombos(combos: string[], allColors: ColorWithHex[]): ColorWithHex[][] {
  const colorMap = new Map(allColors.map((color) => [color.name.toLowerCase(), color.hex]));

  return combos.map((combo) => {
    // Split by " & " or ", " and trim whitespace
    const colorNames = combo.split(/ & |, /).map((name) => name.trim());

    return colorNames.map((name) => {
      const hex = colorMap.get(name.toLowerCase());
      return { name, hex: hex || '#000000' };
    });
  });
}

const LLMOutputSchema = z.object({
  message1_text: z.string().describe('The first text message response to the user.'),
  message2_text: z.string().nullable().describe('The second text message response to the user.'),
});

function formatLLMOutput(text: string): string {
  if (!text) return '';
  const lines = text.split('\n');
  const spacedLines = lines.map((line) => line.trim()).join('\n\n');
  return spacedLines.trim();
}

export async function handleGeneral(state: GraphState): Promise<GraphState> {
  const { user, generalIntent, input, conversationHistoryTextOnly, traceBuffer } = state;
  const userId = user.id;
  const messageId = input.MessageSid;

  try {
    // ------------------------------------------
    // Greeting/Menu Intent — Uses List Picker
    // ------------------------------------------
    if (generalIntent === 'greeting' || generalIntent === 'menu') {
      const greetingText = `✨ Welcome, ${user.profileName || 'there'}! Let's explore some Broadway magic.\n\nWhat would you like to do today?`;

      const replies: Replies = [
        { reply_type: 'image', media_url: WELCOME_IMAGE_URL },
        {
          reply_type: 'list_picker',
          reply_text: greetingText,
          buttons: [
            { text: 'Vibe check', id: 'vibe_check' },
            { text: 'Color analysis', id: 'color_analysis' },
            { text: 'Style Studio', id: 'style_studio' },
            { text: 'Fashion Charades', id: 'fashion_quiz' },
            { text: 'This or That', id: 'this_or_that' },
            { text: 'Skin Lab', id: 'skin_lab' },
          ],
        },
      ];

      logger.debug({ userId, messageId }, 'Greeting/Menu handled with image and list picker');
      return { ...state, assistantReply: replies };
    }

    // ------------------------------------------
    // Tonality Intent (unchanged)
    // ------------------------------------------
    if (generalIntent === 'tonality') {
      const tonalityText = 'Choose your vibe! *✨💬*';
      const buttons = [
        { text: 'Hype BFF 🔥', id: 'hype_bff' },
        { text: 'Friendly 🙂', id: 'friendly' },
        { text: 'Savage 😈', id: 'savage' },
      ];
      const replies: Replies = [{ reply_type: 'quick_reply', reply_text: tonalityText, buttons }];
      logger.debug({ userId, messageId }, 'Tonality handled with static response');
      return { ...state, assistantReply: replies };
    }

    // ------------------------------------------
    // Chat Intent (unchanged)
    // ------------------------------------------
    if (generalIntent === 'chat') {
      const replies: Replies = [];
      const userMessage = state.input.Body?.toLowerCase().trim() || '';
      
      // Regex patterns to detect color analysis fetch requests
      const colorAnalysisPatterns = [
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
      
      const isColorAnalysisRequest = colorAnalysisPatterns.some(pattern => pattern.test(userMessage));
      
      // Check if user is just giving an affirmative response (sure, yes, ok, etc.)
      // These should NOT trigger color analysis card creation
      const affirmativePatterns = [
        /^(sure|yes|yeah|yep|ok|okay|alright|fine|go ahead|let's do it|sounds good|that works)$/i,
        /^(sure|yes|yeah|yep|ok|okay|alright|fine)\s*[.!]?$/i,
      ];
      
      const isAffirmativeResponse = affirmativePatterns.some(pattern => pattern.test(userMessage));
      
      // Check if the last assistant message was asking about outfit ideas or product recommendations
      const lastAssistantMessage = state.conversationHistoryTextOnly
        .slice()
        .reverse()
        .find(msg => msg.role === 'assistant');
      
      const lastAssistantText = lastAssistantMessage?.content
        ?.map(c => (typeof c === 'string' ? c : c.type === 'text' ? c.text : ''))
        .join(' ')
        .toLowerCase() || '';
      
      const isOutfitIdeasQuestion = 
        lastAssistantText.includes('outfit ideas') ||
        lastAssistantText.includes('explore some outfit') ||
        lastAssistantText.includes('product recommendations') ||
        lastAssistantText.includes('would you like to see') ||
        lastAssistantText.includes('shall i recommend');
      
      // Only create card if:
      // 1. User explicitly asked for color analysis (not just affirmative response)
      // 2. AND it's not a response to an outfit ideas question
      const shouldCreateCard = isColorAnalysisRequest && !isAffirmativeResponse && !isOutfitIdeasQuestion;

      // If user is asking to fetch color analysis, handle it BEFORE calling LLM to avoid infinite loops
      if (shouldCreateCard) {
        try {
          logger.debug({ userId }, 'User requested color analysis, fetching before LLM call');
          const colorAnalysisTool = fetchColorAnalysis(userId);
          const colorAnalysisResult = await colorAnalysisTool.func({});
          
          // Check if we got a valid result (object with palette_name)
          if (colorAnalysisResult && typeof colorAnalysisResult === 'object' && 'palette_name' in colorAnalysisResult) {
            const colorAnalysisData = colorAnalysisResult as any;
            const paletteName = colorAnalysisData.palette_name;
            
            if (paletteName && isValidPalette(paletteName)) {
              logger.debug({ userId, paletteName }, 'Found existing color analysis, creating card');
              
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
                replies.push({
                  reply_type: 'color_analysis_card',
                  palette_name: paletteName,
                  description: paletteData.description,
                  top_colors: shuffleArray(paletteData.topColors),
                  two_color_combos: shuffleArray(
                    formatColorCombos(paletteData.twoColorCombos, paletteData.topColors),
                  ),
                  user_image_url: userImageUrl,
                });
                
                // Return early with just the card - no need to call LLM
                logger.debug({ userId, messageId }, 'Returning color analysis card without LLM call');
                return { ...state, assistantReply: replies };
              }
            }
          }
          
          // If no valid color analysis found, continue to LLM (it will handle the response)
          logger.debug({ userId }, 'No existing color analysis found, continuing to LLM');
        } catch (err) {
          logger.warn({ userId, err: (err as Error)?.message }, 'Failed to fetch color analysis, continuing to LLM');
          // Continue to LLM to handle the error gracefully
        }
      }

      let systemPromptText = await loadPrompt('handlers/general/handle_chat.txt', state.user);

      // Inject user's name and gender into the system prompt for the LLM
      if (user.profileName) {
        systemPromptText += `\nThe user's name is ${user.profileName}.`;
      }
      
      // Use confirmed gender first, then fall back to inferred gender
      const userGender = user.confirmedGender || user.inferredGender;
      const genderSource = user.confirmedGender ? 'confirmed' : user.inferredGender ? 'inferred' : 'none';
      
      // Log gender information
      logger.debug(
        {
          userId,
          messageId,
          confirmedGender: user.confirmedGender,
          inferredGender: user.inferredGender,
          genderUsed: userGender,
          genderSource,
        },
        'User gender for chat prompt',
      );
      
      if (userGender) {
        systemPromptText += `\nThe user's gender is ${userGender}.`;
      }

      systemPromptText += '\nPlease respond concisely, avoiding verbosity.';

      // Only include fetchColorAnalysis tool if user is NOT asking to fetch it (to avoid loops)
      // If they are asking to fetch, we already handled it above
      const tools = [fetchRelevantMemories(userId)];
      if (!shouldCreateCard) {
        tools.push(fetchColorAnalysis(userId));
      }
      
      const systemPrompt = new SystemMessage(systemPromptText);

      const executorResult = await agentExecutor(
        getTextLLM(),
        systemPrompt,
        conversationHistoryTextOnly,
        { tools, outputSchema: LLMOutputSchema, nodeName: 'handleGeneral' },
        traceBuffer,
      );

      const finalResponse = executorResult.output;
      const toolResults = executorResult.toolResults;

      const formattedMessage1 = formatLLMOutput(finalResponse.message1_text);
      const formattedMessage2 = finalResponse.message2_text
        ? formatLLMOutput(finalResponse.message2_text)
        : null;

      // Add the text responses from LLM
      if (formattedMessage1) replies.push({ reply_type: 'text', reply_text: formattedMessage1 });
      if (formattedMessage2) replies.push({ reply_type: 'text', reply_text: formattedMessage2 });

      logger.debug({ userId, messageId }, 'Chat handled with formatted output');
      return { ...state, assistantReply: replies };
    }

    // ------------------------------------------
    // Unhandled intents
    // ------------------------------------------
    throw new InternalServerError(`Unhandled general intent: ${generalIntent}`);
  } catch (err: unknown) {
    throw new InternalServerError('Failed to handle general intent', { cause: err });
  }
}
