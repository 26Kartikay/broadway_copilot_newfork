import { redis } from '../../lib/redis';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

const HISTORY_KEY = (userId: string) => `broadway:chat:${userId}`;
const CONTEXT_KEY = (userId: string) => `broadway:ctx:${userId}`;
const MAX_MESSAGES = 30;
const HISTORY_TTL = 60 * 60 * 24 * 7; // 7 days
const CONTEXT_TTL = 60 * 60; // 1 hour

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: any; // support string or Anthropic content blocks
  timestamp: number;
}

export interface UserContext {
  name: string;
  colorSeason: string | null;
  colorPalette: {
    suited: string[];
    toWear: string[];
    toAvoid: string[];
  } | null;
  preferences: string[]; // from Memory table
  gender: string | null;
  ageGroup: string | null;
  fitPreference: string | null;
  lastVibeCheck: string | null;
}

export async function getHistory(userId: string): Promise<StoredMessage[]> {
  try {
    const data = await redis.get(HISTORY_KEY(userId));
    if (!data) return [];
    return JSON.parse(data.toString());
  } catch (err) {
    logger.error({ err, userId }, 'Failed to get history from Redis');
    return [];
  }
}

export async function appendToHistory(
  userId: string,
  userMsg: any,
  assistantMsg: any
): Promise<void> {
  try {
    const history = await getHistory(userId);
    
    const newHistory = [
      ...history,
      { role: 'user', content: userMsg, timestamp: Date.now() },
      { role: 'assistant', content: assistantMsg, timestamp: Date.now() }
    ].slice(-MAX_MESSAGES);

    await redis.set(HISTORY_KEY(userId), JSON.stringify(newHistory), {
      EX: HISTORY_TTL
    });
  } catch (err) {
    logger.error({ err, userId }, 'Failed to append to history in Redis');
  }
}

export async function getUserContext(userId: string): Promise<UserContext> {
  try {
    // 1. Check Redis cache
    const cached = await redis.get(CONTEXT_KEY(userId));
    if (cached) return JSON.parse(cached.toString());

    // 2. Fetch from Prisma
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        colorAnalyses: {
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        memories: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        vibeChecks: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    if (!user) {
      logger.info({ userId }, 'User not found in DB, returning empty guest context');
      return {
        name: 'Guest',
        colorSeason: null,
        colorPalette: null,
        preferences: [],
        gender: null,
        ageGroup: null,
        fitPreference: null,
        lastVibeCheck: null
      };
    }

    const latestColorAnalysis = user.colorAnalyses[0];
    const latestVibeCheck = user.vibeChecks[0];

    const context: UserContext = {
      name: user.profileName || '',
      colorSeason: latestColorAnalysis?.palette_name || null,
      colorPalette: latestColorAnalysis ? {
        suited: latestColorAnalysis.colors_suited as string[] || [],
        toWear: latestColorAnalysis.colors_to_wear as string[] || [],
        toAvoid: latestColorAnalysis.colors_to_avoid as string[] || []
      } : null,
      preferences: user.memories.map(m => m.memory),
      gender: user.confirmedGender || user.inferredGender || null,
      ageGroup: user.confirmedAgeGroup || user.inferredAgeGroup || null,
      fitPreference: user.fitPreference || null,
      lastVibeCheck: latestVibeCheck?.createdAt.toISOString() || null
    };

    // 3. Cache in Redis
    await redis.set(CONTEXT_KEY(userId), JSON.stringify(context), {
      EX: CONTEXT_TTL
    });

    return context;
  } catch (err) {
    logger.error({ err, userId }, 'Failed to get user context');
    // Return empty context on error
    return {
      name: '',
      colorSeason: null,
      colorPalette: null,
      preferences: [],
      gender: null,
      ageGroup: null,
      fitPreference: null,
      lastVibeCheck: null
    };
  }
}

export async function invalidateContext(userId: string): Promise<void> {
  try {
    await redis.del(CONTEXT_KEY(userId));
  } catch (err) {
    logger.error({ err, userId }, 'Failed to invalidate user context');
  }
}

export async function clearHistory(userId: string): Promise<void> {
  try {
    await redis.del(HISTORY_KEY(userId));
  } catch (err) {
    logger.error({ err, userId }, 'Failed to clear history');
  }
}
