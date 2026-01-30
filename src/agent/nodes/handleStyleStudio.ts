import { z } from 'zod';
import { getTextLLM, getVisionLLM } from '../../lib/ai';
import { ChatOpenAI } from '../../lib/ai/openai/chat_models';
import { agentExecutor } from '../../lib/ai/agents/executor';
import { SystemMessage, BaseMessage } from '../../lib/ai/core/messages';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { InternalServerError } from '../../utils/errors';
import { isValidImageUrl } from '../../utils/urlValidation';
import { GraphState, Replies } from '../state';
import { PendingType } from '@prisma/client';
import { searchProducts, fetchColorAnalysis } from '../tools';

const StyleStudioOutputSchema = z.object({
  reply_text: z.string().min(1, 'Reply text is required'),
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
    // Use gpt-4o for better tool calling reliability and instruction following
    // Create a text-only OpenAI instance (without vision/reasoning features) for better tool compatibility
    const textLLMWithTools = new ChatOpenAI({
      model: 'gpt-4o', // Better tool calling and instruction following than gpt-4o-mini
      temperature: 0.7, // Slightly creative but still reliable
    });

    let executorResult;
    try {
      executorResult = await agentExecutor(
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

    const result = executorResult.output;
    const toolResults = executorResult.toolResults;

    // Ensure reply_text exists
    if (!result.reply_text) {
      logger.warn({ userId, subIntent, result }, 'Missing reply_text in Style Studio result');
      result.reply_text = "I've prepared some styling recommendations for you.";
    }

    const replies: Replies = [
      { reply_type: 'text', reply_text: result.reply_text },
    ];

    // Extract products directly from searchProducts tool results
    const productResults = toolResults.filter(tr => tr.name === 'searchProducts');
    
    logger.debug(
      { userId, subIntent, productResultsCount: productResults.length, productResults },
      'Extracting products from tool results',
    );

    const allProducts: Array<{
      name: string;
      brand: string;
      imageUrl: string;
      productLink: string;
    }> = [];

    for (const toolResult of productResults) {
      logger.debug(
        { 
          userId, 
          toolName: toolResult.name, 
          resultType: typeof toolResult.result, 
          isArray: Array.isArray(toolResult.result),
          resultLength: Array.isArray(toolResult.result) ? toolResult.result.length : 'N/A',
          resultPreview: Array.isArray(toolResult.result) && toolResult.result.length > 0 
            ? toolResult.result[0] 
            : toolResult.result,
        },
        'Processing tool result',
      );

      // Tool results are returned as arrays of product objects
      if (Array.isArray(toolResult.result)) {
        // Skip empty arrays
        if (toolResult.result.length === 0) {
          logger.debug({ userId }, 'Tool returned empty array, skipping');
          continue;
        }

        const products = toolResult.result.filter((p: any) => {
          // Filter out invalid products
          if (!p || typeof p !== 'object') return false;
          if (!p.name || !p.brand || !p.productLink) return false;
          
          const productLinkLower = (p.productLink || '').toLowerCase().trim();
          const imageUrlLower = (p.imageUrl || '').toLowerCase().trim();

          // Skip placeholder URLs
          const placeholderPatterns = [
            'example.com',
            'placeholder',
            'url_here',
            'link_here',
            'unknown',
          ];

          if (
            placeholderPatterns.some(pattern => 
              productLinkLower.includes(pattern) || imageUrlLower.includes(pattern)
            )
          ) {
            return false;
          }

          // Must have valid http(s) URL for product link
          if (!productLinkLower.startsWith('http://') && !productLinkLower.startsWith('https://')) {
            return false;
          }

          return true;
        });

        // Filter products: must have valid imageUrl
        const validProducts = products.filter((p: any) => 
          p && 
          p.name && 
          p.brand && 
          p.productLink && 
          isValidImageUrl(p.imageUrl)
        );
        
        allProducts.push(...validProducts.map((p: any) => ({
          name: p.name,
          brand: p.brand,
          imageUrl: p.imageUrl,
          productLink: p.productLink,
        })));
        
        logger.debug(
          { userId, productsFound: products.length, totalProducts: allProducts.length },
          'Products extracted from array result',
        );
      } else if (typeof toolResult.result === 'string') {
        // If tool returned error message string, skip it
        try {
          const parsed = JSON.parse(toolResult.result);
          if (Array.isArray(parsed)) {
            allProducts.push(...parsed.filter((p: any) => p.name && p.brand && p.productLink));
          }
        } catch {
          // Not JSON, skip
        }
      }
    }

    logger.debug(
      { userId, totalProductsExtracted: allProducts.length },
      'Finished extracting products from tool results',
    );

    // Add product card if we have valid products (limit to 10)
    if (allProducts.length > 0) {
      const uniqueProducts = Array.from(
        new Map(allProducts.map(p => [p.productLink, p])).values()
      ).slice(0, 10);

      // Filter out any products with invalid imageUrls one more time (safety check)
      const productsWithValidUrls = uniqueProducts.filter((p) => isValidImageUrl(p.imageUrl));

      if (productsWithValidUrls.length > 0) {
        replies.push({
          reply_type: 'product_card' as const,
          products: productsWithValidUrls.map((p) => ({
            name: p.name,
            brand: p.brand,
            imageUrl: p.imageUrl,
            productLink: p.productLink,
            reason: 'Recommended for your style needs',
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