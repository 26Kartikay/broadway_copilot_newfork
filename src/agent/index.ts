import { MessageInput, Reply } from '../lib/chat/types';
import { runAgent } from './agent';
import { formatReplies } from './formatReply';
import { logger } from '../utils/logger';
import { dbLog } from '../utils/dbLogger';
import { Severity } from '@prisma/client';

export function initializeAgent(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.error('ANTHROPIC_API_KEY is required but not set in environment variables');
    throw new Error('ANTHROPIC_API_KEY is required');
  }
  logger.info('Broadway AI Agent initialized (Claude ReAct)');
}

export async function runAgentForHttp(
  userId: string,
  messageId: string,
  messageInput: MessageInput
): Promise<{ replies: Reply[], pending: null }> {
  try {
    const result = await runAgent(userId, messageInput);
    const replies = formatReplies(result) as Reply[];
    
    // Log to ServiceLog
    const userExists = await prisma.user.findUnique({ where: { id: userId } });
    dbLog(Severity.INFO, 'agent', 'Agent run complete', {
      userId,
      messageId,
      toolsUsed: result.toolResults.map((t: any) => t.toolName),
      replyCount: replies.length
    }, userExists ? { userId } : {});

    return { replies, pending: null };
  } catch (err: any) {
    logger.error({ err, userId, messageId }, 'Agent run failed');
    
    const userExists = await prisma.user.findUnique({ where: { id: userId } });
    dbLog(Severity.ERROR, 'agent', 'Agent run failed', {
      userId,
      messageId,
      error: err.message
    }, userExists ? { userId } : {});

    return {
      replies: [{
        reply_type: "text_only",
        reply_text: "I'm having a moment — try again in a sec! 💛",
        expected_action: "input_required"
      } as any],
      pending: null
    };
  }
}
