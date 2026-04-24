import { Severity } from '@prisma/client';
import { MessageInput } from '../lib/chat/types';
import { prisma } from '../lib/prisma';
import { dbLog } from '../utils/dbLogger';
import { logger } from '../utils/logger';
import { formatReplies } from './formatReply';
import { tryHandleHttpChatFlows } from './httpChatFlows';
import { buildMainMenuReplies, isMainMenuTrigger, type HttpReplyPayload } from './httpReplies';
import { clearHttpPendingFlow } from './memory/redis';
import { ChatOrchestrator } from './orchestrator';

export type { HttpReplyPayload } from './httpReplies';

const orchestrator = new ChatOrchestrator();

export function initializeAgent(): void {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    logger.error('ANTHROPIC_API_KEY is required for the chat agent (Claude Sonnet + Haiku)');
    throw new Error('ANTHROPIC_API_KEY is required');
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    logger.warn('OPENAI_API_KEY not set — catalog vector search will fall back to ILIKE text search');
  }
  logger.info('Broadway AI Agent initialized (Claude Sonnet for chat, Claude Haiku for intent, OpenAI for embeddings)');
}

export async function runAgentForHttp(
  prismaUserId: string,
  messageId: string,
  messageInput: MessageInput,
): Promise<{
  replies: HttpReplyPayload[];
  pending: string | null;
  intent?: string;
  intentV2?: string;
}> {
  try {
    const user = await prisma.user.findUnique({ where: { id: prismaUserId } });

    if (isMainMenuTrigger(messageInput)) {
      await clearHttpPendingFlow(prismaUserId);
      const replies = buildMainMenuReplies(messageInput.ProfileName);
      dbLog(
        Severity.INFO,
        'agent',
        'Static main menu replies',
        { userId: prismaUserId, messageId, replyCount: replies.length },
        user ? { userId: prismaUserId } : {},
      );
      return { replies, pending: null };
    }

    const flow = await tryHandleHttpChatFlows(prismaUserId, messageInput, user);
    if (flow.handled) {
      dbLog(
        Severity.INFO,
        'agent',
        'HTTP structured flow handled',
        {
          userId: prismaUserId,
          messageId,
          replyCount: flow.replies.length,
          pending: flow.pending,
        },
        user ? { userId: prismaUserId } : {},
      );
      return { replies: flow.replies, pending: flow.pending };
    }

    const result = await orchestrator.handleTurn(prismaUserId, messageInput);
    const replies = formatReplies(result, { user });
    dbLog(
      Severity.INFO,
      'agent',
      'Orchestrator turn complete',
      {
        userId: prismaUserId,
        messageId,
        toolsUsed: result.toolResults.map((t) => t.toolName),
        replyCount: replies.length,
      },
      user ? { userId: prismaUserId } : {},
    );

    return {
      replies,
      pending: null,
      ...(result.intent !== undefined && result.intent !== '' ? { intent: result.intent } : {}),
      ...(result.intentV2 !== undefined && result.intentV2 !== ''
        ? { intentV2: result.intentV2 }
        : {}),
    };
  } catch (err: unknown) {
    logger.error({ err, userId: prismaUserId, messageId }, 'Agent run failed');

    const userExists = await prisma.user.findUnique({ where: { id: prismaUserId } });
    const message = err instanceof Error ? err.message : String(err);
    dbLog(
      Severity.ERROR,
      'agent',
      'Agent run failed',
      {
        userId: prismaUserId,
        messageId,
        error: message,
      },
      userExists ? { userId: prismaUserId } : {},
    );

    const errReplies: HttpReplyPayload[] = [
      {
        reply_type: 'text',
        reply_text: "I'm having a moment — try again in a sec! 💛",
      },
    ];

    return { replies: errReplies, pending: null };
  }
}
