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

const StyleStudioOutputSchema = z.object({
  reply_text: z.string().describe('Detailed outfit advice including specific suggestions.'),
});

export async function handleStyleStudio(state: GraphState): Promise<GraphState> {
  logger.debug(
    {
      userId: state.user.id,
      intent: state.intent,
      pending: state.pending,
      buttonPayload: state.input.ButtonPayload,
      lastHandledPayload: state.lastHandledPayload,
    },
    'Entering handleStyleStudio node',
  );

  const payload = state.input.ButtonPayload;

  // Step 1: If not in style studio menu pending state, send the menu and set pending
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
      lastHandledPayload: null,
    };
  }

  // Step 2: Prevent repeated reply for same button payload
  if (payload && payload === state.lastHandledPayload) {
    return { ...state, assistantReply: [] };
  }

  // Step 3: Handle submenu based on payload
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
        .run(
          systemMessage,
          state.conversationHistoryTextOnly,
          state.traceBuffer,
          'handleStyleStudio',
        );

      const replies: Replies = [
        {
          reply_type: 'text',
          reply_text: result.reply_text,
        },
      ];

      // Clear pending after reuse to avoid repeated menus, or keep if you want menu persistent
      return {
        ...state,
        assistantReply: replies,
        pending: PendingType.NONE, // <-- Reset pending here after handling selection
        lastHandledPayload: payload,
      };
    } catch (err: unknown) {
      throw new InternalServerError('Style Studio failed to generate a response', { cause: err });
    }
  }

  // Step 4: Handle invalid payload by repeating menu prompt
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
    lastHandledPayload: null,
  };
}
