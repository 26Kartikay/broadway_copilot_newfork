import { Conversation, ConversationStatus, Prisma, User } from '@prisma/client';

import { BaseMessage } from '../lib/ai/core/messages';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { queueMemoryExtraction } from '../lib/tasks';
import { NotFoundError } from './errors';
import { logger } from './logger';
import { isGuestUser } from './user';

const CONVERSATION_TIMEOUT_MS = 10 * 60 * 1000; // 30 minutes

/** Sentinel conversation ID for ephemeral guest sessions (no DB row). */
export const EPHEMERAL_GUEST_CONVERSATION_ID = 'ephemeral-guest';

/** Max messages to keep in Redis for guest history. */
const GUEST_HISTORY_MAX_MESSAGES = 20;
/** TTL in seconds for guest Redis keys (24h). */
const GUEST_HISTORY_TTL_SECONDS = 24 * 60 * 60;
const GUEST_HISTORY_KEY_PREFIX = 'guest:history:';
const GUEST_STATE_KEY_PREFIX = 'guest:state:';

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
 * Get user and conversation by appUserId only (no create).
 * Returns null when user is not in DB and appUserId looks like a guest id (guest_* or TEMP_*).
 * In production, throws NotFoundError when user not in DB and not a guest id.
 */
export async function tryGetUserAndConversation(
  whatsappId: string,
  profileName: string,
  appUserId: string,
): Promise<{ user: User; conversation: Conversation } | null> {
  const user = await prisma.user.findUnique({
    where: { appUserId },
  });
  if (!user) {
    const isGuestId =
      appUserId.startsWith('guest_') || appUserId.startsWith('TEMP_');
    if (isGuestId) {
      return null;
    }
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundError(
        `User with appUserId ${appUserId} not found. User must be created via external API or database.`,
      );
    }
    // Development: create for non-guest as before
    const created = await prisma.user.upsert({
      where: { appUserId },
      update: {
        whatsappId,
        ...(profileName?.trim() && { profileName: profileName.trim() }),
      },
      create: {
        whatsappId,
        profileName: profileName?.trim() ?? '',
        appUserId,
      },
    });
    const conv = await getOrCreateConversationForUser(created.id);
    return { user: created, conversation: conv };
  }
  const lastOpenConversation = await prisma.conversation.findFirst({
    where: { userId: user.id, status: ConversationStatus.OPEN },
    orderBy: { updatedAt: 'desc' },
  });
  if (lastOpenConversation) {
    const timeSinceLastUpdate =
      Date.now() - new Date(lastOpenConversation.updatedAt).getTime();
    if (timeSinceLastUpdate <= CONVERSATION_TIMEOUT_MS) {
      return { user, conversation: lastOpenConversation };
    }
    return {
      user,
      conversation: await handleStaleConversation(user, lastOpenConversation),
    };
  }
  const newConversation = await prisma.conversation.create({
    data: { userId: user.id },
  });
  return { user, conversation: newConversation };
}

async function getOrCreateConversationForUser(
  userId: string,
): Promise<Conversation> {
  const open = await prisma.conversation.findFirst({
    where: { userId, status: ConversationStatus.OPEN },
    orderBy: { updatedAt: 'desc' },
  });
  if (open) return open;
  return prisma.conversation.create({
    data: { userId },
  });
}

/** Serializable guest message for Redis. */
export interface GuestHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
}

export async function getGuestHistory(
  appUserId: string,
): Promise<GuestHistoryMessage[]> {
  const key = GUEST_HISTORY_KEY_PREFIX + appUserId;
  const raw = await redis.get(key);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as GuestHistoryMessage[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function appendGuestHistory(
  appUserId: string,
  role: 'user' | 'assistant',
  text: string,
): Promise<void> {
  const key = GUEST_HISTORY_KEY_PREFIX + appUserId;
  const prev = await getGuestHistory(appUserId);
  const next = [...prev, { role, text }].slice(-GUEST_HISTORY_MAX_MESSAGES);
  await redis.setEx(key, GUEST_HISTORY_TTL_SECONDS, JSON.stringify(next));
}

/**
 * Load previous conversation state for a guest from Redis (quiz/pending etc.).
 * Returns null if none or on error.
 */
export type GuestPreviousState = {
  quizQuestions?: unknown;
  quizAnswers?: unknown;
  currentQuestionIndex?: number;
  pending?: string;
  selectedTonality?: string;
};

export async function getGuestPreviousState(
  appUserId: string,
): Promise<GuestPreviousState | null> {
  const key = GUEST_STATE_KEY_PREFIX + appUserId;
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GuestPreviousState;
  } catch {
    return null;
  }
}

export async function setGuestPreviousState(
  appUserId: string,
  state: GuestPreviousState,
): Promise<void> {
  const key = GUEST_STATE_KEY_PREFIX + appUserId;
  await redis.setEx(key, GUEST_HISTORY_TTL_SECONDS, JSON.stringify(state));
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
