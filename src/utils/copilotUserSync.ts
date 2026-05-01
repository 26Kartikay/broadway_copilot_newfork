import { prisma } from '../lib/prisma';
import { getSessionUserProfile } from '../agent/memory/redis';
import { logger } from './logger';
import { profileNameIndicatesGuest } from './user';

/**
 * After session hydration, align the copilot User row with the app user id and display name
 * (client profile or user_service). Fixes stale `guest_<id>` + `Guest` rows that were never
 * updated in production because `getOrCreateUserAndConversation` only wrote updates in dev.
 */
export async function syncCopilotUserRowAfterHydrate(
  prismaUserId: string,
  trimmedClientProfile: string,
  rawAppUserId: string,
  isGuestAccount: boolean,
): Promise<void> {
  if (isGuestAccount) return;

  try {
    const session = await getSessionUserProfile(prismaUserId);
    const user = await prisma.user.findUnique({ where: { id: prismaUserId } });
    if (!user) return;

    const client = trimmedClientProfile.trim();
    const usableApiName =
      session?.name?.trim() &&
      session.name.trim() !== 'Friend' &&
      !profileNameIndicatesGuest(session.name)
        ? session.name.trim()
        : null;

    const displayName =
      (client.length > 0 && !profileNameIndicatesGuest(client) ? client : null) || usableApiName;

    const raw = String(rawAppUserId || '').trim();
    const plainId = raw.startsWith('guest_') ? raw.slice('guest_'.length) : raw;
    const nextAppUserId = /^\d+$/.test(plainId) ? plainId : user.appUserId;

    await prisma.user.update({
      where: { id: prismaUserId },
      data: {
        appUserId: nextAppUserId,
        isGuest: false,
        ...(displayName ? { profileName: displayName } : {}),
      },
    });
  } catch (err) {
    logger.warn(
      { err, prismaUserId },
      'syncCopilotUserRowAfterHydrate failed (possible appUserId conflict)',
    );
  }
}
