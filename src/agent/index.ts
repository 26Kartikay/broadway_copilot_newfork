import { MessageInput } from '../lib/chat/types';
import { prisma } from '../lib/prisma';
import { runAgent } from './agent';
import { formatReplies } from './formatReply';
import {
  buildMainMenuReplies,
  isMainMenuTrigger,
  type HttpReplyPayload,
} from './httpReplies';

export type { HttpReplyPayload } from './httpReplies';
import { logger } from '../utils/logger';
import { dbLog } from '../utils/dbLogger';
import { Severity } from '@prisma/client';

export function initializeAgent(): void {
  if (!process.env.GROQ_API_KEY?.trim()) {
    logger.error('GROQ_API_KEY is required for the chat agent (Llama tool calling)');
    throw new Error('GROQ_API_KEY is required');
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    logger.error('OPENAI_API_KEY is required for vision tools and catalog embeddings');
    throw new Error('OPENAI_API_KEY is required');
  }
  logger.info('Broadway AI Agent initialized (Groq Llama + OpenAI vision/embeddings)');
}

export async function runAgentForHttp(
  prismaUserId: string,
  messageId: string,
  messageInput: MessageInput
): Promise<{ replies: HttpReplyPayload[]; pending: null }> {
  try {
    const user = await prisma.user.findUnique({ where: { id: prismaUserId } });

    if (isMainMenuTrigger(messageInput)) {
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

    const result = await runAgent(prismaUserId, messageInput);
    const replies = formatReplies(result, { user });
    dbLog(
      Severity.INFO,
      'agent',
      'Agent run complete',
      {
        userId: prismaUserId,
        messageId,
        toolsUsed: result.toolResults.map((t: any) => t.toolName),
        replyCount: replies.length,
      },
      user ? { userId: prismaUserId } : {},
    );

    return { replies, pending: null };
  } catch (err: any) {
    logger.error({ err, userId: prismaUserId, messageId }, 'Agent run failed');

    const userExists = await prisma.user.findUnique({ where: { id: prismaUserId } });
    dbLog(
      Severity.ERROR,
      'agent',
      'Agent run failed',
      {
        userId: prismaUserId,
        messageId,
        error: err.message,
      },
      userExists ? { userId: prismaUserId } : {},
    );

    const errReplies: HttpReplyPayload[] = [
      {
        reply_type: 'text',
        reply_text: "I'm having a moment — try again in a sec! 💛",
      },
      {
        reply_type: 'quick_reply',
        reply_text: 'Try one of these:',
        buttons: [
          { id: 'main_menu', text: 'Main menu' },
          { id: 'style_studio', text: 'Style Studio' },
        ],
      },
    ];

    return { replies: errReplies, pending: null };
  }
}
