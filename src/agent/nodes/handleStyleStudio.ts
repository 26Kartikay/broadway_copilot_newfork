import { z } from 'zod';
import { getTextLLM, getVisionLLM } from '../../lib/ai';
import { ChatOpenAI } from '../../lib/ai/openai/chat_models';
import { agentExecutor } from '../../lib/ai/agents/executor';
import { SystemMessage, BaseMessage } from '../../lib/ai/core/messages';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { InternalServerError } from '../../utils/errors';
import { GraphState, Replies } from '../state';
import { PendingType } from '@prisma/client';
import { searchProducts, fetchColorAnalysis } from '../tools';

const StyleStudioOutputSchema = z.object({
  reply_text: z.string().min(1, 'Reply text is required'),
  product_recommendations: z
    .array(
      z.object({
        name: z.string().min(1, 'Product name is required'),
        brand: z.string().min(1, 'Brand is required'),
        imageUrl: z.string().describe('Product image URL'),
        productLink: z.string().min(1, 'Product link is required'),
        reason: z.string().optional().describe('Brief reason why this product is recommended'),
      }),
    )
    .max(10, 'Maximum 10 product recommendations allowed')
    .optional()
    .describe('Products from our catalog to recommend to the user'),
});

const styleStudioMenuButtons = [
  { text: 'Style for any occasion', id: 'style_studio_occasion' },
  { text: 'Vacation looks', id: 'style_studio_vacation' },
  { text: 'General styling', id: 'style_studio_general' },
];

export async function handleStyleStudio(state: GraphState): Promise<GraphState> {
  const { subIntent, conversationHistoryTextOnly, user, pending } = state;
  const userId = user.id;

  // --- START OF CONTEXT CHECK AND TRUNCATION (FIXED) ---
  let historyForLLM: BaseMessage[] = conversationHistoryTextOnly;
  
  if (subIntent && historyForLLM.length > 0) {
    // Get the last message.
    const latestUserMessage = historyForLLM.at(-1); 
    
    // Check 1 & 2: Ensure the message object exists AND its content is definitely a string
    if (latestUserMessage && typeof latestUserMessage.content === 'string') {
        
        // FIX: Use 'as unknown as string' to correctly handle the complex MessageContent type
        const isServiceSwitch = styleStudioMenuButtons.some(
          button => (latestUserMessage.content as unknown as string).trim() === button.id
        );

        if (isServiceSwitch) {
          // If a switch was detected, truncate the history to ONLY include the latest message.
          logger.debug({ userId, subIntent }, 'Sub-service switch detected via button payload. Truncating LLM history.');
          
          // We assert that latestUserMessage is a BaseMessage before array assignment
          historyForLLM = [latestUserMessage as BaseMessage]; 
        }
    }
  }
  // --- END OF CONTEXT CHECK AND TRUNCATION (FIXED) ---

  if (!subIntent) {
    // Send menu if not already pending
    if (pending !== PendingType.STYLE_STUDIO_MENU) {
      const replies: Replies = [
        {
          reply_type: 'quick_reply',
          reply_text: 'Welcome to Style Studio! Choose a styling service:',
          buttons: styleStudioMenuButtons,
        },
      ];
      return {
        ...state,
        assistantReply: replies,
        pending: PendingType.STYLE_STUDIO_MENU,
        lastHandledPayload: null,
      };
    } else {
      // Possibly user repeated same menu state; do nothing
      return { ...state, assistantReply: [] };
    }
  }

  try {
    const intentKey = subIntent.replace('style_studio_', ''); // e.g. 'occasion', 'vacation', 'general'
    const systemPromptText = await loadPrompt(`handlers/style_studio/${intentKey}.txt`);
    const systemPrompt = new SystemMessage(systemPromptText);

    // Use agentExecutor with product search tool
    // Build tool list and force-include required tools to avoid drops in request.tools.
    const tools = [searchProducts(), fetchColorAnalysis(userId)];

    // Use OpenAI for Style Studio when tools are needed, as it handles tool calling more reliably than Groq
    // Create a text-only OpenAI instance (without vision/reasoning features) for better tool compatibility
    const textLLMWithTools = new ChatOpenAI({
      model: 'gpt-4o-mini', // Fast and cost-effective for text + tools
    });

    let result;
    try {
      result = await agentExecutor(
        textLLMWithTools,
        systemPrompt,
        historyForLLM,
        {
          tools,
          outputSchema: StyleStudioOutputSchema,
          nodeName: 'handleStyleStudio',
        },
        state.traceBuffer,
      );
    } catch (schemaError: any) {
      // If schema validation fails, log the error and return a graceful error message
      logger.error(
        {
          userId,
          subIntent,
          error: schemaError.message,
          data: schemaError.cause?.message || 'Unknown error',
        },
        'Schema validation failed in handleStyleStudio',
      );

      // Return a helpful error message to the user
      const errorReplies: Replies = [
        {
          reply_type: 'text',
          reply_text:
            "I'm having trouble processing that request right now. Could you try rephrasing your question or try again in a moment?",
        },
      ];
      return { ...state, assistantReply: errorReplies, pending: PendingType.NONE };
    }

    // Ensure reply_text exists
    if (!result.reply_text) {
      logger.warn({ userId, subIntent, result }, 'Missing reply_text in Style Studio result');
      result.reply_text = "I've prepared some styling recommendations for you.";
    }

    const replies: Replies = [
      { reply_type: 'text', reply_text: result.reply_text },
    ];

    // Add product card if recommendations were made
    if (result.product_recommendations && result.product_recommendations.length > 0) {
      // Filter out invalid products (placeholders, example.com, etc.)
      const validProducts = result.product_recommendations.filter((p) => {
        if (!p.name || !p.brand || !p.productLink) {
          return false;
        }

        const placeholderPatterns = [
          'image_url',
          'product_link',
          'product_url',
          'imageurl',
          'productlink',
          'example.com',
          'placeholder',
          'url_here',
          'link_here',
          'unknown',
        ];

        const productLinkLower = (p.productLink || '').toLowerCase().trim();
        const imageUrlLower = (p.imageUrl || '').toLowerCase().trim();

        if (
          placeholderPatterns.some(
            (pattern) =>
              productLinkLower === pattern ||
              productLinkLower.includes(pattern) ||
              imageUrlLower === pattern ||
              imageUrlLower.includes(pattern),
          )
        ) {
          return false;
        }

        if (!productLinkLower.startsWith('http://') && !productLinkLower.startsWith('https://')) {
          return false;
        }

        if (p.imageUrl && imageUrlLower && !imageUrlLower.startsWith('http://') && !imageUrlLower.startsWith('https://')) {
          return false;
        }
        return true;
      });

      if (validProducts.length > 0) {
        replies.push({
          reply_type: 'product_card' as const,
          products: validProducts.map((p) => ({
            name: p.name,
            brand: p.brand,
            imageUrl: p.imageUrl || '',
            productLink: p.productLink,
            reason: p.reason || 'Recommended for your style needs',
          })),
        } as any);
      }
    }

    logger.debug({ userId, subIntent, replies }, 'Generated Style Studio reply');
    return { ...state, assistantReply: replies, pending: PendingType.NONE };
  } catch (err) {
    logger.error({ userId, err }, 'Error in handleStyleStudio');
    throw new InternalServerError('Failed to handle Style Studio request', { cause: err });
  }
}