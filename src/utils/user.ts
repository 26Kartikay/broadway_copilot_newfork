import { User } from '@prisma/client';

/** True when display name is the generic guest placeholder (case-insensitive, trimmed). */
export function profileNameIndicatesGuest(profileName: string | null | undefined): boolean {
  const t = String(profileName ?? '').trim();
  if (!t) return false;
  return t.toLowerCase() === 'guest';
}

/**
 * Checks if a user is a guest/temporary user.
 * Guest users: `isGuest` in DB, appUserId prefix guest_/TEMP_, or profile / request name
 * normalized to the placeholder "guest".
 *
 * @param user - The user to check
 * @param requestProfileName - Optional profile name from the current request (HTTP chat); used so guest flow applies even if DB row is stale in production.
 */
export function isGuestUser(
  user: User | null | undefined,
  requestProfileName?: string | null,
): boolean {
  if (!user) return true;

  if (user.isGuest) return true;

  if (profileNameIndicatesGuest(user.profileName)) return true;

  if (profileNameIndicatesGuest(requestProfileName)) return true;

  return Boolean(user.appUserId?.startsWith('guest_') || user.appUserId?.startsWith('TEMP_'));
}
