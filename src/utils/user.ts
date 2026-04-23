import { User } from '@prisma/client';

/**
 * Checks if a user is a guest/temporary user.
 * Guest users are identified by having an appUserId that starts with "guest_"
 * or having a specific pattern indicating temporary access.
 *
 * @param user - The user to check
 * @returns true if the user is a guest user, false otherwise
 */
export function isGuestUser(user: User | null | undefined): boolean {
  if (!user) return true;

  if (user.isGuest) return true;

  return Boolean(user.appUserId?.startsWith('guest_') || user.appUserId?.startsWith('TEMP_'));
}
