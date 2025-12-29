import { z } from 'zod';
import { BaseChatModel } from './core/base_chat_model';
import { SystemMessage, UserMessage, AssistantMessage } from './core/messages';
import { ProductSearchIntent, ProductSearchIntentSchema } from '../../types/productSearch';
import { logger } from '../../utils/logger';
import { TraceBuffer } from '../../agent/tracing';

/**
 * AI-powered product search intent generator
 * Converts natural language user queries into structured search intent
 */
export class ProductIntentGenerator {
  private model: BaseChatModel;
  private systemPrompt: string;

  constructor(model: BaseChatModel) {
    this.model = model;
    this.systemPrompt = this.createSystemPrompt();
  }

  private createSystemPrompt(): string {
    // Manually define the schema structure for the prompt
    const schemaDescription = `
    {
      "query_text": "string (required) - main search keywords",
      "filters": {
        "brand": "string[] (optional) - filter by brands",
        "colors": "string[] (optional) - filter by colors",
        "sizes": "string[] (optional) - filter by sizes",
        "max_price": "number (optional) - maximum price",
        "min_price": "number (optional) - minimum price",
        "category": "string (optional) - product category",
        "style": "string (optional) - style aesthetic",
        "fit": "string (optional) - fit/silhouette",
        "occasion": "string (optional) - occasion"
      },
      "sort": "enum (optional, default: 'relevance') - sort order: relevance, price_asc, price_desc, rating",
      "limit": "number (optional, default: 10, max: 20) - max results"
    }`;

    return `
You are an expert fashion stylist and product search intent analyzer. Your task is to convert user messages into structured search intent JSON for finding appropriate outfit recommendations.

OCCASION GUIDELINES:
- **Work/Corporate**: Formal attire, business casual, professional wear (suits, blazers, dress shirts, trousers, loafers, oxfords)
- **Casual**: Everyday wear, comfortable clothing (jeans, t-shirts, sneakers, casual shirts, chinos)
- **Party/Social**: Dressy, fashionable outfits (cocktail dresses, dress shoes, blazers, stylish tops, heels)
- **Vacation/Travel**: Comfortable, versatile clothing (resort wear, sandals, breathable fabrics, travel-friendly items)
- **Gym/Fitness**: Athletic wear, sportswear (running shoes, gym clothes, leggings, sneakers, athletic tops)
- **Beach/Resort**: Swimwear, light clothing (swimsuits, sandals, cover-ups, linen shirts, summer dresses)
- **Formal/Event**: Elegant attire (gowns, tuxedos, dress shoes, jewelry, formal wear)
- **Wedding**: Semi-formal to formal wear appropriate for the event type

STYLE MAPPINGS:
- **Athleisure**: Comfortable, sporty clothing for casual wear
- **Minimal**: Clean, simple designs, neutral colors
- **Streetwear**: Urban, trendy fashion
- **Classic**: Timeless, traditional styles
- **Boho**: Free-spirited, eclectic patterns and fabrics
- **Resort**: Light, breathable fabrics for vacation
- **Business**: Professional, corporate attire

FIT TYPES:
- **Regular**: Standard fit
- **Slim**: Fitted, tailored
- **Oversized**: Loose, relaxed fit
- **Relaxed**: Comfortable, not tight

IMPORTANT RULES:
1. You MUST respond with ONLY valid JSON that matches this schema: ${schemaDescription}
2. Do NOT include any additional text, explanations, or markdown formatting
3. Do NOT generate Elasticsearch DSL queries or any other query language
4. Extract as much information as possible from the user's message
5. If information is missing, omit those fields (don't make up values)
6. Use reasonable defaults for limit (10) and sort (relevance) when not specified
7. For occasion-based queries, map to appropriate clothing categories and styles

EXAMPLES:
User: "Show me black Nike running shoes under $100"
Response: {
  "query_text": "black Nike running shoes",
  "filters": {
    "brand": ["Nike"],
    "colors": ["black"],
    "max_price": 100,
    "occasion": "gym"
  },
  "sort": "relevance",
  "limit": 10
}

User: "I need formal shoes for work, brown or black"
Response: {
  "query_text": "formal shoes for work",
  "filters": {
    "colors": ["brown", "black"],
    "occasion": "work",
    "category": "FOOTWEAR"
  },
  "sort": "relevance",
  "limit": 10
}

User: "Beach vacation clothes for women"
Response: {
  "query_text": "beach vacation clothes",
  "filters": {
    "occasion": "vacation",
    "style": "resort"
  },
  "sort": "relevance",
  "limit": 10
}

User: "Business casual outfit for office"
Response: {
  "query_text": "business casual office wear",
  "filters": {
    "occasion": "work",
    "style": "business"
  },
  "sort": "relevance",
  "limit": 10
}

User: "Show me some trendy clothes"
Response: {
  "query_text": "trendy clothes",
  "sort": "relevance",
  "limit": 10
}

Now analyze the user's message and respond with ONLY the JSON intent:
`.trim();
  }

  /**
   * Generate structured search intent from user message
   */
  async generateIntent(userMessage: string): Promise<ProductSearchIntent> {
    try {
      // Use a simpler synchronous approach without agent tracing
      return await this.generateIntentSync(userMessage);
    } catch (error) {
      logger.error({
        userMessage,
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to generate product search intent');

      // Fallback: return basic intent if parsing fails
      return {
        query_text: userMessage,
        sort: 'relevance',
        limit: 10,
      };
    }
  }

  /**
   * Synchronous intent generation without agent tracing
   */
  private async generateIntentSync(userMessage: string): Promise<ProductSearchIntent> {
    try {
      // Try to access the underlying client directly
      const groqModel = this.model as any;

      if (groqModel.client) {
        // Use the same model as other functionalities: llama-3.3-70b-versatile
        const response = await groqModel.client.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.1,
          max_tokens: 500
        });

        const textContent = response.choices[0]?.message?.content || '';
        const parsedIntent = JSON.parse(textContent) as unknown;
        const validatedIntent = ProductSearchIntentSchema.parse(parsedIntent);

        logger.debug({
          userMessage,
          generatedIntent: validatedIntent
        }, 'Generated product search intent');

        return validatedIntent;
      }
    } catch (error) {
      logger.warn({
        userMessage,
        error: error instanceof Error ? error.message : String(error)
      }, 'Direct Groq client call failed, using fallback');
    }

    // Final fallback - return basic intent
    return {
      query_text: userMessage,
      sort: 'relevance',
      limit: 10,
    };
  }

  /**
   * Extract keywords from user message for fallback search
   */
  private extractKeywords(message: string): string {
    // Simple keyword extraction - can be enhanced with NLP
    const keywords = message
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/) // Split into words
      .filter(word => word.length > 2 && !['a', 'an', 'the', 'and', 'or', 'but'].includes(word))
      .slice(0, 10) // Take top 10 keywords
      .join(' ');

    return keywords || message;
  }
}
