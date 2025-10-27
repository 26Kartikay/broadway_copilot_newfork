import { z } from 'zod';
import { getTextLLM } from '../../lib/ai';
import { SystemMessage } from '../../lib/ai/core/messages';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { InternalServerError } from '../../utils/errors';
import { GraphState, Replies } from '../state';
import { PendingType } from '@prisma/client';

const validSubIntents = ['style_studio_occasion', 'style_studio_vacation', 'style_studio_general'] as const;
type SubIntent = typeof validSubIntents[number];

const styleStudioMenuButtons = [
  { text: 'Style for any occasion', id: 'style_studio_occasion' },
  { text: 'Vacation looks', id: 'style_studio_vacation' },
  { text: 'General styling', id: 'style_studio_general' },
];

const LLMOutputSchema = z.object({
  subIntent: z.enum(validSubIntents),
});

export async function routeStyleStudio(state: GraphState): Promise<GraphState> {
  const userId = state.user.id;
  const payload = state.input.ButtonPayload ?? '';

  logger.debug({ userId, payload }, 'Entered routeStyleStudio');

  try {
    if (payload === 'style_studio' || state.input.Text?.trim()?.toLowerCase() === 'stylestudio') {
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

    // --- START MODIFIED BLOCK ---
    if ((validSubIntents as readonly string[]).includes(payload)) {
      const subIntent = payload as SubIntent;
      logger.debug({ userId, subIntent }, 'Style Studio subIntent from button');
      return { 
            ...state, 
            subIntent, 
            pending: PendingType.NONE,
            // 🚨 CRITICAL ADDITION: Save the button payload for the handler to check
            lastSubIntentPayload: payload 
        };
    }
    // --- END MODIFIED BLOCK ---

    const systemPromptText = await loadPrompt('routing/route_style_studio.txt');
    const systemPrompt = new SystemMessage(systemPromptText);

    const response = await getTextLLM()
      .withStructuredOutput(LLMOutputSchema)
      .run(systemPrompt, state.conversationHistoryTextOnly, state.traceBuffer, 'routeStyleStudio');

    const safeSubIntent = validSubIntents.find(v => v === response.subIntent);
    if (!safeSubIntent) {
      throw new Error(`Invalid subIntent from LLM: ${response.subIntent}`);
    }

    logger.debug({ userId, subIntent: safeSubIntent }, 'Resolved subIntent from LLM');
    // Save the resolved subIntent for the handler, but don't set the payload field
    // since the routing was done by the LLM, not a direct button click.
    return { 
        ...state, 
        subIntent: safeSubIntent, 
        pending: PendingType.NONE 
    };
  } catch (err) {
    logger.error({ userId, err }, 'Error in routeStyleStudio');
    throw new InternalServerError('Failed to route Style Studio intent', { cause: err });
  }
}