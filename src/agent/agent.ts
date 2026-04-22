import Groq from 'groq-sdk';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from 'groq-sdk/resources/chat/completions';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { MessageInput } from '../lib/chat/types';
import {
  getHistory,
  appendToHistory,
  getUserContext,
  stripHeavyMediaFromContent,
  type StoredMessage,
} from './memory/redis';
import { ANTHROPIC_TOOLS, executeTool } from './tools/index';
import {
  AGENT_MAX_COMPLETION_TOKENS,
  GROQ_AGENT_MODEL,
} from './anthropicModels';
import { buildSystemPrompt } from './systemPrompt';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/** Max completed tool rounds before forcing a text-only model turn (bounds latency vs unbounded tool_use loops). Override with AGENT_MAX_TOOL_ROUNDS. */
const MAX_AGENT_TOOL_ROUNDS = Math.max(
  1,
  Math.min(20, Number(process.env.AGENT_MAX_TOOL_ROUNDS) || 5),
);

export interface AgentResult {
  text: string;
  toolResults: any[];
  products: any[];
  colorAnalysis: any | null;
  vibeCheck: any | null;
}

function toolsForGroq(tools: any[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema ?? { type: 'object', properties: {} },
    },
  }));
}

function contentToPlainString(c: unknown): string {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c
    .map((b: { type?: string; text?: string }) => {
      if (b?.type === 'text') return String(b.text ?? '');
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function historyToGroqMessages(history: StoredMessage[]): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [];
  for (const h of history) {
    const raw = stripHeavyMediaFromContent(h.content);
    const text = contentToPlainString(raw).trim() || (h.role === 'user' ? '…' : '');
    if (h.role === 'user') {
      out.push({ role: 'user', content: text });
    } else {
      out.push({ role: 'assistant', content: text });
    }
  }
  return out;
}

function buildLlmUserTextForGroq(input: MessageInput): string {
  const parts: string[] = [];
  if (input.Body) parts.push(input.Body);
  else if (input.ButtonText) parts.push(input.ButtonText);
  const n = parseInt(input.NumMedia || '0', 10);
  if (n > 0) {
    parts.push(
      `[User sent ${n} image(s). Image bytes are injected automatically when you call analyze_color_season, vibe_check, or this_or_that—do not ask them to paste base64.]`,
    );
  }
  return parts.join('\n').trim() || '(empty message)';
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  let mimeType = response.headers.get('content-type') || 'image/jpeg';

  if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType)) {
    mimeType = 'image/jpeg';
  }

  return {
    data: buffer.toString('base64'),
    mimeType,
  };
}

/** Rich message for tool execution (base64 images preserved). */
async function buildUserMessageForTools(input: MessageInput): Promise<{
  role: 'user';
  content: any[];
}> {
  const content: any[] = [];

  if (input.Body) {
    content.push({ type: 'text', text: input.Body });
  } else if (input.ButtonText) {
    content.push({ type: 'text', text: input.ButtonText });
  }

  const numMedia = parseInt(input.NumMedia || '0', 10);
  for (let i = 0; i < numMedia; i++) {
    const url = input[`MediaUrl${i}`];
    if (url) {
      const { data, mimeType } = await fetchImageAsBase64(url);
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType as any,
          data,
        },
      });
    }
  }

  return { role: 'user', content };
}

export async function runAgent(
  userId: string,
  messageInput: MessageInput,
): Promise<AgentResult> {
  if (!process.env.GROQ_API_KEY?.trim()) {
    throw new Error('GROQ_API_KEY is required for the chat agent (Groq / Llama tool calling).');
  }

  const [history, userCtx] = await Promise.all([getHistory(userId), getUserContext(userId)]);

  const userMessageForTools = await buildUserMessageForTools(messageInput);
  const groqTools = toolsForGroq(ANTHROPIC_TOOLS);

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(userCtx) },
    ...historyToGroqMessages(history),
    { role: 'user', content: buildLlmUserTextForGroq(messageInput) },
  ];

  const runGroqCompletion = async (toolChoice: 'auto' | 'none') => {
    const t0 = Date.now();
    const completion = await groq.chat.completions.create({
      model: GROQ_AGENT_MODEL,
      max_tokens: AGENT_MAX_COMPLETION_TOKENS,
      temperature: 0.55,
      messages,
      tools: groqTools,
      tool_choice: toolChoice,
    });
    const choice = completion.choices[0];
    logger.info(
      {
        userId,
        ms: Date.now() - t0,
        model: GROQ_AGENT_MODEL,
        finishReason: choice?.finish_reason,
        toolCalls: choice?.message?.tool_calls?.length ?? 0,
        toolChoice,
      },
      'agent groq.chat.completions',
    );
    return choice;
  };

  let choice = await runGroqCompletion('auto');
  let toolResults: any[] = [];
  let completedToolRounds = 0;

  while (choice?.message?.tool_calls?.length) {
    const toolCalls = choice.message.tool_calls;
    const assistantPayload: ChatCompletionAssistantMessageParam = {
      role: 'assistant',
      content: choice.message.content ?? null,
      tool_calls: toolCalls,
    };
    messages.push(assistantPayload);

    for (const tc of toolCalls) {
      const name = tc.function.name;
      let toolInput: Record<string, unknown> = {};
      try {
        toolInput = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        toolInput = {};
      }
      const userImages = userMessageForTools.content.filter((c: any) => c.type === 'image');
      const tTool = Date.now();
      const result = await executeTool(name, toolInput, userId, userImages, messageInput);
      logger.info({ userId, tool: name, ms: Date.now() - tTool }, 'agent executeTool');
      toolResults.push(result);
      const toolMsg: ChatCompletionToolMessageParam = {
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      };
      messages.push(toolMsg);
    }

    completedToolRounds += 1;
    const forceTextOnly = completedToolRounds >= MAX_AGENT_TOOL_ROUNDS;
    if (forceTextOnly) {
      logger.warn(
        { userId, completedToolRounds, max: MAX_AGENT_TOOL_ROUNDS },
        'agent tool loop cap reached; forcing text-only follow-up',
      );
    }

    choice = await runGroqCompletion(forceTextOnly ? 'none' : 'auto');
    if (forceTextOnly) break;
  }

  const finalText = (choice?.message?.content ?? '').trim();

  await appendToHistory(userId, userMessageForTools.content, finalText);
  await saveMessagesToPrisma(userId, messageInput, finalText, toolResults);

  return {
    text: finalText,
    toolResults,
    products: extractProducts(toolResults),
    colorAnalysis: extractColorAnalysis(toolResults),
    vibeCheck: extractVibeCheck(toolResults),
  };
}

async function saveMessagesToPrisma(
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

function extractProducts(toolResults: any[]): any[] {
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

function extractColorAnalysis(toolResults: any[]): any | null {
  const res = toolResults.find((t) => t.toolName === 'analyze_color_season');
  return res || null;
}

function extractVibeCheck(toolResults: any[]): any | null {
  const res = toolResults.find((t) => t.toolName === 'vibe_check');
  return res || null;
}
