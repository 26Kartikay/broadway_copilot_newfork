import { MessageRole, PendingType } from '@prisma/client';
import { AssistantMessage, MessageContent, MessageContentPart, UserMessage } from '../../lib/ai';

import { prisma } from '../../lib/prisma';
import { queueImageUpload } from '../../lib/tasks';
import {
  appendGuestHistory,
  EPHEMERAL_GUEST_CONVERSATION_ID,
  getGuestHistory,
} from '../../utils/context';
import { logger } from '../../utils/logger';
import { convertLocalhostUrlToDataUrl, processMediaForAI } from '../../utils/media';
import { extractTextContent } from '../../utils/text';
import { isGuestUser } from '../../utils/user';
import { GraphState } from '../state';

/**
 * Ingests incoming messages, processes media attachments, manages conversation history,
 * and prepares data for downstream processing in the agent graph.
 *
 * Handles message merging for multi-part messages, media download and storage,
 * and conversation history preparation with both image and text-only versions.
 */
export async function ingestMessage(state: GraphState): Promise<GraphState> {
  const { input, user, conversationId, graphRunId } = state;
  const {
    Body: text,
    ButtonPayload: buttonPayload,
    NumMedia: numMedia,
    MediaUrl0: mediaUrl0,
    MediaContentType0: mediaContentType0,
    WaId: userId,
  } = input;

  if (!userId) {
    throw new Error('User ID not found in message input');
  }

  let media:
    | { serverUrl: string; aiUrl: string; originalUrl: string; mimeType: string }
    | undefined;
  let content: MessageContent = [{ type: 'text', text }];

  if (numMedia === '1' && mediaUrl0 && mediaContentType0?.startsWith('image/')) {
    try {
      // Process media for both AI (OpenAI) and storage
      const { aiUrl, serverUrl } = await processMediaForAI(mediaUrl0, userId, mediaContentType0);

      // Use aiUrl for conversation history (works with OpenAI locally and in prod)
      content.push({ type: 'image_url', image_url: { url: aiUrl } });
      media = { serverUrl, aiUrl, originalUrl: mediaUrl0, mimeType: mediaContentType0 };
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
          mediaUrl0,
        },
        'Failed to process image, proceeding without it.',
      );
    }
  }

  const isGuest =
    state.conversationId === EPHEMERAL_GUEST_CONVERSATION_ID || isGuestUser(user);

  if (isGuest) {
    const guestHistory = await getGuestHistory(user.appUserId);
    const textContent = extractTextContent(content);
    await appendGuestHistory(user.appUserId, 'user', textContent);

    const conversationHistoryWithImages: (UserMessage | AssistantMessage)[] = [];
    const conversationHistoryTextOnly: (UserMessage | AssistantMessage)[] = [];
    for (const msg of guestHistory) {
      if (msg.role === 'user') {
        conversationHistoryWithImages.push(new UserMessage(msg.text));
        conversationHistoryTextOnly.push(new UserMessage(msg.text));
      } else {
        conversationHistoryWithImages.push(new AssistantMessage(msg.text));
        conversationHistoryTextOnly.push(new AssistantMessage(msg.text));
      }
    }
    const currentUserText = new UserMessage(textContent);
    const currentUserWithImage = new UserMessage(content);
    conversationHistoryWithImages.push(currentUserWithImage);
    conversationHistoryTextOnly.push(currentUserText);

    logger.debug(
      { userId, graphRunId, guestMessageCount: guestHistory.length + 1 },
      'Guest message ingested (Redis only)',
    );
    return {
      ...state,
      conversationHistoryWithImages,
      conversationHistoryTextOnly,
      pending: state.pending ?? PendingType.NONE,
      selectedTonality: state.selectedTonality ?? null,
      thisOrThatFirstImageId: state.thisOrThatFirstImageId,
      productRecommendationContext: state.productRecommendationContext,
      seasonalPaletteToSave: state.seasonalPaletteToSave,
      user,
      input,
    };
  }

  // These will be populated inside the transaction
  let productRecommendationContextFromDB: any;
  let seasonalPaletteToSaveFromDB: any;

  const {
    savedMessage,
    messages,
    pending: dbPending,
    selectedTonality: dbSelectedTonality,
    thisOrThatFirstImageId: dbThisOrThatFirstImageId,
  } = await prisma.$transaction(async (tx) => {
    const [lastMessage, latestAssistantMessage, latestAssistantMessageWithTonality] = await Promise.all([
      tx.message.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, role: true, content: true },
      }),
      tx.message.findFirst({
        where: {
          conversation: { id: conversationId, userId: user.id },
          role: MessageRole.AI,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          pending: true,
          selectedTonality: true,
          thisOrThatFirstImageId: true,
          additionalKwargs: true,
        },
      }),
      // Find the most recent assistant message that has a selectedTonality
      tx.message.findFirst({
        where: {
          conversation: { id: conversationId, userId: user.id },
          role: MessageRole.AI,
          selectedTonality: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          selectedTonality: true,
        },
      }),
    ]);

    // Pull state from DB
    // Use tonality from the message that has it, otherwise from latest message
    const pendingStateDB = latestAssistantMessage?.pending ?? PendingType.NONE;
    const selectedTonalityDB = latestAssistantMessageWithTonality?.selectedTonality ?? latestAssistantMessage?.selectedTonality ?? null;
    const thisOrThatFirstImageIdDB = latestAssistantMessage?.thisOrThatFirstImageId ?? undefined;
    const additionalKwargs = latestAssistantMessage?.additionalKwargs as any;
    productRecommendationContextFromDB = additionalKwargs?.productRecommendationContext;
    seasonalPaletteToSaveFromDB = additionalKwargs?.seasonalPaletteToSave;

    let savedMessage;
    if (lastMessage && lastMessage.role === MessageRole.USER) {
      const existingContent = lastMessage.content as MessageContent;
      const mergedContent = [...existingContent, ...content];

      savedMessage = await tx.message.update({
        where: { id: lastMessage.id },
        data: {
          content: mergedContent,
          ...(buttonPayload != null && { buttonPayload }),
          ...(media && {
            media: {
              create: {
                twilioUrl: media.originalUrl,
                serverUrl: media.serverUrl,
                mimeType: media.mimeType,
              },
            },
          }),
        },
      });
    } else {
      savedMessage = await tx.message.create({
        data: {
          conversationId,
          role: MessageRole.USER,
          content,
          ...(buttonPayload != null && { buttonPayload }),
          ...(media && {
            media: {
              create: {
                twilioUrl: media.originalUrl,
                serverUrl: media.serverUrl,
                mimeType: media.mimeType,
              },
            },
          }),
        },
      });
    }

    const messages = await tx.message
      .findMany({
        where: {
          conversationId,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          role: true,
          content: true,
          buttonPayload: true,
          createdAt: true,
        },
      })
      .then((msgs) => msgs.reverse());

    return {
      savedMessage,
      messages,
      pending: pendingStateDB,
      selectedTonality: selectedTonalityDB,
      thisOrThatFirstImageId: thisOrThatFirstImageIdDB,
    };
  });

  logger.debug(
    {
      pending: state.pending ?? dbPending,
      selectedTonality: state.selectedTonality ?? dbSelectedTonality,
      thisOrThatFirstImageId: state.thisOrThatFirstImageId ?? dbThisOrThatFirstImageId,
      messagesCount: messages.length,
    },
    'IngestMessage: Final state before returning',
  );

  queueImageUpload(user.id, savedMessage.id);

  const conversationHistoryWithImages: (UserMessage | AssistantMessage)[] = [];
  const conversationHistoryTextOnly: (UserMessage | AssistantMessage)[] = [];

  for (const msg of messages) {
    const meta = {
      createdAt: msg.createdAt,
      messageId: msg.id,
      ...(msg.role === MessageRole.USER && {
        buttonPayload: msg.buttonPayload,
      }),
    };

    const rawContent = msg.content as MessageContent;
    const textContent = extractTextContent(rawContent);

    // Convert localhost image URLs to data URLs for AI compatibility
    const contentWithImage: MessageContent = await Promise.all(
      rawContent.map(async (part: MessageContentPart) => {
        if (part.type === 'image_url' && part.image_url?.url) {
          const convertedUrl = await convertLocalhostUrlToDataUrl(part.image_url.url);
          return { ...part, image_url: { ...part.image_url, url: convertedUrl } };
        }
        return part;
      }),
    );

    if (msg.role === MessageRole.USER) {
      const messageWithImage = new UserMessage(contentWithImage);
      messageWithImage.meta = meta;
      conversationHistoryWithImages.push(messageWithImage);

      const textOnlyMessage = new UserMessage(textContent);
      textOnlyMessage.meta = meta;
      conversationHistoryTextOnly.push(textOnlyMessage);
    } else {
      const assistantMessage = new AssistantMessage(textContent);
      assistantMessage.meta = meta;
      conversationHistoryWithImages.push(assistantMessage);
      conversationHistoryTextOnly.push(assistantMessage);
    }
  }

  logger.debug({ userId, graphRunId }, 'Message ingested successfully');

  /**
   * The key: PREFER the latest computed state (from routing/handler) if set,
   * otherwise, use the value loaded from the DB.
   * Convert enum to string for state compatibility.
   */
  return {
    ...state,
    conversationHistoryWithImages,
    conversationHistoryTextOnly,
    pending: state.pending ?? dbPending,
    selectedTonality: state.selectedTonality ?? (dbSelectedTonality ? String(dbSelectedTonality) : null),
    thisOrThatFirstImageId: state.thisOrThatFirstImageId ?? dbThisOrThatFirstImageId,
    productRecommendationContext:
      state.productRecommendationContext ?? productRecommendationContextFromDB,
    seasonalPaletteToSave: state.seasonalPaletteToSave ?? seasonalPaletteToSaveFromDB,
    user,
    input,
  };
}
