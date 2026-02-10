import { z } from 'zod';

import { PendingType } from '@prisma/client';

import { getTextLLM } from '../../lib/ai';
import { SystemMessage } from '../../lib/ai/core/messages';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { GraphState, Replies } from '../state';

/**
 * Schema for LLM output when asking user for profile information.
 */
const LLMOutputSchema = z.object({
  text: z
    .string()
    .describe('The natural language sentence asking the user for the missing information.'),
});

/**
 * Handles user onboarding by asking for missing profile information.
 * Generates a contextual response requesting the missing profile field (gender or age group)
 * and sets the conversation to pending state for the next user response.
 */
export async function askUserInfo(state: GraphState): Promise<GraphState> {
  const userId = state.user.id;
  const messageId = state.input.MessageSid;
  const missingField = state.missingProfileField;

  let replies: Replies;

  if (missingField === 'gender') {
    replies = [
      {
        reply_type: 'quick_reply',
        reply_text: 'Which of these best describes you?',
        buttons: [
          { text: 'Female', id: 'gender_FEMALE' },
          { text: 'Male', id: 'gender_MALE' },
          { text: 'Skip', id: 'gender_skip' },
        ],
      },
    ];
    logger.debug({ userId, messageId }, 'Asking for gender with buttons.');
  } else if (missingField === 'age_group') {
    replies = [
      {
        reply_type: 'quick_reply',
        reply_text: 'What is your age range?',
        buttons: [
          { text: '13-17', id: 'age_AGE_13_17' },
          { text: '18-25', id: 'age_AGE_18_25' },
          { text: '26-35', id: 'age_AGE_26_35' },
          { text: '36-45', id: 'age_AGE_36_45' },
          { text: '46-55', id: 'age_AGE_46_55' },
          { text: '55+', id: 'age_AGE_55_PLUS' },
        ],
      },
    ];
    logger.debug({ userId, messageId }, 'Asking for age group with buttons.');
  } else if (missingField === 'fitPreference') {
    replies = [
      {
        reply_type: 'quick_reply',
        reply_text: 'What fit do you usually prefer for your clothes?',
        buttons: [
          { text: 'Slim', id: 'fit_SLIM' },
          { text: 'Regular', id: 'fit_REGULAR' },
          { text: 'Oversized', id: 'fit_OVERSIZED' },
        ],
      },
    ];
    logger.debug({ userId, messageId }, 'Asking for fit preference with buttons.');
  } else {
    // Fallback to the original LLM-based method for any other case.
    try {
      const systemPromptText = await loadPrompt('data/ask_user_info.txt');
      const fieldToAsk = missingField || 'required information';
      logger.debug(
        { userId, messageId, missingField: fieldToAsk },
        'Creating prompt for missing field request',
      );

      const systemPrompt = new SystemMessage(
        systemPromptText.replace('{missingField}', fieldToAsk),
      );

      const response = await getTextLLM()
        .withStructuredOutput(LLMOutputSchema)
        .run(systemPrompt, state.conversationHistoryTextOnly, state.traceBuffer, 'askUserInfo');

      replies = [{ reply_type: 'text', reply_text: response.text }];
      logger.debug(
        { userId, messageId, replyLength: response.text.length },
        'Successfully generated ask user info reply',
      );
    } catch (err: unknown) {
      throw new InternalServerError('Failed to generate ask user info response', {
        cause: err,
      });
    }
  }

  return {
    ...state,
    assistantReply: replies,
    pending: PendingType.ASK_USER_INFO,
  };
}
