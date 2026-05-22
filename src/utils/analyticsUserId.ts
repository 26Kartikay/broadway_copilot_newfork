import type { MessageInput } from '../lib/chat/types';
import type { User } from '@prisma/client';

/** App user id for analytics — matches ChatRequest.userId / User.appUserId. */
export function analyticsUserIdFrom(
  user: Pick<User, 'appUserId'> | null | undefined,
  messageInput?: MessageInput,
): string | undefined {
  const fromUser = user?.appUserId?.trim();
  if (fromUser) return fromUser;
  const fromRequest = messageInput?.WaId?.trim();
  if (fromRequest) return fromRequest;
  return undefined;
}
