import { Severity } from '@prisma/client';
import { MessageInput } from '../lib/chat/types';
import { prisma } from '../lib/prisma';
import { dbLog } from '../utils/dbLogger';
import { logger } from '../utils/logger';
import { formatReplies } from './formatReply';
import { tryGuestRecProductGenderGate } from './guestRecProductGenderGate';
import { tryHandleHttpChatFlows } from './httpChatFlows';
import { buildMainMenuReplies, isMainMenuTrigger, type HttpReplyPayload } from './httpReplies';
import { clearHttpPendingFlow } from './memory/redis';
import { ChatOrchestrator } from './orchestrator';
import { analyticsService } from '../services/analyticsService';
import type { FlowType } from '../types/analytics';
import { analyticsUserIdFrom } from '../utils/analyticsUserId';
import { entryFlowFromContext } from '../utils/entryFlow';
import type { AgentResult } from './orchestrator';

export type { HttpReplyPayload } from './httpReplies';

const orchestrator = new ChatOrchestrator();

function trackStyleChatTurnAnalytics(params: {
  appUserId: string;
  messageInput: MessageInput;
  result: AgentResult;
  turnStartedAt: number;
}): void {
  const { appUserId, messageInput, result, turnStartedAt } = params;
  const sessionId = messageInput.MessageSid;
  if (!sessionId || !appUserId) return;

  const entryFlow: FlowType = entryFlowFromContext(result.intent, messageInput);
  const flowType: FlowType = entryFlow;
  const charCount = (messageInput.Body || messageInput.ButtonText || '').length;
  const hasImage = parseInt(messageInput.NumMedia || '0', 10) > 0;
  const messageIndex = result.messageIndex ?? 0;
  const latencyMs = Date.now() - turnStartedAt;
  const productIds = result.products.map((p: { id?: string }) => String(p.id ?? '')).filter(Boolean);

  analyticsService.track({
    eventName: 'style_chat_message_sent',
    userId: appUserId,
    sessionId,
    vibeSessionId: sessionId,
    flowType,
    platform: 'web',
    properties: {
      message_index: messageIndex,
      entry_flow: entryFlow,
      char_count: charCount,
      has_image_attachment: hasImage,
    },
  });

  analyticsService.track({
    eventName: 'style_chat_response_received',
    userId: appUserId,
    sessionId,
    vibeSessionId: sessionId,
    flowType,
    platform: 'web',
    properties: {
      latency_ms: latencyMs,
      response_included_products: productIds.length > 0,
      product_ids: productIds,
    },
  });

  if (result.recoShelf && result.recoShelf.productIds.length > 0) {
    analyticsService.track({
      eventName: 'reco_shelf_triggered',
      userId: appUserId,
      sessionId,
      vibeSessionId: sessionId,
      flowType,
      platform: 'web',
      properties: {
        product_ids: result.recoShelf.productIds,
        reco_source: result.recoShelf.recoSource,
        score_band: result.recoShelf.scoreBand,
        ...(result.recoShelf.paletteName ? { palette_name: result.recoShelf.paletteName } : {}),
      },
    });
  }
}

export function initializeAgent(): void {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    logger.error('OPENAI_API_KEY is required for the chat agent (GPT chat, intent, vision, and embeddings)');
    throw new Error('OPENAI_API_KEY is required');
  }
  logger.info('Broadway AI Agent initialized (OpenAI chat, intent, vision, and embeddings)');
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
      return {
        replies,
        pending: null,
        intent: 'main_menu',
        intentV2: 'User opened or returned to the main menu.',
      };
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
      return {
        replies: flow.replies,
        pending: flow.pending,
        intent: 'in_app_flow',
        intentV2: 'Handled by structured in-app flow (color / vibe / buttons / saves).',
      };
    }

    const guestRecGate = await tryGuestRecProductGenderGate(prismaUserId, messageInput, user);
    if (guestRecGate.kind === 'prompt') {
      dbLog(
        Severity.INFO,
        'agent',
        'Guest product-rec gender gate (prompt)',
        { userId: prismaUserId, messageId, replyCount: guestRecGate.replies.length },
        user ? { userId: prismaUserId } : {},
      );
      return {
        replies: guestRecGate.replies,
        pending: 'GUEST_REC_GENDER',
        intent: 'guest_product_gate',
        intentV2: 'Guest shopping flow — gender preference prompt before catalog picks.',
      };
    }

    if (guestRecGate.kind === 'replay') {
      const refreshedUser = await prisma.user.findUnique({ where: { id: prismaUserId } });
      const turnStartedAt = Date.now();
      const result = await orchestrator.handleTurn(prismaUserId, guestRecGate.messageInput);
      const replies = formatReplies(result, {
        user: refreshedUser ?? user,
        requestProfileName: guestRecGate.messageInput.ProfileName,
      });

      trackStyleChatTurnAnalytics({
        appUserId: analyticsUserIdFrom(refreshedUser ?? user, guestRecGate.messageInput) ?? '',
        messageInput: guestRecGate.messageInput,
        result,
        turnStartedAt,
      });

      dbLog(
        Severity.INFO,
        'agent',
        'Guest product-rec gender gate (replay)',
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
    }

    const turnStartedAt = Date.now();
    const result = await orchestrator.handleTurn(prismaUserId, messageInput);
    const replies = formatReplies(result, { user, requestProfileName: messageInput.ProfileName });

    trackStyleChatTurnAnalytics({
      appUserId: analyticsUserIdFrom(user, messageInput) ?? '',
      messageInput,
      result,
      turnStartedAt,
    });

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
