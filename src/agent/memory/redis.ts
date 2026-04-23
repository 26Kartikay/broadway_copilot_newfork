import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import { logger } from '../../utils/logger';

const HISTORY_KEY = (userId: string) => `broadway:chat:${userId}`;
const CONTEXT_KEY = (userId: string) => `broadway:ctx:${userId}`;
const MAX_MESSAGES = 30;
const HISTORY_TTL = 60 * 60 * 24 * 7; // 7 days
const CONTEXT_TTL = 60 * 60; // 1 hour

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: unknown; // string or multimodal content blocks
  timestamp: number;
}

/** Replace image blocks with a tiny placeholder so Redis history stays small (avoids resending base64 every turn). */
export function stripHeavyMediaFromContent(content: unknown): unknown {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content;
  return content.map((block: { type?: string }) => {
    if (block?.type === 'image') {
      return { type: 'text', text: '[image]' };
    }
    return block;
  });
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

function coerceStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((x) => String(x)).filter((s) => s.length > 0);
  }
  if (typeof value === 'string') {
    const t = value.trim();
    return t ? [t] : [];
  }
  if (typeof value === 'object') {
    const vals = Object.values(value as Record<string, unknown>);
    if (vals.length && vals.every((v) => v != null)) {
      return vals.map((v) => String(v)).filter((s) => s.length > 0);
    }
  }
  return [];
}

/** Prisma Json + Redis round-trip can leave color lists as non-arrays — normalize before use. */
export function normalizeUserContext(raw: unknown): UserContext {
  if (!raw || typeof raw !== 'object') {
    return {
      name: '',
      colorSeason: null,
      colorPalette: null,
      preferences: [],
      gender: null,
      ageGroup: null,
      fitPreference: null,
      lastVibeCheck: null,
    };
  }
  const c = raw as Record<string, unknown>;
  let colorPalette: UserContext['colorPalette'] = null;
  const pal = c.colorPalette;
  if (pal && typeof pal === 'object') {
    const p = pal as Record<string, unknown>;
    colorPalette = {
      suited: coerceStringArray(p.suited),
      toWear: coerceStringArray(p.toWear),
      toAvoid: coerceStringArray(p.toAvoid),
    };
  }
  return {
    name: typeof c.name === 'string' ? c.name : String(c.name ?? ''),
    colorSeason: c.colorSeason == null || c.colorSeason === '' ? null : String(c.colorSeason),
    colorPalette,
    preferences: coerceStringArray(c.preferences),
    gender: c.gender == null || c.gender === '' ? null : String(c.gender),
    ageGroup: c.ageGroup == null || c.ageGroup === '' ? null : String(c.ageGroup),
    fitPreference:
      c.fitPreference == null || c.fitPreference === '' ? null : String(c.fitPreference),
    lastVibeCheck:
      c.lastVibeCheck == null || c.lastVibeCheck === '' ? null : String(c.lastVibeCheck),
  };
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
  userMsg: unknown,
  assistantMsg: unknown,
): Promise<void> {
  try {
    const history = await getHistory(userId);

    const newHistory = [
      ...history,
      {
        role: 'user',
        content: stripHeavyMediaFromContent(userMsg),
        timestamp: Date.now(),
      },
      {
        role: 'assistant',
        content: stripHeavyMediaFromContent(assistantMsg),
        timestamp: Date.now(),
      },
    ].slice(-MAX_MESSAGES);

    await redis.set(HISTORY_KEY(userId), JSON.stringify(newHistory), {
      EX: HISTORY_TTL,
    });
  } catch (err) {
    logger.error({ err, userId }, 'Failed to append to history in Redis');
  }
}

export async function getUserContext(userId: string): Promise<UserContext> {
  try {
    // 1. Check Redis cache
    const cached = await redis.get(CONTEXT_KEY(userId));
    if (cached) {
      return normalizeUserContext(JSON.parse(cached.toString()));
    }

    // 2. Fetch from Prisma
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        colorAnalyses: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        memories: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        vibeChecks: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!user) {
      logger.info({ userId }, 'User not found in DB, returning empty guest context');
      return normalizeUserContext({
        name: 'Guest',
        colorSeason: null,
        colorPalette: null,
        preferences: [],
        gender: null,
        ageGroup: null,
        fitPreference: null,
        lastVibeCheck: null,
      });
    }

    const latestColorAnalysis = user.colorAnalyses[0];
    const latestVibeCheck = user.vibeChecks[0];

    const context = normalizeUserContext({
      name: user.profileName || '',
      colorSeason: latestColorAnalysis?.palette_name || null,
      colorPalette: latestColorAnalysis
        ? {
            suited: latestColorAnalysis.colors_suited,
            toWear: latestColorAnalysis.colors_to_wear,
            toAvoid: latestColorAnalysis.colors_to_avoid,
          }
        : null,
      preferences: user.memories.map((m) => m.memory),
      gender: user.confirmedGender || user.inferredGender || null,
      ageGroup: user.confirmedAgeGroup || user.inferredAgeGroup || null,
      fitPreference: user.fitPreference || null,
      lastVibeCheck: latestVibeCheck?.createdAt.toISOString() || null,
    });

    // 3. Cache in Redis
    await redis.set(CONTEXT_KEY(userId), JSON.stringify(context), {
      EX: CONTEXT_TTL,
    });

    return context;
  } catch (err) {
    logger.error({ err, userId }, 'Failed to get user context');
    return normalizeUserContext(null);
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

/** Structured chat flows (color / vibe) pending state for HTTP clients. */
export type HttpPendingFlow =
  | { type: 'NONE' }
  | { type: 'COLOR_ANALYSIS_IMAGE' }
  | { type: 'TONALITY_SELECTION' }
  | { type: 'VIBE_CHECK_IMAGE'; tonality: string };

const HTTP_PENDING_KEY = (userId: string) => `broadway:http_pending:${userId}`;
const COLOR_ANALYSIS_STAGE_KEY = (userId: string) => `broadway:color_analysis_stage:${userId}`;
const HTTP_FLOW_TTL_SEC = 60 * 60 * 24;

export async function getHttpPendingFlow(userId: string): Promise<HttpPendingFlow> {
  try {
    const raw = await redis.get(HTTP_PENDING_KEY(userId));
    if (!raw) return { type: 'NONE' };
    const parsed = JSON.parse(raw.toString()) as HttpPendingFlow;
    return parsed?.type ? parsed : { type: 'NONE' };
  } catch (err) {
    logger.error({ err, userId }, 'getHttpPendingFlow failed');
    return { type: 'NONE' };
  }
}

export async function setHttpPendingFlow(userId: string, state: HttpPendingFlow): Promise<void> {
  try {
    if (state.type === 'NONE') {
      await redis.del(HTTP_PENDING_KEY(userId));
      return;
    }
    await redis.set(HTTP_PENDING_KEY(userId), JSON.stringify(state), {
      EX: HTTP_FLOW_TTL_SEC,
    });
  } catch (err) {
    logger.error({ err, userId }, 'setHttpPendingFlow failed');
  }
}

export async function clearHttpPendingFlow(userId: string): Promise<void> {
  await setHttpPendingFlow(userId, { type: 'NONE' });
}

export type StagedColorAnalysisSave = {
  skin_tone: string;
  eye_color: string;
  hair_color: string;
  undertone: string;
  compliment: string;
  palette_name: string;
  palette_description: string;
  colors_suited: string[];
  colors_to_wear: unknown;
  colors_to_avoid: unknown;
};

export async function getStagedColorAnalysis(
  userId: string,
): Promise<StagedColorAnalysisSave | null> {
  try {
    const raw = await redis.get(COLOR_ANALYSIS_STAGE_KEY(userId));
    if (!raw) return null;
    return JSON.parse(raw.toString()) as StagedColorAnalysisSave;
  } catch (err) {
    logger.error({ err, userId }, 'getStagedColorAnalysis failed');
    return null;
  }
}

export async function setStagedColorAnalysis(
  userId: string,
  payload: StagedColorAnalysisSave,
): Promise<void> {
  try {
    await redis.set(COLOR_ANALYSIS_STAGE_KEY(userId), JSON.stringify(payload), {
      EX: HTTP_FLOW_TTL_SEC,
    });
  } catch (err) {
    logger.error({ err, userId }, 'setStagedColorAnalysis failed');
  }
}

export async function clearStagedColorAnalysis(userId: string): Promise<void> {
  try {
    await redis.del(COLOR_ANALYSIS_STAGE_KEY(userId));
  } catch (err) {
    logger.error({ err, userId }, 'clearStagedColorAnalysis failed');
  }
}

// ─── Search session: hybrid product recommendation context ───────────────────

export interface SearchSession {
  /** All product IDs surfaced this session — never repeat these on "show more". */
  lastProductIds: string[];
  /** Color season injected after a color analysis — emphasize in next product search. */
  postServiceColorSeason: string | null;
  /** Flipped true when user expresses dislike — stops palette emphasis. */
  paletteNormalized: boolean;
}

const SEARCH_SESSION_KEY = (userId: string) => `broadway:search_session:${userId}`;
const SEARCH_SESSION_TTL = 60 * 60 * 2; // 2 hours
const MAX_SESSION_PRODUCT_IDS = 36; // ~3 pages, then auto-reset

function emptySearchSession(): SearchSession {
  return { lastProductIds: [], postServiceColorSeason: null, paletteNormalized: false };
}

export async function getSearchSession(userId: string): Promise<SearchSession> {
  try {
    const raw = await redis.get(SEARCH_SESSION_KEY(userId));
    if (!raw) return emptySearchSession();
    return JSON.parse(raw.toString()) as SearchSession;
  } catch (err) {
    logger.error({ err, userId }, 'getSearchSession failed');
    return emptySearchSession();
  }
}

async function saveSearchSession(userId: string, session: SearchSession): Promise<void> {
  try {
    await redis.set(SEARCH_SESSION_KEY(userId), JSON.stringify(session), {
      EX: SEARCH_SESSION_TTL,
    });
  } catch (err) {
    logger.error({ err, userId }, 'saveSearchSession failed');
  }
}

/** Called after a product search — accumulate IDs, reset if cap exceeded. */
export async function recordShownProducts(userId: string, productIds: string[]): Promise<void> {
  if (!productIds.length) return;
  const session = await getSearchSession(userId);
  const combined = [...new Set([...session.lastProductIds, ...productIds])];
  // Auto-reset after cap: user has seen enough, start fresh next page
  session.lastProductIds = combined.length > MAX_SESSION_PRODUCT_IDS ? productIds : combined;
  await saveSearchSession(userId, session);
}

/** Called after color analysis succeeds — next product search should use this season. */
export async function setPostServiceColorSeason(userId: string, season: string): Promise<void> {
  const session = await getSearchSession(userId);
  session.postServiceColorSeason = season;
  session.paletteNormalized = false;
  await saveSearchSession(userId, session);
}

/** Called when user expresses dislike — stop emphasizing palette, start fresh product list. */
export async function normalizeAndRefreshSearch(userId: string): Promise<void> {
  const session = await getSearchSession(userId);
  session.paletteNormalized = true;
  // Clear seen IDs so user gets a genuinely fresh set
  session.lastProductIds = [];
  await saveSearchSession(userId, session);
}

/** Full reset — e.g. on main menu or explicit "start over". */
export async function resetSearchSession(userId: string): Promise<void> {
  try {
    await redis.del(SEARCH_SESSION_KEY(userId));
  } catch (err) {
    logger.error({ err, userId }, 'resetSearchSession failed');
  }
}
