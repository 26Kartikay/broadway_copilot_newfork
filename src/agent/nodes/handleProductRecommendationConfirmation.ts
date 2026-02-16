import { PendingType } from '@prisma/client';
import { z } from 'zod';
import { getPaletteData, isValidPalette } from '../../data/seasonalPalettes';
import { agentExecutor } from '../../lib/ai/agents/executor';
import { SystemMessage } from '../../lib/ai/core/messages';
import { ChatOpenAI } from '../../lib/ai/openai/chat_models';
import { logger } from '../../utils/logger';
import { isValidImageUrl } from '../../utils/urlValidation';
import { GraphState, ProductRecommendation, Replies } from '../state';
import { searchProducts } from '../tools';
import { getMainMenuReply } from './common';

const LLMOutputSchema = z.object({
  conclusion_text: z
    .string()
    .describe(
      "A brief, friendly concluding text message to show before the product recommendations. For example: 'Based on your colors, I found a few items you might like!'",
    ),
});

interface ProductSearchResult {
  name: string;
  brand: string;
  imageUrl: string;
  description?: string;
  colors?: string[];
}

export async function handleProductRecommendationConfirmation(
  state: GraphState,
): Promise<GraphState> {
  const { productRecommendationContext, input, user } = state;
  const userResponse = input.ButtonPayload;

  if (userResponse !== 'product_recommendation_yes') {
    logger.debug({ userId: user.id }, 'User declined product recommendations, showing menu.');
    return {
      ...state,
      assistantReply: getMainMenuReply(),
      pending: PendingType.NONE,
      productRecommendationContext: undefined,
      seasonalPaletteToSave: undefined,
    };
  }

  // User said YES
  logger.debug({ userId: user.id }, 'User wants product recommendations, calling agent.');
  const tools = [searchProducts()];
  let systemPrompt: SystemMessage;

  // Use confirmedGender first, then fall back to inferredGender
  const gender = user.confirmedGender || user.inferredGender;
  const ageGroup = user.confirmedAgeGroup || user.inferredAgeGroup;
  let userContext = 'an adult';
  if (gender && ageGroup) {
    userContext = `a ${ageGroup.toLowerCase()} ${gender.toLowerCase()}`;
  } else if (gender) {
    userContext = `an adult ${gender.toLowerCase()}`;
  } else if (ageGroup) {
    userContext = `a ${ageGroup.toLowerCase()}`;
  }

  // Convert Prisma enum to lowercase string for filter (MALE -> male, FEMALE -> female)
  const genderFilter = gender ? gender.toLowerCase() : undefined;
  const ageGroupFilter = ageGroup ? ageGroup.toLowerCase() : undefined;

  if (
    productRecommendationContext?.type === 'color_palette' &&
    isValidPalette(productRecommendationContext.paletteName)
  ) {
    const paletteData = getPaletteData(productRecommendationContext.paletteName);
    const colors = paletteData.topColors.map((c) => c.name).slice(0, 3);
    const colorList = colors.join(', ');

    const promptText = `Your final response MUST be a JSON object with a 'conclusion_text' field.
      You are a fashion product recommender. The user is ${userContext} and their color palette is ${productRecommendationContext.paletteName}.
      Your first task is to recommend products that match this palette by calling the 'searchProducts' tool.
      You **MUST** use the 'filters' argument to search for products. ${genderFilter ? `You **MUST** set the 'gender' filter to '${genderFilter}'. ` : ''}${ageGroupFilter ? `You **MUST** set the 'ageGroup' filter to '${ageGroupFilter}'. ` : ''}Set the 'color' filter to one of these colors: ${colorList}.
      After the tool returns its results, your second task is to provide a brief, friendly concluding message inside the 'conclusion_text' field of your JSON response.`;
    systemPrompt = new SystemMessage(promptText);
  } else if (productRecommendationContext?.type === 'vibe_check') {
    const query = productRecommendationContext.recommendations.join(' ');
    const promptText = `Your final response MUST be a JSON object with a 'conclusion_text' field.
      You are a fashion product recommender. The user, who is ${userContext}, received the following style advice: "${query}".
      Your first task is to recommend products based on this advice by calling the 'searchProducts' tool.
      Use a concise query based on the style advice. ${genderFilter ? `You **MUST** set the 'gender' filter to '${genderFilter}' in the filters argument. ` : ''}${ageGroupFilter ? `You **MUST** set the 'ageGroup' filter to '${ageGroupFilter}' in the filters argument. ` : ''}
      After the tool returns its results, your second task is to provide a brief, friendly concluding message inside the 'conclusion_text' field of your JSON response.`;
    systemPrompt = new SystemMessage(promptText);
  } else {
    logger.warn('handleProductRecommendationConfirmation called without valid context.');
    return { ...state, assistantReply: getMainMenuReply(), pending: PendingType.NONE };
  }

  try {
    const llm = new ChatOpenAI({ model: 'gpt-4o' });
    const executorResult = await agentExecutor(
      llm,
      systemPrompt,
      [], // Start with a clean history for this agent
      {
        tools,
        outputSchema: LLMOutputSchema,
        nodeName: 'handleProductRecommendationConfirmation',
      },
      state.traceBuffer,
    );

    const finalResponse = executorResult.output;
    const toolResults = executorResult.toolResults;
    const replies: Replies = [];

    // Add the text conclusion from the LLM
    if (finalResponse.conclusion_text) {
      replies.push({ reply_type: 'text', reply_text: finalResponse.conclusion_text });
    }

    // Extract products from the tool results
    const productResults = toolResults.filter((tr) => tr.name === 'searchProducts');
    const allProducts: ProductRecommendation[] = [];

    for (const toolResult of productResults) {
      if (Array.isArray(toolResult.result)) {
        // Filter products: must have name, brand, and valid imageUrl
        const products = toolResult.result.filter((p: ProductSearchResult) => {
          return p && p.name && p.brand && isValidImageUrl(p.imageUrl);
        });

        allProducts.push(
          ...products.map((p: ProductSearchResult) => ({
            name: p.name,
            brand: p.brand,
            imageUrl: p.imageUrl, // Only include if valid (already filtered)
            description: p.description,
            colors: p.colors,
          })),
        );
      }
    }

    // Add product card if we have products with valid imageUrls
    if (allProducts.length > 0) {
      // Use name+brand as unique identifier for deduplication
      const uniqueProducts = Array.from(
        new Map(allProducts.map((p) => [`${p.name}|${p.brand}`, p])).values(),
      ).slice(0, 5);
      
      replies.push({
        reply_type: 'product_card',
        products: uniqueProducts,
      });
    } else {
      // Only show this message if the text conclusion wasn't already generated
      if (replies.length === 0) {
        replies.push({
          reply_type: 'text',
          reply_text:
            "I couldn't find any specific recommendations at the moment, but I'll keep an eye out!",
        });
      }
    }

    const menuReply = getMainMenuReply();

    return {
      ...state,
      assistantReply: [...replies, ...menuReply],
      pending: PendingType.NONE,
      productRecommendationContext: undefined,
      seasonalPaletteToSave: undefined,
    };
  } catch (error) {
    logger.error({ error }, 'Error in handleProductRecommendationConfirmation');
    return {
      ...state,
      assistantReply: [
        {
          reply_type: 'text',
          reply_text:
            "I had a little trouble finding products right now, but let's try again later!",
        },
        ...getMainMenuReply(),
      ],
      pending: PendingType.NONE,
    };
  }
}
