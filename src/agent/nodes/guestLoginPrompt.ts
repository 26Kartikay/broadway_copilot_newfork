import { logger } from '../../utils/logger';
import { GraphState, Replies } from '../state';

const VIBE_CHECK_MESSAGE =
  'Sign in to use Vibe Check and get personalized outfit feedback. Your results will be saved to your profile.';
const COLOR_ANALYSIS_MESSAGE =
  'Sign in to use Color Analysis and discover your seasonal palette. Your palette will be saved to your profile.';

/**
 * Returns a login_prompt reply when a guest tries to use vibe check or color analysis.
 * Frontend can render this as a login prompt card.
 */
export async function guestLoginPrompt(state: GraphState): Promise<GraphState> {
  const forFeature = state.guestLoginPromptFor ?? 'vibe_check';
  const replyText =
    forFeature === 'color_analysis' ? COLOR_ANALYSIS_MESSAGE : VIBE_CHECK_MESSAGE;

  logger.debug(
    { userId: state.user.id, guestLoginPromptFor: forFeature },
    'Guest login prompt: returning login_prompt reply',
  );

  const replies: Replies = [
    {
      reply_type: 'login_prompt',
      reply_text: replyText,
    },
  ];

  return { ...state, assistantReply: replies };
}
