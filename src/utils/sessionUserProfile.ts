import {
  broadwayProfileHasUsefulData,
  buildBroadwaySessionProfileFallback,
  fetchBroadwayUserProfileByAppUserId,
} from '../lib/broadwayUserService';
import {
  clearSessionUserProfile,
  getSessionUserProfile,
  setSessionUserProfile,
  touchSessionUserProfile,
} from '../agent/memory/redis';
import { logger } from './logger';
import { profileNameIndicatesGuest } from './user';

/**
 * After user/conversation resolution: load user_service profile into Redis for this chat session,
 * or clear it for guest-placeholder accounts. Non-guests always get a cached overlay (API or fallback).
 */
export async function hydrateSessionUserProfileForChat(
  prismaUserId: string,
  profileName: string,
  appUserId: string,
): Promise<void> {
  const trimmed = profileName?.trim() ?? '';
  const isGuestAccount = profileNameIndicatesGuest(trimmed);
  const raw = String(appUserId || '').trim();

  if (isGuestAccount) {
    await clearSessionUserProfile(prismaUserId);
    return;
  }

  const existing = await getSessionUserProfile(prismaUserId);
  if (existing) {
    await touchSessionUserProfile(prismaUserId);
    return;
  }

  const apiId = raw.startsWith('guest_') ? raw.slice('guest_'.length) : raw;
  let fromApi = apiId && /^\d+$/.test(apiId) ? await fetchBroadwayUserProfileByAppUserId(apiId) : null;

  if (fromApi && !broadwayProfileHasUsefulData(fromApi)) {
    fromApi = null;
  }

  const profile = fromApi ?? buildBroadwaySessionProfileFallback(trimmed);

  if (!fromApi) {
    logger.debug(
      { prismaUserId, apiId: apiId || raw },
      'user_service returned no useful profile; using session fallback',
    );
  }

  await setSessionUserProfile(prismaUserId, profile);
}
