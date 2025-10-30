import { z } from 'zod';
import { getTextLLM } from '../../lib/ai';
import { SystemMessage, BaseMessage } from '../../lib/ai/core/messages';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { InternalServerError } from '../../utils/errors';
import { GraphState, Replies } from '../state';
import { PendingType } from '@prisma/client';

const StyleStudioOutputSchema = z.object({
  reply_text: z.string(),
});

const styleStudioMenuButtons = [
  { text: 'Style for any occasion', id: 'style_studio_occasion' },
  { text: 'Vacation looks', id: 'style_studio_vacation' },
  { text: 'General styling', id: 'style_studio_general' },
];

export async function handleStyleStudio(state: GraphState): Promise<GraphState> {
  const { subIntent, conversationHistoryTextOnly, user, pending } = state;
  const userId = user.id;

  // --- START OF CONTEXT CHECK AND TRUNCATION (FIXED) ---
  let historyForLLM: BaseMessage[] = conversationHistoryTextOnly;
  
  if (subIntent && historyForLLM.length > 0) {
    // Get the last message.
    const latestUserMessage = historyForLLM.at(-1); 
    
    // Check 1 & 2: Ensure the message object exists AND its content is definitely a string
    if (latestUserMessage && typeof latestUserMessage.content === 'string') {
        
        // FIX: Use 'as unknown as string' to correctly handle the complex MessageContent type
        const isServiceSwitch = styleStudioMenuButtons.some(
          button => (latestUserMessage.content as unknown as string).trim() === button.id
        );

        if (isServiceSwitch) {
          // If a switch was detected, truncate the history to ONLY include the latest message.
          logger.debug({ userId, subIntent }, 'Sub-service switch detected via button payload. Truncating LLM history.');
          
          // We assert that latestUserMessage is a BaseMessage before array assignment
          historyForLLM = [latestUserMessage as BaseMessage]; 
        }
    }
  }
  // --- END OF CONTEXT CHECK AND TRUNCATION (FIXED) ---

  if (!subIntent) {
    // Send menu if not already pending
    if (pending !== PendingType.STYLE_STUDIO_MENU) {
      const replies: Replies = [
        {
          reply_type: 'quick_reply',
          reply_text: 'Welcome to Style Studio! Choose a styling service:',
          buttons: styleStudioMenuButtons,
        },
      ];
      return {
        ...state,
        assistantReply: replies,
        pending: PendingType.STYLE_STUDIO_MENU,
        lastHandledPayload: null,
      };
    } else {
      // Possibly user repeated same menu state; do nothing
      return { ...state, assistantReply: [] };
    }
  }

  try {
    const intentKey = subIntent.replace('style_studio_', ''); // e.g. 'occasion', 'vacation', 'general'
    const systemPromptText = await loadPrompt(`handlers/style_studio/${intentKey}.txt`);
    const systemPrompt = new SystemMessage(systemPromptText);

    const result = await getTextLLM()
      .withStructuredOutput(StyleStudioOutputSchema)
      .run(systemPrompt, historyForLLM, state.traceBuffer, 'handleStyleStudio'); // 👈 USING THE FILTERED HISTORY

    const replies: Replies = [
      { reply_type: 'text', reply_text: result.reply_text },
    ];

    logger.debug({ userId, subIntent, replies }, 'Generated Style Studio reply');
    return { ...state, assistantReply: replies, pending: PendingType.NONE };
  } catch (err) {
    logger.error({ userId, err }, 'Error in handleStyleStudio');
    throw new InternalServerError('Failed to handle Style Studio request', { cause: err });
  }
}