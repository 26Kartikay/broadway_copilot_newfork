import { Conversation, ConversationStatus, User } from '@prisma/client';

import { BaseMessage } from '../lib/ai/core/messages';
import { prisma } from '../lib/prisma';
import { resetChatSessionState } from '../agent/memory/redis';
import { logger } from './logger';
import { CHAT_SESSION_INACTIVITY_MS } from './constants';
import { syncCopilotUserRowAfterHydrate } from './copilotUserSync';
import { hydrateSessionUserProfileForChat } from './sessionUserProfile';
import { profileNameIndicatesGuest } from './user';

async function handleStaleConversation(
  user: User,
  conversation: Conversation,
): Promise<Conversation> {
  logger.debug(
    { userId: user.id, conversationId: conversation.id },
    'Stale conversation detected, closing and creating a new one.',
  );

  const [, newConversation] = await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: ConversationStatus.CLOSED },
    }),
    prisma.conversation.create({
      data: { userId: user.id },
    }),
  ]);

  return newConversation;
}

export async function getOrCreateUserAndConversation(
  whatsappId: string,
  profileName: string,
  appUserId: string,
): Promise<{ user: User; conversation: Conversation }> {
  const isProduction = process.env.NODE_ENV === 'production';
  const trimmedProfile = profileName?.trim() ?? '';
  /** Guest only when display name is the literal placeholder "guest", not when the name is missing. */
  const anonymous = profileNameIndicatesGuest(trimmedProfile);
  const rawAppUserId = String(appUserId || '').trim() || whatsappId;
  const guestTaggedAppUserId = rawAppUserId.startsWith('guest_')
    ? rawAppUserId
    : `guest_${rawAppUserId}`;

  let user = await prisma.user.findFirst({
    where: {
      OR: [{ appUserId: rawAppUserId }, { appUserId: guestTaggedAppUserId }],
    },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        appUserId: anonymous ? guestTaggedAppUserId : rawAppUserId,
        whatsappId,
        profileName: anonymous ? 'Guest' : trimmedProfile,
        details: anonymous ? 'Unknown' : '',
        isGuest: anonymous,
      },
    });
  } else if (!isProduction) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        whatsappId,
        isGuest: anonymous,
        ...(anonymous ? { appUserId: guestTaggedAppUserId, profileName: 'Guest' } : {}),
        ...(trimmedProfile && { profileName: trimmedProfile }),
      },
    });
  }

  const lastOpenConversation = await prisma.conversation.findFirst({
    where: {
      userId: user.id,
      status: ConversationStatus.OPEN,
    },
    orderBy: { updatedAt: 'desc' },
  });

  let result: { user: User; conversation: Conversation };

  if (lastOpenConversation) {
    const timeSinceLastUpdate = Date.now() - new Date(lastOpenConversation.updatedAt).getTime();
    if (timeSinceLastUpdate > CHAT_SESSION_INACTIVITY_MS) {
      await resetChatSessionState(user.id);
      result = {
        user,
        conversation: await handleStaleConversation(user, lastOpenConversation),
      };
    } else {
      result = { user, conversation: lastOpenConversation };
    }
  } else {
    logger.debug({ userId: user.id }, 'No open conversation found, creating a new one.');
    const newConversation = await prisma.conversation.create({
      data: { userId: user.id },
    });
    result = { user, conversation: newConversation };
  }

  await hydrateSessionUserProfileForChat(result.user.id, trimmedProfile, rawAppUserId);
  await syncCopilotUserRowAfterHydrate(result.user.id, trimmedProfile, rawAppUserId, anonymous);

  const refreshed = await prisma.user.findUnique({ where: { id: result.user.id } });
  if (refreshed) {
    result = { ...result, user: refreshed };
  }

  return result;
}

/**
 * Counts the number of image attachments in the most recent message.
 * Used to determine if image processing features should be triggered.
 *
 * @param conversationHistoryWithImages - Array of conversation messages with image data
 * @returns Number of image URLs in the latest message
 */
export function numImagesInMessage(conversationHistoryWithImages: BaseMessage[]): number {
  if (!conversationHistoryWithImages || conversationHistoryWithImages.length === 0) {
    return 0;
  }

  const latestMessage = conversationHistoryWithImages.at(-1);
  if (!latestMessage || !latestMessage.content) {
    return 0;
  }

  if (!Array.isArray(latestMessage.content)) {
    return 0;
  }

  return latestMessage.content.filter((item) => item.type === 'image_url').length;
}
