import { PendingType } from '@prisma/client';
import { z } from 'zod';
import { getTextLLM } from '../../lib/ai';
import { SystemMessage } from '../../lib/ai/core/messages';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { GraphState, Replies } from '../state';

const validSubIntents = [
  'style_studio_occasion',
  'style_studio_vacation',
  'style_studio_general',
] as const;
type SubIntent = (typeof validSubIntents)[number];

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

  logger.debug({ userId, payload, pending: state.pending }, 'Entered routeStyleStudio');

  try {
    if (payload === 'style_studio' || state.pending === PendingType.STYLE_STUDIO_MENU) {
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
        pending: PendingType.NONE,
      };
    }

    if ((validSubIntents as readonly string[]).includes(payload)) {
      const subIntent = payload as SubIntent;
      logger.debug({ userId, subIntent }, 'Style Studio subIntent from button');
      return {
        ...state,
        subIntent,
        pending: PendingType.NONE,
        lastSubIntentPayload: payload,
      };
    }

    const systemPromptText = await loadPrompt('routing/route_style_studio.txt');
    const systemPrompt = new SystemMessage(systemPromptText);

    const response = await getTextLLM()
      .withStructuredOutput(LLMOutputSchema)
      .run(systemPrompt, state.conversationHistoryTextOnly, state.traceBuffer, 'routeStyleStudio');

    const safeSubIntent = validSubIntents.find((v) => v === response.subIntent);
    if (!safeSubIntent) throw new Error(`Invalid subIntent from LLM: ${response.subIntent}`);

    logger.debug({ userId, subIntent: safeSubIntent }, 'Resolved subIntent from LLM');

    return {
      ...state,
      subIntent: safeSubIntent,
      pending: PendingType.NONE,
    };
  } catch (err) {
    logger.error({ userId, err }, 'Error in routeStyleStudio');
    throw new InternalServerError('Failed to route Style Studio intent', { cause: err });
  }
}
