import 'dotenv/config';

import { MessageRole, PendingType } from '@prisma/client';
import { MessageContent, MessageContentPart } from '../../lib/ai';

import { Tonality } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import { queueFeedbackRequest } from '../../lib/tasks';
import { sendImage, sendMenu, sendText } from '../../lib/twilio';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { GraphState, Replies } from '../state';

/**
 * Sends the reply via Twilio based on the assistant's generated replies.
 * Records the assistant's message in the database and updates processing status.
 * Schedules memory extraction after sending.
 * @param state The current agent state containing reply and user info.
 * @returns An empty object as no state updates are needed.
 */
export async function sendReply(state: GraphState): Promise<GraphState> {
    const { input, user, conversationId } = state;
    const messageId = input.MessageSid;
    const messageKey = `message:${messageId}`;
    const whatsappId = user.whatsappId;

    if (!conversationId) {
        throw new InternalServerError('No open conversation found for user');
    }

    logger.debug({ whatsappId }, 'Setting message status to sending in Redis');
    await redis.hSet(messageKey, { status: 'sending' });

    const replies: Replies = state.assistantReply ?? [];

    // --- MODIFICATION: Separate and prioritize the image reply ---
    const imageReplies = replies.filter(r => r.reply_type === 'image');
    const nonImageReplies = replies.filter(r => r.reply_type !== 'image');

    // Create a new ordered list: Images first, then all other replies (including List Picker)
    const orderedReplies = [...imageReplies, ...nonImageReplies];
    // --- END MODIFICATION ---

    const formattedContent: MessageContent = orderedReplies.flatMap((r) => {
        const parts: MessageContentPart[] = [];
        if (r.reply_text) {
            parts.push({ type: 'text', text: r.reply_text });
        }
        if (r.reply_type === 'image') {
            parts.push({ type: 'image_url', image_url: { url: r.media_url } });
        }
        return parts;
    });

    const pendingToPersist = (state.pending as PendingType | undefined) ?? PendingType.NONE;
    const validTonalities: Tonality[] = ['savage', 'friendly', 'hype_bff'];
    const selectedTonalityToPersality: Tonality | null =
        state.selectedTonality && validTonalities.includes(state.selectedTonality as Tonality)
            ? (state.selectedTonality as Tonality)
            : null;

    // If deliveryMode is HTTP, don't send via Twilio; return replies in state
    if (state.deliveryMode === 'http') {
        logger.debug({ whatsappId }, 'HTTP delivery mode: collecting replies for response');
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
        return { ...state, httpResponse: orderedReplies };
    }

    let success = true;
    try {
        // Loop uses the new ordered array, ensuring images are sent first
        for (const [index, r] of orderedReplies.entries()) {
            if (r.reply_type === 'text') {
                await sendText(whatsappId, r.reply_text);
                logger.debug(
                    {
                        whatsappId,
                        replyIndex: index + 1,
                        textLength: r.reply_text.length,
                    },
                    'Sent text message',
                );
            } else if (r.reply_type === 'quick_reply' || r.reply_type === 'list_picker') {
                if (r.buttons.length >= 2 && r.buttons.length <= 4) {
                    await sendMenu(whatsappId, r.reply_text, r.buttons);
                } else {
                    logger.warn(
                        {
                            whatsappId,
                            buttonCount: r.buttons.length,
                            replyType: r.reply_type,
                            replyIndex: index + 1,
                        },
                        'Unexpected button count for menu type - falling back to text',
                    );
                    await sendText(whatsappId, r.reply_text);
                }
                logger.debug(
                    { whatsappId, replyIndex: index + 1, buttonCount: r.buttons.length, replyType: r.reply_type },
                    'Sent menu message',
                );
            } else if (r.reply_type === 'image') {
                await sendImage(whatsappId, r.media_url, r.reply_text);
                logger.debug(
                    { whatsappId, replyIndex: index + 1, mediaUrl: r.media_url },
                    'Sent image message',
                );
            }
        }
        logger.info({ whatsappId, replyCount: orderedReplies.length }, 'All replies sent successfully');
    } catch (err: unknown) {
        success = false;
        throw new InternalServerError('Failed to send replies', { cause: err });
    } finally {
        logger.debug({ status: success ? 'delivered' : 'failed' }, 'Updating message status in Redis');
        await redis.hSet(messageKey, { status: success ? 'delivered' : 'failed' });
    }

    // Persist both pending and selectedTonality!
    await prisma.message.create({
        data: {
            conversationId,
            role: MessageRole.AI,
            content: formattedContent,
            pending: pendingToPersist,
            selectedTonality: selectedTonalityToPersality, // <-- persist latest tonality
        },
    });

    queueFeedbackRequest(user.id, conversationId);

    return { ...state };
}