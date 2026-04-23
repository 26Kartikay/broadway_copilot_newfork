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
import { appendToHistory, getHistory, getUserContext, StoredMessage } from './memory/redis';
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

/** Convert base64 image blocks from orchestrator format to internal MessageContent. */
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

    // Step 1: Parallel fetch — history + user context
    const [history, userContext] = await Promise.all([getHistory(userId), getUserContext(userId)]);

    // Step 2: Rolling context for intent classifier
    const rollingContext = buildRollingContext(history);

    // Step 3: Classify intent via Haiku (async LLM call)
    const hasImages = parseInt(messageInput.NumMedia || '0', 10) > 0;
    const { intent, entities, isFollowUp } = await classifyIntent(
      messageInput.Body || messageInput.ButtonText || '',
      hasImages,
      rollingContext,
    );

    // Step 4: Build user images + system prompt + filtered tool set
    const userImages = await this.buildUserImages(messageInput);
    const systemPrompt = buildSystemPrompt(userContext, intent, entities, isFollowUp);
    const allAvailableTools = getTools(userId, userImages, messageInput);
    const toolNames = getToolsForIntent(intent, isFollowUp);
    const tools = allAvailableTools.filter((t) => toolNames.includes(t.name));

    // Step 5: Convert stored history to BaseMessage[]
    const conversationHistory = history.slice(-12).map((m) => {
      const content = extractTextFromStoredContent(m.content);
      return m.role === 'user' ? new UserMessage(content) : new AssistantMessage(content);
    });

    // Step 6: Build current user message (text + optional images)
    const imageParts = buildImageMessageContent(userImages);
    const textBody = messageInput.Body || messageInput.ButtonText || '(empty)';
    const currentContent: MessageContent = [
      ...imageParts,
      { type: 'text', text: textBody },
    ];
    const currentMessage = new UserMessage(currentContent);

    // Step 7: Run agentExecutor with Claude Sonnet
    const model = new ChatAnthropic({
      model: ANTHROPIC_CHAT_MODEL,
      maxTokens: AGENT_MAX_COMPLETION_TOKENS,
    });

    logger.info({ userId, intent, isFollowUp, toolCount: tools.length }, 'Orchestrator: running agentExecutor');

    const result = await agentExecutor(
      model,
      new SystemMessage(systemPrompt),
      [...conversationHistory, currentMessage],
      { tools, outputSchema: responseSchema, nodeName: 'chat' },
      traceBuffer,
    );

    // Step 8: Persist turn to Redis history
    await appendToHistory(
      userId,
      messageInput.Body || messageInput.ButtonText || '',
      result.output.reply,
    );

    // Step 9: Map result → AgentResult
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

    // Step 10: Persist to Prisma (non-blocking)
    this.saveMessagesToPrisma(userId, messageInput, agentResult.text, agentResult.toolResults).catch(
      (err) => logger.error({ err, userId }, 'Failed to save messages to Prisma in orchestrator'),
    );

    return agentResult;
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
          images.push({
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data },
          });
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
