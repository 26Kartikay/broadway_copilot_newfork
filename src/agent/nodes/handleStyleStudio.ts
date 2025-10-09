import { z } from 'zod';
import { logger } from '../../utils/logger';

import { getTextLLM } from '../../lib/ai';
import { SystemMessage } from '../../lib/ai/core/messages';
import { loadPrompt } from '../../utils/prompts';

import { PendingType } from '@prisma/client';
import { InternalServerError } from '../../utils/errors';
import { GraphState, Replies } from '../state';

const styleStudioMenuButtons = [
  { text: 'Style for any occasion', id: 'style_studio_occasion' },
  { text: 'Vacation looks', id: 'style_studio_vacation' },
  { text: 'General styling', id: 'style_studio_general' },
];

// General output schema for style studio LLM responses
// General output schema for style studio LLM responses
const StyleStudioOutputSchema = z.object({
  reply_text: z.string().describe('Detailed outfit advice including specific suggestions.'),
  followup_question: z.string().optional().describe('Optional friendly follow-up question to keep conversation going.')
});


export async function handleStyleStudio(state: GraphState): Promise<GraphState> {
  logger.debug(
    {
      userId: state.user.id,
      intent: state.intent,
      pending: state.pending,
      buttonPayload: state.input.ButtonPayload,
    },
    'Entering handleStyleStudio node',
  );

  // Step 1: Show main menu if no pending selection
  if (state.pending !== PendingType.STYLE_STUDIO_MENU) {
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
    };
  }

  // Step 2: Handle submenu selection based on button payload
  const payload = state.input.ButtonPayload;

  // Map payload to prompt files for subservices
  const subservicePromptMap: Record<string, string> = {
    style_studio_occasion: 'handlers/style_studio/occasion.txt',
    style_studio_vacation: 'handlers/style_studio/vacation.txt',
    style_studio_general: 'handlers/style_studio/general_styling.txt',
  };

  if (payload && subservicePromptMap[payload]) {
    try {
      const promptText = await loadPrompt(subservicePromptMap[payload]);
      const systemMessage = new SystemMessage(promptText);
      const result = await getTextLLM()
        .withStructuredOutput(StyleStudioOutputSchema)
        .run(systemMessage, state.conversationHistoryTextOnly, state.traceBuffer, 'handleStyleStudio');

      const replies: Replies = [
        {
          reply_type: 'text',
          reply_text: result.reply_text,
        },
      ];

      // After handling subservice, clear pending so user can do another action next
      return {
        ...state,
        assistantReply: replies,
        pending: null,
      };
    } catch (err: unknown) {
      throw new InternalServerError('Style Studio failed to generate a response', { cause: err });
    }
  } else {
    // If invalid selection, repeat menu or provide a fallback message
    const replies: Replies = [
      {
        reply_type: 'text',
        reply_text: 'Please select a valid Style Studio option from the menu below.',
      },
      {
        reply_type: 'quick_reply',
        reply_text: 'Choose a styling service:',
        buttons: styleStudioMenuButtons,
      },
    ];
    return {
      ...state,
      assistantReply: replies,
      pending: PendingType.STYLE_STUDIO_MENU,
    };
  }
}
