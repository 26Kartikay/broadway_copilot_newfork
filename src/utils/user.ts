import { User } from '@prisma/client';

/** True when display name is the generic guest placeholder (case-insensitive, trimmed). */
export function profileNameIndicatesGuest(profileName: string | null | undefined): boolean {
  const t = String(profileName ?? '').trim();
  if (!t) return false;
  return t.toLowerCase() === 'guest';
}

/**
 * Guest only when the display name is the placeholder "guest" (case-insensitive),
 * from the request or the stored profile — not from empty name or appUserId prefix alone.
 *
 * @param requestProfileName - Optional profile name from the current request (HTTP chat).
 */
export function isGuestUser(
  user: User | null | undefined,
  requestProfileName?: string | null,
): boolean {
  if (profileNameIndicatesGuest(requestProfileName)) return true;
  if (profileNameIndicatesGuest(user?.profileName)) return true;
  return false;
}
