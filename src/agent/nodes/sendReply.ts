import 'dotenv/config';

import { MessageRole, PendingType } from '@prisma/client';
import { MessageContent, MessageContentPart } from '../../lib/ai';

import { Tonality } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import { queueFeedbackRequest } from '../../lib/tasks';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { GraphState, Replies } from '../state';

/**
 * Prepares and returns the reply for HTTP responses.
 * Records the assistant's message in the database and updates processing status.
 * Schedules memory extraction after sending.
 *
 * @param state The current agent state containing reply and user info.
 * @returns Updated state with httpResponse containing the replies.
 */
export async function sendReply(state: GraphState): Promise<GraphState> {
  const { input, user, conversationId } = state;
  const messageId = input.MessageSid;
  const messageKey = `message:${messageId}`;
  const userId = user.whatsappId;

  if (!conversationId) {
    throw new InternalServerError('No open conversation found for user');
  }

  logger.debug({ userId }, 'Setting message status to sending in Redis');
  await redis.hSet(messageKey, { status: 'sending' });

  const replies: Replies = state.assistantReply ?? [];

  // Separate and prioritize the image reply
  const imageReplies = replies.filter((r) => r.reply_type === 'image');
  const nonImageReplies = replies.filter((r) => r.reply_type !== 'image');

  // Create a new ordered list: Images first, then all other replies
  const orderedReplies = [...imageReplies, ...nonImageReplies];

  const formattedContent: MessageContent = orderedReplies.flatMap((r) => {
    const parts: MessageContentPart[] = [];
    if (r.reply_text) {
      parts.push({ type: 'text', text: r.reply_text });
    }
    if (r.reply_type === 'image') {
      parts.push({ type: 'image_url', image_url: { url: r.media_url } });
    }
    if (r.reply_type === 'product_card' && 'products' in r) {
      // Store product recommendations as a special text marker for history
      parts.push({
        type: 'text',
        text: `[Product Recommendations: ${r.products.map((p) => p.name).join(', ')}]`,
      });
    }
    return parts;
  });

  const pendingToPersist = (state.pending as PendingType | undefined) ?? PendingType.NONE;
  const validTonalities: Tonality[] = ['savage', 'friendly', 'hype_bff'];
  const selectedTonalityToPersality: Tonality | null =
    state.selectedTonality && validTonalities.includes(state.selectedTonality as Tonality)
      ? (state.selectedTonality as Tonality)
      : null;

  // Mark as delivered for HTTP mode
  logger.debug({ userId }, 'HTTP delivery mode: collecting replies for response');
  await redis.hSet(messageKey, { status: 'delivered' });

  await prisma.message.create({
    data: {
      conversationId,
      role: MessageRole.AI,
      content: formattedContent,
      pending: pendingToPersist,
      selectedTonality: selectedTonalityToPersality,
    },
  });

  queueFeedbackRequest(user.id, conversationId);

  logger.info({ userId, replyCount: orderedReplies.length }, 'Replies prepared for HTTP response');

  return { ...state, httpResponse: orderedReplies };
}
