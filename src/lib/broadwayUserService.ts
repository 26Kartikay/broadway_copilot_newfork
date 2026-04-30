/**
 * Broadway user_service HTTP API — fetch profile by app user id for session-scoped cache
 * (see hydrate in utils/sessionUserProfile.ts). Avoids maintaining duplicate profile rows in copilot DB.
 */

import { logger } from '../utils/logger';

const DEFAULT_BASE = 'https://api.broadwaylive.in';
const FETCH_TIMEOUT_MS = Number(process.env.BROADWAY_USER_SERVICE_TIMEOUT_MS || 8000);

export interface BroadwaySessionUserProfile {
  name: string;
  statedGender: string | null;
  statedAge: string | null;
}

export function broadwayProfileHasUsefulData(p: BroadwaySessionUserProfile | null): boolean {
  if (!p) return false;
  return Boolean(
    (p.name && p.name.trim()) ||
      (p.statedGender && String(p.statedGender).trim()) ||
      (p.statedAge && String(p.statedAge).trim()),
  );
}

/** Session overlay when user_service returns nothing useful or the request fails. */
export function buildBroadwaySessionProfileFallback(displayNameFromClient: string): BroadwaySessionUserProfile {
  const t = String(displayNameFromClient ?? '').trim();
  return {
    name: t.length > 0 ? t : 'Friend',
    statedGender: null,
    statedAge: null,
  };
}

type ApiEnvelope = {
  success?: boolean;
  data?: {
    name?: string | null;
    stated_gender?: string | null;
    stated_age?: string | null;
  } | null;
};

function baseUrl(): string {
  const raw = (process.env.BROADWAY_USER_SERVICE_BASE_URL || DEFAULT_BASE).trim();
  return raw.replace(/\/$/, '');
}

/**
 * Fetches user profile from user_service. Returns null on network/parse errors or missing data.
 */
export async function fetchBroadwayUserProfileByAppUserId(
  appUserId: string,
): Promise<BroadwaySessionUserProfile | null> {
  const id = String(appUserId || '').trim();
  if (!id || !/^\d+$/.test(id)) {
    return null;
  }

  const url = `${baseUrl()}/user_service/auth/get_user_by_id/${encodeURIComponent(id)}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  const token = (process.env.BROADWAY_USER_SERVICE_BEARER_TOKEN || '').trim();
  if (token) {
    headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { method: 'GET', headers, signal: ac.signal });
    if (!res.ok) {
      logger.warn(
        { appUserId: id, status: res.status },
        'broadway user_service get_user_by_id non-OK',
      );
      return null;
    }
    const body = (await res.json()) as ApiEnvelope;
    if (!body?.data || body.success === false) {
      return null;
    }
    const d = body.data;
    const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim() : '';
    return {
      name,
      statedGender: d.stated_gender == null || d.stated_gender === '' ? null : String(d.stated_gender),
      statedAge: d.stated_age == null || d.stated_age === '' ? null : String(d.stated_age),
    };
  } catch (err) {
    logger.warn(
      { err, appUserId: id },
      'broadway user_service get_user_by_id failed',
    );
    return null;
  } finally {
    clearTimeout(t);
  }
}
