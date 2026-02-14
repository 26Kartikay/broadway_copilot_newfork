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
  
  // Check if appUserId starts with "guest_" or is a temporary identifier
  return user.appUserId?.startsWith('guest_') || user.appUserId?.startsWith('TEMP_') || false;
}

