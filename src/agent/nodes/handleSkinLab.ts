import { z } from 'zod';
import { agentExecutor } from '../../lib/ai/agents/executor';
import { SystemMessage } from '../../lib/ai/core/messages';
import { ChatOpenAI } from '../../lib/ai/openai/chat_models';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { isValidImageUrl } from '../../utils/urlValidation';
import { GraphState, Replies } from '../state';
import { fetchRelevantMemories, searchProducts } from '../tools';

/**
 * LLM output schema for Skin Lab service.
 * Ensures proper structure for one or two message responses.
 */
const LLMOutputSchema = z.object({
  message1_text: z.string().describe('Primary text message response for Skin Lab.'),
  message2_text: z.string().nullable().describe('Optional follow-up text for Skin Lab.'),
});

/**
 * Helper: Formats text with line breaks and spacing for readability.
 */
function formatLLMOutput(text: string): string {
  if (!text) return '';
  const lines = text.split('\n').map((line) => line.trim());
  return lines.join('\n\n').trim();
}

/**
 * Handles the Skin Lab service — AI-powered skincare recommendations, analysis, and routines.
 */
export async function handleSkinLab(state: GraphState): Promise<GraphState> {
  const { user, conversationHistoryTextOnly, traceBuffer, input } = state;
  const userId = user.id;
  const messageId = input.MessageSid;

  try {
    // Load the system prompt for Skin Lab
    const systemPromptText = await loadPrompt('handlers/skin_lab/skin_lab_prompt.txt');

    // Count user messages in conversation to determine if we should recommend products
    // Only recommend products after at least 2-3 exchanges (after initial discussion)
    const userMessageCount = conversationHistoryTextOnly.filter(
      (msg) => msg.role === 'user',
    ).length;

    // Count assistant messages to understand conversation depth
    const assistantMessageCount = conversationHistoryTextOnly.filter(
      (msg) => msg.role === 'assistant',
    ).length;

    // Only enable product search after 2+ user messages (meaning we've had at least 2 exchanges)
    // This ensures we discuss the issue first before recommending products
    const shouldRecommendProducts = userMessageCount >= 2;

    logger.debug(
      { userId, userMessageCount, assistantMessageCount, shouldRecommendProducts },
      'Skin Lab: Conversation depth analysis',
    );

    // Use relevant user memories and conditionally include product search
    const tools = [fetchRelevantMemories(userId)];
    if (shouldRecommendProducts) {
      tools.push(searchProducts());
    }

    // Use OpenAI for Skin Lab when tools are needed, as it handles tool calling more reliably than Groq
    // Use gpt-4o for better tool calling reliability and instruction following
    // Create a text-only OpenAI instance (without vision/reasoning features) for better tool compatibility
    const textLLMWithTools = new ChatOpenAI({
      model: 'gpt-4o', // Better tool calling and instruction following than gpt-4o-mini
      temperature: 0.7, // Slightly creative but still reliable
    });

    const systemPrompt = new SystemMessage(systemPromptText);

    let executorResult;
    try {
      executorResult = await agentExecutor(
        textLLMWithTools,
        systemPrompt,
        conversationHistoryTextOnly,
        {
          tools,
          outputSchema: LLMOutputSchema,
          nodeName: 'handleSkinLab',
        },
        traceBuffer,
      );
    } catch (schemaError: unknown) {
      // If schema validation fails, log the error and return a graceful error message
      logger.error(
        {
          userId,
          error: schemaError instanceof Error ? schemaError.message : String(schemaError),
          data:
            schemaError instanceof Error && schemaError.cause
              ? (schemaError.cause as Error).message
              : 'Unknown error',
        },
        'Schema validation failed in handleSkinLab',
      );

      // Return a helpful error message to the user
      const errorReplies: Replies = [
        {
          reply_type: 'text',
          reply_text:
            "I'm having trouble processing that request right now. Could you try rephrasing your question or try again in a moment?",
        },
      ];
      return { ...state, assistantReply: errorReplies };
    }

    const finalResponse = executorResult.output;
    const toolResults = executorResult.toolResults;

    // Format the LLM messages
    const formattedMessage1 = formatLLMOutput(finalResponse.message1_text);
    const formattedMessage2 = finalResponse.message2_text
      ? formatLLMOutput(finalResponse.message2_text)
      : null;

    // Build WhatsApp replies array
    const replies: Replies = [{ reply_type: 'text', reply_text: formattedMessage1 }];
    if (formattedMessage2) {
      replies.push({ reply_type: 'text', reply_text: formattedMessage2 });
    }

    // Extract products directly from searchProducts tool results
    // Only extract products if we're in the recommendation phase (after initial discussion)
    const productResults = shouldRecommendProducts
      ? toolResults.filter((tr) => tr.name === 'searchProducts')
      : [];

    logger.debug(
      {
        userId,
        messageId,
        shouldRecommendProducts,
        productResultsCount: productResults.length,
        productResults,
      },
      'Extracting products from tool results',
    );

    interface ProductSearchResult {
      name: string;
      brand: string;
      imageUrl: string;
      description?: string | undefined;
      colors?: string[] | undefined;
    }
    const allProducts: ProductSearchResult[] = [];

    for (const toolResult of productResults) {
      logger.debug(
        {
          userId,
          toolName: toolResult.name,
          resultType: typeof toolResult.result,
          isArray: Array.isArray(toolResult.result),
          resultLength: Array.isArray(toolResult.result) ? toolResult.result.length : 'N/A',
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

        const products = toolResult.result.filter((p: ProductSearchResult) => {
          // Filter out invalid products
          if (!p || typeof p !== 'object') return false;
          if (!p.name || !p.brand || !p.imageUrl) return false;

          const imageUrlLower = (p.imageUrl || '').toLowerCase().trim();

          // Skip placeholder URLs
          const placeholderPatterns = [
            'example.com',
            'placeholder',
            'url_here',
            'link_here',
            'unknown',
          ];

          if (placeholderPatterns.some((pattern) => imageUrlLower.includes(pattern))) {
            return false;
          }

          return true;
        });

        // Filter products: must have valid imageUrl
        const validProducts = products.filter(
          (p: ProductSearchResult) =>
            p && p.name && p.brand && isValidImageUrl(p.imageUrl),
        );

        allProducts.push(
          ...validProducts.map((p: ProductSearchResult) => ({
            name: p.name,
            brand: p.brand,
            imageUrl: p.imageUrl,
            description: p.description,
            colors: p.colors,
          })),
        );

        logger.debug(
          { userId, productsFound: products.length, totalProducts: allProducts.length },
          'Products extracted from array result',
        );
      } else if (typeof toolResult.result === 'string') {
        // If tool returned error message string, skip it
        try {
          const parsed = JSON.parse(toolResult.result);
          if (Array.isArray(parsed)) {
            allProducts.push(
              ...(parsed.filter(
                (p: ProductSearchResult) => p.name && p.brand && p.imageUrl,
              ) as any),
            );
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
      // Use name+brand as unique identifier for deduplication
      const uniqueProducts = Array.from(
        new Map(allProducts.map((p) => [`${p.name}|${p.brand}`, p])).values(),
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
            description: p.description,
            colors: p.colors,
            reason: 'Recommended for your skincare needs',
          })),
        });
      }
    }

    logger.info(
      { userId, messageId },
      'Skin Lab: Successfully generated AI skincare advice response',
    );

    return { ...state, assistantReply: replies };
  } catch (err: unknown) {
    logger.error(
      { userId, messageId, error: err instanceof Error ? err.message : String(err) },
      'Skin Lab: Failed to generate response',
    );
    throw new InternalServerError('Failed to handle Skin Lab request', { cause: err });
  }
}
