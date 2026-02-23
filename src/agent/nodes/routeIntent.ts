import { PendingType } from '@prisma/client';
import { z } from 'zod';
import { getTextLLM } from '../../lib/ai';
import { SystemMessage } from '../../lib/ai/core/messages';
import { numImagesInMessage } from '../../utils/context';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { isGuestUser } from '../../utils/user';
import { GraphState, IntentLabel } from '../state';

const validTonalities = ['friendly', 'savage', 'hype_bff'];
const otherValid = [
  'general',
  'vibe_check',
  'color_analysis',
  'suggest',
  'this_or_that',
  'skin_lab',
  'fashion_quiz',
];

const LLMOutputSchema = z.object({
  intent: z.enum([
    'general',
    'vibe_check',
    'color_analysis',
    'style_studio',
    'this_or_that',
    'skin_lab',
    'fashion_quiz',
  ]),
  missingProfileField: z.enum(['gender', 'fitPreference']).nullable(),
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

  // When guest would get vibe_check or color_analysis, redirect to login_prompt instead
  function applyGuestIntent(state: GraphState, intent: IntentLabel, extra: Partial<GraphState> = {}): GraphState {
    if (isGuestUser(state.user) && (intent === 'vibe_check' || intent === 'color_analysis')) {
      return { ...state, ...extra, intent: 'guest_login_required', guestLoginPromptFor: intent };
    }
    return { ...state, ...extra, intent };
  }

  // ------------------------------
  // 1️⃣ Priority 1: Handle explicit button payloads
  // ------------------------------
  if (buttonPayload) {
    // Fashion Quiz/Charades buttons (a, b, c, d, hint) - stay in quiz flow
    if (['a', 'b', 'c', 'd', 'hint'].includes(buttonPayload.toLowerCase())) {
      // Check if we're in a fashion quiz/charades pending state
      const quizPendingStates = [
        'FASHION_QUIZ_START',
        'FASHION_QUIZ_QUESTION_1',
        'FASHION_QUIZ_QUESTION_2',
        'FASHION_QUIZ_QUESTION_3',
        'FASHION_QUIZ_QUESTION_4',
        'FASHION_QUIZ_QUESTION_5',
        'FASHION_QUIZ_QUESTION_6',
        'FASHION_QUIZ_QUESTION_7',
        'FASHION_QUIZ_QUESTION_8',
        'FASHION_QUIZ_QUESTION_9',
        'FASHION_QUIZ_QUESTION_10',
        'FASHION_QUIZ_RESULTS',
      ];
      const isQuizPending = pending && quizPendingStates.includes(pending.toString());
      logger.debug({ buttonPayload, pending, isQuizPending }, 'Checking quiz button routing');
      if (isQuizPending) {
        logger.debug(
          { buttonPayload, pending },
          'Fashion quiz/charades button clicked - staying in quiz flow',
        );
        return {
          ...state,
          intent: 'fashion_quiz',
          missingProfileField: null,
        };
      }
    }

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
      logger.debug({ buttonPayload, intent }, 'Routing to service intent');

      // vibe_check → for guest show login_prompt; else tonality selection
      if (intent === 'vibe_check') {
        logger.debug({ buttonPayload }, 'Received vibe_check payload - resetting tonality.');
        return applyGuestIntent(state, 'vibe_check', {
          pending: PendingType.TONALITY_SELECTION,
          selectedTonality: null,
          missingProfileField: null,
        });
      }

      // color_analysis → for guest show login_prompt; else image upload
      if (intent === 'color_analysis') {
        return applyGuestIntent(state, 'color_analysis', {
          pending: PendingType.COLOR_ANALYSIS_IMAGE,
          missingProfileField: null,
        });
      }

      // fashion_quiz → start charades game
      if (intent === 'fashion_quiz') {
        logger.debug({ buttonPayload }, 'Starting fashion charades game');
        return {
          ...state,
          intent: 'fashion_quiz',
          pending: PendingType.FASHION_QUIZ_START,
          missingProfileField: null,
        };
      }

      return { ...state, intent, missingProfileField: null };
    }

    // Tonality selections → for guest show login_prompt
    if (validTonalities.includes(buttonPayload.toLowerCase())) {
      return applyGuestIntent(state, 'vibe_check', {
        selectedTonality: buttonPayload.toLowerCase(),
        pending: PendingType.VIBE_CHECK_IMAGE,
        missingProfileField: null,
      });
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

  if (
    userMessage === 'fashion_quiz' ||
    userMessage === 'fashion quiz' ||
    userMessage === 'quiz' ||
    userMessage === 'fashion_charades' ||
    userMessage === 'fashion charades' ||
    userMessage === 'charades'
  ) {
    logger.debug({ userId }, 'Explicit text match: fashion charades.');
    return {
      ...state,
      intent: 'fashion_quiz',
      pending: PendingType.FASHION_QUIZ_START,
      missingProfileField: null,
    };
  }

  // ------------------------------
  // 2.5️⃣ Handle text inputs during active fashion charades game
  // ------------------------------
  if (pending === PendingType.FASHION_QUIZ_START && input.Body?.trim()) {
    // Allow greetings like "hey" to exit the game and show menu
    const GREETING_REGEX = /\b(hi|hello|hey|heya|yo|sup)\b/i;
    if (GREETING_REGEX.test(userMessage)) {
      logger.debug(
        { userId, userMessage },
        'Greeting during fashion charades - allowing normal routing to exit game',
      );
      // Allow normal routing to continue (will go to LLM routing)
    } else {
      logger.debug(
        { userId, userMessage },
        'Non-greeting text input during active fashion charades game - routing to fashion_quiz',
      );
      return {
        ...state,
        intent: 'fashion_quiz',
        missingProfileField: null,
      };
    }
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
      return applyGuestIntent(state, 'vibe_check', { missingProfileField: null });
    }
    if (pending === PendingType.COLOR_ANALYSIS_IMAGE) {
      logger.debug({ userId }, 'Routing to color_analysis due to image presence.');
      return applyGuestIntent(state, 'color_analysis', { missingProfileField: null });
    }
  }

  // ------------------------------
  // 4.5️⃣ Handle text messages when waiting for image (allow cancellation/other intents)
  // ------------------------------
  // If user is in COLOR_ANALYSIS_IMAGE pending but sends text (no image),
  // route to general to handle the message and allow cancellation/other actions
  // This prevents infinite loops of asking for images
  if (pending === PendingType.COLOR_ANALYSIS_IMAGE && imageCount === 0) {
    logger.debug({ userId, userMessage }, 'User in COLOR_ANALYSIS_IMAGE pending but sent text, routing to general to allow cancellation');
    // Route to general so the user can cancel or do something else
    // The general handler can check if they want to cancel color analysis
    return { ...state, intent: 'general', missingProfileField: null };
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
    const systemPromptText = await loadPrompt('routing/route_intent.txt', user);
    const formattedSystemPrompt = systemPromptText
      .replace('{can_do_vibe_check}', canDoVibeCheck.toString())
      .replace('{can_do_color_analysis}', canDoColorAnalysis.toString());

    const systemPrompt = new SystemMessage(formattedSystemPrompt);
    const response = await getTextLLM()
      .withStructuredOutput(LLMOutputSchema)
      .run(systemPrompt, state.conversationHistoryTextOnly, state.traceBuffer, 'routeIntent');

    let { intent, missingProfileField } = response;
    if (pending === PendingType.COLOR_ANALYSIS_IMAGE && intent === 'color_analysis' && imageCount === 0) {
      logger.debug({ userId }, 'Preventing color_analysis routing loop, routing to general instead');
      intent = 'general';
    }
    return applyGuestIntent(state, intent, {
      missingProfileField: missingProfileField ?? null,
      generalIntent: state.generalIntent,
    });
  } catch (err: unknown) {
    throw new InternalServerError('Failed to route intent', { cause: err });
  }
}
