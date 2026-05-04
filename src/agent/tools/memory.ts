import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { getUserContext, invalidateContext } from '../memory/redis';

export interface SavePreferenceInput {
  userId: string;
  preference: string;
}

export async function saveUserPreference(input: SavePreferenceInput) {
  const { userId, preference } = input;

  try {
    const userExists = await prisma.user.findUnique({ where: { id: userId } });
    if (userExists) {
      // FIRE AND FORGET: save preference text without embedding on this path
      prisma.memory
        .create({
          data: {
            userId,
            memory: preference,
            embeddingModel: 'memory-text-no-embed',
          },
        })
        .then(() => {
          return invalidateContext(userId);
        })
        .catch((err) => {
          logger.error({ err, userId }, 'Async memory creation failed');
        });
    }

    return { saved: true };
  } catch (err) {
    logger.error({ err, userId }, 'Error in saveUserPreference tool');
    return { saved: false, error: String(err) };
  }
}

export interface RecallPreferencesInput {
  userId: string;
  context?: string;
}

export async function recallUserPreferences(input: RecallPreferencesInput) {
  const { userId, context } = input;

  try {
    let memories: string[] = [];

    if (context) {
      // Use text-based search instead of vector search
      const results = await prisma.memory.findMany({
        where: {
          userId,
          memory: {
            contains: context,
            mode: 'insensitive',
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 15,
      });
      memories = results.map((r) => r.memory);

      // If no keyword matches, fallback to recent
      if (memories.length === 0) {
        const fallback = await prisma.memory.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });
        memories = fallback.map((r) => r.memory);
      }
    } else {
      const results = await prisma.memory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 15,
      });
      memories = results.map((r) => r.memory);
    }

    const profile = await getUserContext(userId);

    return {
      memories,
      colorSeason: profile.colorSeason,
      profile,
    };
  } catch (err) {
    logger.error({ err, userId }, 'Error in recallUserPreferences tool');
    return { memories: [], error: String(err) };
  }
}
