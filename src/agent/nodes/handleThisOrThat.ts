import { z } from 'zod';
import { PendingType } from '@prisma/client';
import { getTextLLM } from '../../lib/ai';
import { agentExecutor } from '../../lib/ai/agents/executor';
import { SystemMessage } from '../../lib/ai/core/messages';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { numImagesInMessage } from '../../utils/context';
import { GraphState, Replies } from '../state';
import { fetchRelevantMemories } from '../tools';

/**
 * Schema for structured LLM response after comparing two outfits.
 */
const LLMOutputSchema = z.object({
  message1_text: z
    .string()
    .describe('Primary recommendation text after comparing the outfits.'),
  message2_text: z
    .string()
    .nullable()
    .describe('Optional follow-up context or compliment for the user.'),
});

/**
 * Helper to format message content with readable spacing.
 */
function formatText(text: string): string {
  if (!text) return '';
  const lines = text.split('\n').map((l) => l.trim());
  return lines.join('\n\n').trim();
}

/**
 * Handles the complete "This or That" flow:
 *  Step 1: Requests user to send outfit images.
 *  Step 2: Once received, analyzes and gives outfit recommendation.
 */
export async function handleThisOrThat(state: GraphState): Promise<GraphState> {
  const { user, input, conversationHistoryWithImages, conversationHistoryTextOnly, traceBuffer } = state;
  const userId = user.id;
  const messageId = input.MessageSid;

  try {
    // Check the total count of images in the conversation history.
    const imageCount = numImagesInMessage(conversationHistoryWithImages);

    // --- Step 1: Prompt the user if we don't have exactly ONE image ---
    // This catches 0 images (initial run) and >1 image (user sent them separately).
    if (imageCount !== 1) {
      logger.info({ userId, messageId, imageCount }, 'Prompting user for single combined This or That outfit image.');

      const promptText = 
        (imageCount > 1)
        ? 'Oops! It looks like you sent a couple of images separately. For the *This or That* showdown, please merge your two outfit photos into **one single, combined image** (side-by-side) and send it over so I can run the analysis! 📸'
        : 'Time for a style showdown! 👑\n\nPlease send me a **single image** that has **both outfit choices merged side-by-side** so I can crown the winner! ✨';

      const replies: Replies = [
        {
          reply_type: 'text',
          reply_text: promptText,
        },
      ];

      return {
        ...state,
        assistantReply: replies,
        pending: PendingType.THIS_OR_THAT_IMAGE_INPUT,
      };
    }

    // --- Step 2: User has sent ONE image (the combined collage) - perform analysis and recommendation ---
    // If imageCount === 1, we proceed directly to analysis.
    logger.info(
      { userId, imageCount },
      'Received single combined image for This or That comparison. Running analysis...',
    );

    const systemPromptText = await loadPrompt('handlers/this_or_that/this_or_that_image_analysis.txt');
    const tools = [fetchRelevantMemories(userId)];
    const systemPrompt = new SystemMessage(systemPromptText);

    const finalResponse = await agentExecutor(
      getTextLLM(),
      systemPrompt,
      conversationHistoryTextOnly,
      { tools, outputSchema: LLMOutputSchema, nodeName: 'handleThisOrThat' },
      traceBuffer,
    );

    const msg1 = formatText(finalResponse.message1_text);
    const msg2 = finalResponse.message2_text ? formatText(finalResponse.message2_text) : null;

    const replies: Replies = [{ reply_type: 'text', reply_text: msg1 }];
    if (msg2) replies.push({ reply_type: 'text', reply_text: msg2 });

    logger.info({ userId, messageId }, 'Generated This or That outfit recommendation successfully.');

    return {
      ...state,
      assistantReply: replies,
      pending: PendingType.NONE, // 🔥 THIS IS THE KEY: Clear the state after a successful response!
    };
  } catch (err: unknown) {
    logger.error(
      { userId, messageId, error: err instanceof Error ? err.message : String(err) },
      'Failed handling This or That image comparison.',
    );
    throw new InternalServerError('Failed to handle This or That outfit comparison', { cause: err });
  }
}