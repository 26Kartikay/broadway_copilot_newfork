// src/utils/user.ts

import { User } from '@prisma/client';

export const isGuestUser = (user: User): boolean => {
  return user.appUserId.startsWith('guest_');
};
