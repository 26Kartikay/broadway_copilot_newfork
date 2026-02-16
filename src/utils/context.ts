import { Conversation, ConversationStatus, Prisma, User } from '@prisma/client';
import { randomUUID } from 'crypto';

import { BaseMessage } from '../lib/ai/core/messages';
import { prisma } from '../lib/prisma';
import { queueMemoryExtraction } from '../lib/tasks';
import { NotFoundError } from './errors';
import { logger } from './logger';
import { isGuestUser } from './user';

const CONVERSATION_TIMEOUT_MS = 10 * 60 * 1000; // 30 minutes

async function handleStaleConversation(
  user: User,
  conversation: Conversation,
): Promise<Conversation> {
  if (isGuestUser(user)) {
    logger.debug({ userId: user.id }, 'Not closing stale conversation for guest user.');
    return conversation;
  }

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

  if (!isGuestUser(user)) {
    queueMemoryExtraction(user.id, conversation.id);
    logger.debug(
      { userId: user.id, conversationId: conversation.id },
      'Queued memory extraction for closed conversation.',
    );
  }

  return newConversation;
}

export async function getOrCreateUserAndConversation(
  whatsappId: string,
  profileName: string,
  appUserId: string,
): Promise<{ user: User; conversation: Conversation }> {
  // In production, only fetch existing users - NO creation, NO updates
  // Users must be created/updated via external APIs or database directly
  const isProduction = process.env.NODE_ENV === 'production';
  
  let user: User | null;
  
  if (isProduction) {
    // In production: ONLY fetch, never create or update
    user = await prisma.user.findUnique({
      where: { appUserId },
    });
    
    if (!user) {
      throw new NotFoundError(`User with appUserId ${appUserId} not found. User must be created via external API or database.`);
    }
    
    // Do NOT update anything - the database values are the source of truth
  } else {
    // In development, allow creating users for testing
    user = await prisma.user.upsert({
      where: { appUserId },
      update: {
        whatsappId,
        // Only update profileName if a non-empty one is provided
        ...(profileName && profileName.trim() && { profileName: profileName.trim() }),
      },
      create: {
        whatsappId,
        profileName: profileName && profileName.trim() ? profileName.trim() : '',
        appUserId,
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

  if (lastOpenConversation) {
    const timeSinceLastUpdate = Date.now() - new Date(lastOpenConversation.updatedAt).getTime();
    if (timeSinceLastUpdate > CONVERSATION_TIMEOUT_MS) {
      return {
        user,
        conversation: await handleStaleConversation(user, lastOpenConversation),
      };
    }
    return { user, conversation: lastOpenConversation };
  }

  logger.debug({ userId: user.id }, 'No open conversation found, creating a new one.');
  const newConversation = await prisma.conversation.create({
    data: { userId: user.id },
  });
  return { user, conversation: newConversation };
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
