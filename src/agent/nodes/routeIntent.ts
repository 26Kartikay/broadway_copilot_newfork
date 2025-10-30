import { z } from 'zod';
import { PendingType } from '@prisma/client';
import { getTextLLM } from '../../lib/ai';
import { SystemMessage } from '../../lib/ai/core/messages';
import { numImagesInMessage } from '../../utils/context';
import { InternalServerError } from '../../utils/errors';
import { loadPrompt } from '../../utils/prompts';
import { GraphState, IntentLabel } from '../state';
import { logger } from '../../utils/logger';

const validTonalities = ['friendly', 'savage', 'hype_bff'];
const otherValid = ['general', 'vibe_check', 'color_analysis', 'suggest', 'this_or_that','skin_lab'];

const LLMOutputSchema = z.object({
  intent: z.enum(['general', 'vibe_check', 'color_analysis', 'style_studio', 'this_or_that','skin_lab']),
  missingProfileField: z.enum(['gender', 'age_group']).nullable(),
});

export async function routeIntent(state: GraphState): Promise<GraphState> {
  logger.debug(
    {
      buttonPayload: state.input.ButtonPayload,
      pending: state.pending,
      selectedTonality: state.selectedTonality,
      userId: state.user.id,
    },
    'Routing intent with current state',
  );

  const { user, input, conversationHistoryWithImages, pending } = state;
  const userId = user.id;
  const buttonPayload = input.ButtonPayload;

  // ------------------------------
  // 1️⃣ Priority 1: Handle explicit button payloads
  // ------------------------------
  if (buttonPayload) {
    // Style Studio root → opens List Picker
    if (buttonPayload === 'style_studio' || buttonPayload === 'stylestudio') {
      return {
        ...state,
        intent: 'style_studio',
        pending: PendingType.STYLE_STUDIO_MENU,
        missingProfileField: null,
      };
    }

    // Style Studio sub-services → normal quick flow
    const validSubIntents = [
      'style_studio_occasion',
      'style_studio_vacation',
      'style_studio_general',
    ] as const;

    if (validSubIntents.includes(buttonPayload as any)) {
      const subIntent = buttonPayload as (typeof validSubIntents)[number];
      return {
        ...state,
        intent: 'style_studio',
        subIntent,
        pending: PendingType.NONE,
        missingProfileField: null,
      };
    }

    // Handle other service payloads
    if (otherValid.includes(buttonPayload)) {
      const intent = buttonPayload as IntentLabel;

      // vibe_check → triggers quick reply tonality options
      if (intent === 'vibe_check') {
        logger.debug({ buttonPayload }, 'Received vibe_check payload - resetting tonality.');
        return {
          ...state,
          intent: 'vibe_check',
          pending: PendingType.TONALITY_SELECTION, // ensures quick reply
          selectedTonality: null,
          missingProfileField: null,
        };
      }

      // color_analysis → goes to image upload list picker
      if (intent === 'color_analysis') {
        return {
          ...state,
          intent: 'color_analysis',
          pending: PendingType.COLOR_ANALYSIS_IMAGE,
          missingProfileField: null,
        };
      }

      return { ...state, intent, missingProfileField: null };
    }

    // Tonality selections
    if (validTonalities.includes(buttonPayload.toLowerCase())) {
      return {
        ...state,
        intent: 'vibe_check',
        selectedTonality: buttonPayload.toLowerCase(),
        pending: PendingType.VIBE_CHECK_IMAGE,
        missingProfileField: null,
      };
    }

    // Default fallback
    return { ...state, intent: 'general', missingProfileField: null };
  }

  // ------------------------------
  // 2️⃣ Priority 2: Handle text inputs
  // ------------------------------
  const userMessage = input.Body?.toLowerCase().trim() ?? '';

  if (userMessage === 'style_studio') {
    logger.debug({ userId }, 'Explicit text match: style_studio.');
    return {
      ...state,
      intent: 'style_studio',
      pending: PendingType.STYLE_STUDIO_MENU,
      missingProfileField: null,
    };
  }

  if (userMessage === 'vibe_check') {
    return {
      ...state,
      intent: 'vibe_check',
      pending: PendingType.TONALITY_SELECTION,
      missingProfileField: null,
    };
  }

  // ------------------------------
  // 3️⃣ Pending tonality handling
  // ------------------------------
  if (pending === PendingType.TONALITY_SELECTION) {
    if (validTonalities.includes(userMessage)) {
      return {
        ...state,
        selectedTonality: userMessage,
        pending: PendingType.VIBE_CHECK_IMAGE,
        intent: 'vibe_check',
        missingProfileField: null,
      };
    }
    return {
      ...state,
      assistantReply: [
        {
          reply_type: 'text',
          reply_text: `Invalid tonality. Choose: Friendly, Savage, or Hype BFF.`,
        },
      ],
      pending: PendingType.TONALITY_SELECTION,
    };
  }

  // ------------------------------
  // 4️⃣ Handle image-based pending intents
  // ------------------------------
  const imageCount = numImagesInMessage(conversationHistoryWithImages);
  if (imageCount > 0) {
    if (pending === PendingType.VIBE_CHECK_IMAGE) {
      logger.debug({ userId }, 'Routing to vibe_check due to image presence.');
      return { ...state, intent: 'vibe_check', missingProfileField: null };
    }
    if (pending === PendingType.COLOR_ANALYSIS_IMAGE) {
      logger.debug({ userId }, 'Routing to color_analysis due to image presence.');
      return { ...state, intent: 'color_analysis', missingProfileField: null };
    }
  }

  // ------------------------------
  // 5️⃣ Fallback to LLM routing
  // ------------------------------
  const now = Date.now();
  const lastVibeCheckAt = user.lastVibeCheckAt?.getTime() ?? null;
  const vibeMinutesAgo = lastVibeCheckAt ? Math.floor((now - lastVibeCheckAt) / (1000 * 60)) : -1;
  const canDoVibeCheck = vibeMinutesAgo === -1 || vibeMinutesAgo >= 30;

  const lastColorAnalysisAt = user.lastColorAnalysisAt?.getTime() ?? null;
  const colorMinutesAgo = lastColorAnalysisAt
    ? Math.floor((now - lastColorAnalysisAt) / (1000 * 60))
    : -1;
  const canDoColorAnalysis = colorMinutesAgo === -1 || colorMinutesAgo >= 30;

  try {
    const systemPromptText = await loadPrompt('routing/route_intent.txt');
    const formattedSystemPrompt = systemPromptText
      .replace('{can_do_vibe_check}', canDoVibeCheck.toString())
      .replace('{can_do_color_analysis}', canDoColorAnalysis.toString());

    const systemPrompt = new SystemMessage(formattedSystemPrompt);
    const response = await getTextLLM()
      .withStructuredOutput(LLMOutputSchema)
      .run(systemPrompt, state.conversationHistoryTextOnly, state.traceBuffer, 'routeIntent');

    let { intent, missingProfileField } = response;

    if (missingProfileField === 'gender' && (user.inferredGender || user.confirmedGender)) {
      missingProfileField = null;
    } else if (
      missingProfileField === 'age_group' &&
      (user.inferredAgeGroup || user.confirmedAgeGroup)
    ) {
      missingProfileField = null;
    }

    return { ...state, intent, missingProfileField, generalIntent: state.generalIntent };
  } catch (err: unknown) {
    throw new InternalServerError('Failed to route intent', { cause: err });
  }
}
