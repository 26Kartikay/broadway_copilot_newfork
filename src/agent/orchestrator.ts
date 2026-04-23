import { createId } from '@paralleldrive/cuid2';
import { z } from 'zod';
import { agentExecutor } from '../lib/ai/agents/executor';
import { ChatAnthropic } from '../lib/ai/anthropic/chat_models';
import { AssistantMessage, MessageContent, SystemMessage, UserMessage } from '../lib/ai/core/messages';
import { MessageInput } from '../lib/chat/types';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { AGENT_MAX_COMPLETION_TOKENS, ANTHROPIC_CHAT_MODEL } from './anthropicModels';
import { classifyIntent } from './intentClassifier';
import {
  appendToHistory,
  getHistory,
  getSearchSession,
  getUserContext,
  normalizeAndRefreshSearch,
  recordShownProducts,
  SearchSession,
  setPostServiceColorSeason,
  StoredMessage,
} from './memory/redis';
import { buildSystemPrompt } from './systemPrompt';
import { getToolsForIntent } from './toolRouter';
import { getTools } from './tools/allTools';
import { TraceBuffer } from './tracing';

export interface AgentResult {
  text: string;
  toolResults: any[];
  products: any[];
  colorAnalysis: any | null;
  vibeCheck: any | null;
}

const responseSchema = z.object({
  reply: z.string().describe('The conversational response to the user'),
  used_tools: z.array(z.string()).optional().describe('Tool names used'),
  suggested_follow_up: z.string().optional().describe('One follow-up question if relevant'),
});

/** Match current-turn fallback so Redis never stores a bare empty user line (Anthropic rejects empty text blocks). */
const EMPTY_USER_HISTORY_PLACEHOLDER = '(empty)';
const EMPTY_ASSISTANT_HISTORY_PLACEHOLDER = '[no text]';

function extractTextFromStoredContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: { type?: string }) => b.type === 'text')
      .map((b: { text?: string }) => b.text ?? '')
      .join(' ');
  }
  return String(content);
}

/** Non-empty text for replaying a StoredMessage into UserMessage / AssistantMessage. */
function textForHistoryReplay(role: 'user' | 'assistant', extracted: string): string {
  if (extracted.trim().length > 0) return extracted;
  return role === 'user' ? EMPTY_USER_HISTORY_PLACEHOLDER : EMPTY_ASSISTANT_HISTORY_PLACEHOLDER;
}

function buildRollingContext(history: StoredMessage[]): string {
  if (history.length === 0) return '';
  return history
    .slice(-6)
    .map((m) => {
      const content = extractTextFromStoredContent(m.content);
      return `${m.role}: ${content.slice(0, 120)}`;
    })
    .join('\n');
}

function buildImageMessageContent(userImages: any[]): MessageContent {
  const parts: MessageContent = [];
  for (const img of userImages) {
    if (img?.type === 'image' && img?.source?.type === 'base64' && img.source?.data) {
      const mt = img.source.media_type || 'image/jpeg';
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${mt};base64,${img.source.data}` },
      });
    }
  }
  return parts;
}

/** Build an extra paragraph for the system prompt describing the current search session. */
function buildSearchSessionContext(
  session: SearchSession,
  isDislikeMore: boolean,
  isNeutralMore: boolean,
  isForSelf: boolean,
  recipientGender: string | undefined,
  userGender: string | null,
): string {
  const lines: string[] = [];

  if (isDislikeMore) {
    lines.push('SEARCH MODE: User expressed DISLIKE — search for completely different products. Do NOT use the same style, color, or category as before. Be bold with new picks.');
  } else if (isNeutralMore) {
    lines.push('SEARCH MODE: User wants MORE similar products — same vibe but fresh items. They have already seen the excluded IDs.');
  }

  if (session.postServiceColorSeason && !session.paletteNormalized) {
    lines.push(`POST-SERVICE CONTEXT: User just completed color analysis. Their palette is ${session.postServiceColorSeason} — naturally weave this into product search and your response.`);
  }

  if (session.paletteNormalized) {
    lines.push('PALETTE CONTEXT: User expressed dislike of palette-matched suggestions. Do NOT emphasize color season — search by style, occasion, and category instead.');
  }

  if (!isForSelf && recipientGender) {
    lines.push(`RECIPIENT: User is shopping for someone else (${recipientGender}). Frame recommendations for that person, not the user themselves.`);
  } else if (!isForSelf) {
    lines.push('RECIPIENT: User is shopping as a gift / for someone else. Keep recommendations gender-neutral unless they specify.');
  } else if (isForSelf && userGender) {
    lines.push(`RECIPIENT: Shopping for themselves (${userGender}). Filter and recommend accordingly.`);
  }

  return lines.length ? `\nSESSION:\n${lines.join('\n')}` : '';
}

export class ChatOrchestrator {
  async handleTurn(userId: string, messageInput: MessageInput): Promise<AgentResult> {
    const traceBuffer: TraceBuffer = {
      nodeRuns: [
        {
          id: createId(),
          nodeName: 'chat',
          startTime: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      llmTraces: [],
    };

    // Step 1: Parallel fetch — history, user context, search session
    const [history, userContext, searchSession] = await Promise.all([
      getHistory(userId),
      getUserContext(userId),
      getSearchSession(userId),
    ]);

    // Step 2: Rolling context for intent classifier
    const rollingContext = buildRollingContext(history);

    // Step 3: Classify intent via Haiku (async)
    const hasImages = parseInt(messageInput.NumMedia || '0', 10) > 0;
    const { intent, entities, isFollowUp, searchMeta } = await classifyIntent(
      messageInput.Body || messageInput.ButtonText || '',
      hasImages,
      rollingContext,
    );

    const { isDislikeMore, isNeutralMore, isForSelf, recipientGender } = searchMeta;

    // Step 4: If dislike, immediately normalize the search session
    if (isDislikeMore) {
      await normalizeAndRefreshSearch(userId);
      // Reflect in local copy so getTools picks it up this turn
      searchSession.paletteNormalized = true;
      searchSession.lastProductIds = [];
    }

    // Step 5: Build search context — override gender if shopping for others
    const genderForSearch = isForSelf
      ? (userContext.gender ?? undefined)
      : (recipientGender ?? undefined);

    // Patch the session's postServiceColorSeason with runtime dislike flag
    const activeSession: SearchSession = { ...searchSession };

    // Step 6: Build user images + system prompt + tools
    const userImages = await this.buildUserImages(messageInput);
    const sessionContext = buildSearchSessionContext(
      activeSession,
      isDislikeMore,
      isNeutralMore,
      isForSelf,
      recipientGender,
      userContext.gender ?? null,
    );
    const systemPrompt = buildSystemPrompt(userContext, intent, entities, isFollowUp) + sessionContext;

    const allAvailableTools = getTools(userId, userImages, messageInput, activeSession, genderForSearch);
    const toolNames = getToolsForIntent(intent, isFollowUp);
    // Always include search_catalog for chitchat if there's any session context (post-service follow-up)
    const effectiveToolNames =
      intent === 'chitchat' && (activeSession.postServiceColorSeason || isNeutralMore || isDislikeMore)
        ? [...toolNames, 'search_catalog']
        : toolNames;
    const tools = allAvailableTools.filter((t) => effectiveToolNames.includes(t.name));

    // Step 7: Convert history to messages (last 12) — never replay empty text (Anthropic 400)
    const conversationHistory = history.slice(-12).map((m) => {
      const raw = extractTextFromStoredContent(m.content);
      const content = textForHistoryReplay(m.role === 'user' ? 'user' : 'assistant', raw);
      return m.role === 'user' ? new UserMessage(content) : new AssistantMessage(content);
    });

    // Step 8: Build current user message
    const imageParts = buildImageMessageContent(userImages);
    const textBody = messageInput.Body || messageInput.ButtonText || EMPTY_USER_HISTORY_PLACEHOLDER;
    const currentContent: MessageContent = [...imageParts, { type: 'text', text: textBody }];
    const currentMessage = new UserMessage(currentContent);

    // Step 9: Run Claude Sonnet via agentExecutor
    const model = new ChatAnthropic({
      model: ANTHROPIC_CHAT_MODEL,
      maxTokens: AGENT_MAX_COMPLETION_TOKENS,
    });

    logger.info(
      { userId, intent, isFollowUp, isDislikeMore, isNeutralMore, isForSelf, toolCount: tools.length },
      'Orchestrator: running agentExecutor',
    );

    const result = await agentExecutor(
      model,
      new SystemMessage(systemPrompt),
      [...conversationHistory, currentMessage],
      { tools, outputSchema: responseSchema, nodeName: 'chat' },
      traceBuffer,
    );

    // Step 10: Persist turn to Redis history (never store empty user/assistant strings)
    const persistedUserText =
      (messageInput.Body || messageInput.ButtonText || '').trim() || EMPTY_USER_HISTORY_PLACEHOLDER;
    const replyRaw = result.output.reply;
    const persistedAssistant =
      typeof replyRaw === 'string' && replyRaw.trim().length > 0
        ? replyRaw
        : EMPTY_ASSISTANT_HISTORY_PLACEHOLDER;
    await appendToHistory(userId, persistedUserText, persistedAssistant);

    // Step 11: Map result → AgentResult
    const normalizedToolResults = result.toolResults.map((tr) => ({
      toolName: tr.name,
      ...(tr.result && typeof tr.result === 'object' && !Array.isArray(tr.result)
        ? tr.result
        : { raw: tr.result }),
    }));

    const agentResult: AgentResult = {
      text: result.output.reply,
      toolResults: normalizedToolResults,
      products: this.extractProducts(normalizedToolResults),
      colorAnalysis:
        normalizedToolResults.find((t) => t.toolName === 'analyze_color_season') || null,
      vibeCheck: normalizedToolResults.find((t) => t.toolName === 'vibe_check') || null,
    };

    // Step 12: Update search session (non-blocking)
    this.updateSearchSession(userId, agentResult).catch((err) =>
      logger.error({ err, userId }, 'Failed to update search session'),
    );

    // Step 13: Persist to Prisma (non-blocking)
    this.saveMessagesToPrisma(userId, messageInput, agentResult.text, agentResult.toolResults).catch(
      (err) => logger.error({ err, userId }, 'Failed to save messages to Prisma in orchestrator'),
    );

    return agentResult;
  }

  private async updateSearchSession(userId: string, result: AgentResult): Promise<void> {
    // Record new products shown so they're excluded from "show more" calls
    const shownIds = result.products.map((p: any) => String(p.id)).filter(Boolean);
    if (shownIds.length > 0) {
      await recordShownProducts(userId, shownIds);
    }

    // After color analysis succeeds, set the post-service color season for the next product search
    if (result.colorAnalysis && !result.colorAnalysis.error) {
      const season =
        result.colorAnalysis.palette_name ?? result.colorAnalysis.season;
      if (typeof season === 'string' && season) {
        await setPostServiceColorSeason(userId, season);
      }
    }
  }

  private async saveMessagesToPrisma(
    userId: string,
    input: MessageInput,
    replyText: string,
    toolResults: any[],
  ) {
    try {
      let conversation = await prisma.conversation.findFirst({
        where: { userId, status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
      });

      const userExists = await prisma.user.findUnique({ where: { id: userId } });
      if (!conversation && userExists) {
        conversation = await prisma.conversation.create({
          data: { userId, status: 'OPEN' },
        });
      }

      if (conversation) {
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: 'USER',
            content: [input.Body || input.ButtonText || ''] as any,
            buttonPayload: input.ButtonPayload ?? null,
          },
        });
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: 'AI',
            content: [replyText] as any,
            intent: toolResults.map((t) => t.toolName).join(','),
          },
        });
      }
    } catch (err) {
      logger.error({ err, userId }, 'Failed to save messages to Prisma');
    }
  }

  private extractProducts(toolResults: any[]): any[] {
    const products: any[] = [];
    for (const res of toolResults) {
      if (res.toolName === 'search_catalog' && res.products) {
        products.push(...res.products);
      } else if (res.toolName === 'get_outfit_suggestion' && res.allProducts) {
        products.push(...res.allProducts);
      } else if (res.toolName === 'beauty_advisor' && res.recommendations) {
        products.push(...res.recommendations);
      }
    }
    return Array.from(new Map(products.map((p) => [p.id, p])).values());
  }

  private async buildUserImages(input: MessageInput): Promise<any[]> {
    const images: any[] = [];
    const numMedia = parseInt(input.NumMedia || '0', 10);
    for (let i = 0; i < numMedia; i++) {
      const url = input[`MediaUrl${i}`];
      if (url) {
        try {
          const { data, mimeType } = await this.fetchImageAsBase64(url);
          images.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data } });
        } catch (err) {
          logger.warn({ url, err }, 'Failed to fetch image for orchestrator');
        }
      }
    }
    return images;
  }

  private async fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    let mimeType = response.headers.get('content-type') || 'image/jpeg';
    if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
    return { data: buffer.toString('base64'), mimeType };
  }
}
