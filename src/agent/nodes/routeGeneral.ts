import { z } from 'zod';

import { getTextLLM } from '../../lib/ai';
import { SystemMessage } from '../../lib/ai/core/messages';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { extractTextContent } from '../../utils/text';

import { InternalServerError } from '../../utils/errors';
import { GeneralIntent, GraphState } from '../state';

const GREETING_REGEX = /\b(hi|hello|hey|heya|yo|sup)\b/i;
const MENU_REGEX = /\b(help|menu|options?|what can you do\??)\b/i;

const LLMOutputSchema = z.object({
  generalIntent: z
    .enum(['greeting', 'menu', 'chat'])
    .describe("The user's specific intent, used to route to the correct general handler."),
});

/**
 * Routes general messages (greeting/menu/chat) via regex shortcuts, else LLM.
 */
export async function routeGeneral(state: GraphState): Promise<GraphState> {
  const userId = state.user.id;
  const messageId = state.input.MessageSid;
  let lastMessageContent = state.conversationHistoryTextOnly.at(-1)?.content;
  let lastMessage = lastMessageContent ? extractTextContent(lastMessageContent) : '';
  const buttonPayload = state.input.ButtonPayload; // Get button payload

  logger.debug({ userId, messageId, lastMessage, buttonPayload }, 'Routing general intent');

  // Handle button payloads first
  if (buttonPayload) {
      if (buttonPayload === 'main_menu' || buttonPayload === 'refresh_conversation_starters') {
          logger.debug({ userId }, `General intent routed to "menu" by button payload: ${buttonPayload}`);
          return { ...state, generalIntent: 'menu' as GeneralIntent };
      }
      if (buttonPayload.startsWith('conversation_starter_')) {
          // Extract original text from the button ID.
          // Example: 'conversation_starter_my_top_colors' -> 'My top colors?'
          // The ID is generated from text like "What's your style?", so we need to reverse the transformation
          const extractedText = buttonPayload.replace('conversation_starter_', '').replace(/_/g, ' ');
          const originalStarterText = extractedText.charAt(0).toUpperCase() + extractedText.slice(1) + '?'; // Capitalize first letter and add '?'

          logger.debug({ userId, originalStarterText }, 'Conversation starter button clicked, routing to chat.');
          
          // Overwrite the message body for the LLM to process this as a chat.
          // Update both text-only and with-images history to ensure consistency for the LLM.
          state.input.Body = originalStarterText;
          if (state.conversationHistoryTextOnly.length > 0) {
            const lastMessage = state.conversationHistoryTextOnly[state.conversationHistoryTextOnly.length - 1];
            if (lastMessage) {
              lastMessage.content = [{type: 'text', text: originalStarterText}];
            }
          }
          if (state.conversationHistoryWithImages.length > 0) {
            const lastMessage = state.conversationHistoryWithImages[state.conversationHistoryWithImages.length - 1];
            if (lastMessage) {
              lastMessage.content = [{type: 'text', text: originalStarterText}];
            }
          }

          return { ...state, generalIntent: 'chat' as GeneralIntent };
      }
  }

  // Regex routing for common cases
  if (GREETING_REGEX.test(lastMessage)) {
    logger.debug({ userId }, 'General intent routed to "greeting" by regex');
    return { ...state, generalIntent: 'greeting' as GeneralIntent };
  }

  // LLM-based routing as fallback
  try {
    const systemPromptText = await loadPrompt('routing/route_general.txt');
    const systemPrompt = new SystemMessage(systemPromptText);

    const response = await getTextLLM()
      .withStructuredOutput(LLMOutputSchema)
      .run(systemPrompt, state.conversationHistoryTextOnly, state.traceBuffer, 'routeGeneral');

    logger.debug({ userId, intent: response.generalIntent }, 'General intent routed by LLM');
    return { ...state, generalIntent: response.generalIntent };
  } catch (err: unknown) {
    throw new InternalServerError('Failed to route general intent', {
      cause: err,
    });
  }
}