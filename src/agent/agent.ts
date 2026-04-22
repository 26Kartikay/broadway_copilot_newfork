import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { MessageInput } from '../lib/chat/types';
import { getHistory, appendToHistory, getUserContext, UserContext } from './memory/redis';
import { ANTHROPIC_TOOLS, executeTool } from './tools/index';
import { buildSystemPrompt } from './systemPrompt';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6";

export interface AgentResult {
  text: string;
  toolResults: any[];
  products: any[];
  colorAnalysis: any | null;
  vibeCheck: any | null;
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  let mimeType = response.headers.get('content-type') || 'image/jpeg';
  
  // Anthropic supports: image/jpeg, image/png, image/gif, image/webp
  if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType)) {
    mimeType = 'image/jpeg'; // Fallback
  }

  return {
    data: buffer.toString('base64'),
    mimeType
  };
}

async function buildUserMessage(input: MessageInput): Promise<any> {
  const content: any[] = [];

  // Handle text
  if (input.Body) {
    content.push({ type: 'text', text: input.Body });
  } else if (input.ButtonText) {
    content.push({ type: 'text', text: input.ButtonText });
  }

  // Handle images
  const numMedia = parseInt(input.NumMedia || '0');
  for (let i = 0; i < numMedia; i++) {
    const url = input[`MediaUrl${i}`];
    if (url) {
      const { data, mimeType } = await fetchImageAsBase64(url);
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType as any,
          data
        }
      });
    }
  }

  return { role: 'user', content };
}

export async function runAgent(
  userId: string,
  messageInput: MessageInput
): Promise<AgentResult> {
  // 1. Load history + context
  const [history, userCtx] = await Promise.all([
    getHistory(userId),
    getUserContext(userId)
  ]);

  // 2. Build user message
  const userMessage = await buildUserMessage(messageInput);

  // 3. Prepare Anthropic history
  const anthropicHistory = history.map(h => ({
    role: h.role as 'user' | 'assistant',
    content: h.content
  }));

  // 4. Initial Claude call
  let currentMessages = [...anthropicHistory, userMessage];
  
  let response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: buildSystemPrompt(userCtx),
        cache_control: { type: "ephemeral" } as any
      }
    ],
    messages: currentMessages,
    tools: ANTHROPIC_TOOLS
  }, { headers: { 'anthropic-beta': 'prompt-caching-2024-07-31' } });

  // 5. Agentic loop
  let toolResults: any[] = [];
  let currentResponse = response;

  while (currentResponse.stop_reason === "tool_use") {
    const toolUseBlocks = currentResponse.content.filter(b => b.type === "tool_use");
    
    const results = await Promise.all(
      toolUseBlocks.map(async (toolUse: any) => {
        // Inject images from the current user message if the tool needs them
        const toolInput = { ...toolUse.input };
        const userImages = userMessage.content.filter((c: any) => c.type === 'image');
        
        const result = await executeTool(toolUse.name, toolInput, userId, userImages);
        toolResults.push(result);
        return {
          type: "tool_result" as const,
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        };
      })
    );

    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: currentResponse.content },
      { role: "user", content: results }
    ];

    currentResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: buildSystemPrompt(userCtx),
          cache_control: { type: "ephemeral" } as any
        }
      ],
      messages: currentMessages,
      tools: ANTHROPIC_TOOLS
    }, { headers: { 'anthropic-beta': 'prompt-caching-2024-07-31' } });
  }

  const finalText = currentResponse.content
    .filter(b => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  // 6. Persist to Redis
  await appendToHistory(userId, userMessage.content, finalText);

  // 7. Persist to Prisma
  await saveMessagesToPrisma(userId, messageInput, finalText, toolResults);

  return {
    text: finalText,
    toolResults,
    products: extractProducts(toolResults),
    colorAnalysis: extractColorAnalysis(toolResults),
    vibeCheck: extractVibeCheck(toolResults)
  };
}

async function saveMessagesToPrisma(
  userId: string,
  input: MessageInput,
  replyText: string,
  toolResults: any[]
) {
  try {
    // Find or create conversation
    let conversation = await prisma.conversation.findFirst({
      where: { userId, status: 'OPEN' },
      orderBy: { createdAt: 'desc' }
    });

    const userExists = await prisma.user.findUnique({ where: { id: userId } });
    const logData = userExists ? { userId } : {};

    if (!conversation && userExists) {
      conversation = await prisma.conversation.create({
        data: { userId, status: 'OPEN' }
      });
    }

    if (conversation) {
      // Save User message
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'USER',
          content: [input.Body || input.ButtonText || ''] as any,
          buttonPayload: input.ButtonPayload,
        }
      });

      // Save AI message
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'AI',
          content: [replyText] as any,
          intent: toolResults.map(t => t.toolName).join(',')
        }
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
  // Deduplicate by ID
  return Array.from(new Map(products.map(p => [p.id, p])).values());
}

function extractColorAnalysis(toolResults: any[]): any | null {
  const res = toolResults.find(t => t.toolName === 'analyze_color_season');
  return res || null;
}

function extractVibeCheck(toolResults: any[]): any | null {
  const res = toolResults.find(t => t.toolName === 'vibe_check');
  return res || null;
}
