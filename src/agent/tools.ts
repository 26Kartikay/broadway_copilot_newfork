import { WardrobeItem, WardrobeItemCategory } from '@prisma/client';
import { z } from 'zod';

import { ChatGroq, ChatOpenAI, OpenAIEmbeddings, SystemMessage, Tool, UserMessage } from '../lib/ai';
import type { TraceBuffer } from '../agent/tracing';
import { createId } from '@paralleldrive/cuid2';

import { prisma } from '../lib/prisma';
import { BadRequestError, InternalServerError } from '../utils/errors';
import { logger } from '../utils/logger';
import { getPaletteData, isValidPalette, type SeasonalPalette } from '../data/seasonalPalettes';

// ============================================================================
// PRODUCT TYPES
// ============================================================================

type ProductRow = {
  id: string;
  barcode: string;
  name: string | null;
  brandName: string | null;
  gender: string;
  ageGroup: string | null;
  category: string | null;
  subCategory: string | null;
  productType: string | null;
  colorPalette: string | null;
  imageUrl: string;
  colors: string[];
  allTags: string | null;
  createdAt: Date;
};

interface ProductWithScore {
  item: ProductRow;
  score: number;
  sources: string[];
}

type ProductSemanticRow = ProductRow & { distance: number; similarity: number };

// Query understanding output
interface QueryAttributes {
  color?: string | null;
  brand?: string | null;
  style?: string | null;
  occasion?: string | null;
  palette?: string | null; // Seasonal color palette name (e.g., "True Autumn", "Dark Winter")
  category?: string | null; // Main category (e.g., "Clothing & Fashion", "Footwear")
  subCategory?: string | null; // Sub category (e.g., "Tops", "Bottoms", "Footwear")
}

type WardrobeRow = Pick<
  WardrobeItem,
  | 'id'
  | 'name'
  | 'description'
  | 'category'
  | 'type'
  | 'subtype'
  | 'mainColor'
  | 'secondaryColor'
  | 'attributes'
  | 'keywords'
  | 'searchDoc'
>;

type SemanticResultRow = WardrobeRow & { distance: number };
type KeywordResultRow = WardrobeRow & { keyword_matches: number | null };
type TextResultRow = WardrobeRow;

/**
 * Dynamic tool for searching user wardrobe using hybrid search approach.
 * Combines semantic similarity, keyword matching, and text search with optional filters.
 * Optimized for LLM styling suggestions and outfit recommendations.
 */
export function searchWardrobe(userId: string): Tool {
  const searchWardrobeSchema = z.object({
    query: z
      .string()
      .describe(
        "A natural language description of the clothing item(s) you're looking for. Be specific about style, occasion, color, or type (e.g., 'navy chinos for work', 'casual summer dress').",
      ),
    filters: z
      .object({
        category: z.enum(WardrobeItemCategory).optional().describe('Filter by clothing category'),
        type: z
          .string()
          .optional()
          .describe("Filter by specific item type (e.g., 'jeans', 'blouse')"),
        color: z.string().optional().describe('Filter by color (matches main or secondary color)'),
        keywords: z.array(z.string()).optional().describe('Filter by specific keywords or tags'),
      })
      .optional()
      .describe('Optional filters to narrow down search results'),
    limit: z.number().default(20).describe('Maximum number of results to return'),
  });

  return new Tool({
    name: 'searchWardrobe',
    description:
      "Searches the user's digital wardrobe using hybrid search combining semantic similarity, keyword matching, and filtering. Ideal for finding specific items for styling suggestions, outfit building, or wardrobe analysis. Returns detailed item information including colors, attributes, and style characteristics.",
    schema: searchWardrobeSchema,
    func: async ({ query, filters, limit }: z.infer<typeof searchWardrobeSchema>) => {
      if (query.trim() === '') {
        throw new BadRequestError('Search query is required');
      }

      try {
        const model = new OpenAIEmbeddings({
          model: 'text-embedding-3-small',
        });

        const baseConditions = [`"userId" = $1`];
        const params: string[] = [userId];

        if (filters?.category) {
          params.push(filters.category);
          baseConditions.push(`"category"::text = $${params.length}`);
        }

        if (filters?.type) {
          params.push(filters.type.toLowerCase());
          baseConditions.push(`LOWER("type") = $${params.length}`);
        }

        if (filters?.color) {
          params.push(filters.color.toLowerCase());
          baseConditions.push(
            `(LOWER("mainColor") = $${params.length} OR LOWER("secondaryColor") = $${params.length})`,
          );
        }

        const baseWhere = baseConditions.join(' AND ');
        const resultsMap = new Map<
          string,
          { item: WardrobeRow; score: number; sources: string[] }
        >();

        // 1. Semantic Search (Vector Similarity)
        const embeddingCount = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          'SELECT COUNT(*) as count FROM "WardrobeItem" WHERE "userId" = $1 AND "embedding" IS NOT NULL',
          userId,
        );
        const embeddingStats = embeddingCount[0];
        if (embeddingStats && Number(embeddingStats.count) > 0) {
          logger.debug({ query }, 'Embedding search query for wardrobe search');
          const embedded = await model.embedQuery(query);
          const vector = JSON.stringify(embedded);

          let semanticQuery = `
            SELECT id, name, description, category, type, subtype, "mainColor", "secondaryColor", attributes, keywords, "searchDoc",
                   ("embedding" <=> $${params.length + 1}::vector) as distance
            FROM "WardrobeItem"
            WHERE "embedding" IS NOT NULL AND ${baseWhere}
            ORDER BY "embedding" <=> $${params.length + 1}::vector
            LIMIT ${Math.min(limit * 2, 40)}
          `;

          const semanticResults = await prisma.$queryRawUnsafe<SemanticResultRow[]>(
            semanticQuery,
            ...params,
            vector,
          );

          for (const item of semanticResults) {
            const { distance, ...itemData } = item;
            const score = Math.max(0, 1 - distance);
            resultsMap.set(item.id, {
              item: itemData,
              score: score * 0.6, // Weight semantic search at 60%
              sources: ['semantic'],
            });
          }
        }

        // 2. Keyword Search (Array overlap and text search)
        if (filters?.keywords && filters.keywords.length > 0) {
          const keywordQuery = `
            SELECT id, name, description, category, type, subtype, "mainColor", "secondaryColor", attributes, keywords, "searchDoc",
                   array_length(keywords & $${params.length + 1}, 1) as keyword_matches
            FROM "WardrobeItem"
            WHERE ${baseWhere} AND keywords && $${params.length + 1}
            ORDER BY array_length(keywords & $${params.length + 1}, 1) DESC
            LIMIT ${Math.min(limit * 2, 40)}
          `;

          const keywordResults = await prisma.$queryRawUnsafe<KeywordResultRow[]>(
            keywordQuery,
            ...params,
            filters.keywords.map((k) => k.toLowerCase()),
          );

          for (const item of keywordResults) {
            const { keyword_matches, ...itemData } = item;
            const score = Math.min(
              1,
              (keyword_matches || 0) / Math.max(filters.keywords.length, 1),
            );

            const existing = resultsMap.get(item.id);
            if (existing) {
              existing.score += score * 0.3;
              existing.sources.push('keywords');
            } else {
              resultsMap.set(item.id, {
                item: itemData,
                score: score * 0.3,
                sources: ['keywords'],
              });
            }
          }
        }

        // 3. Text Search (Name and description)
        const searchTerms = query
          .toLowerCase()
          .split(/\s+/)
          .filter((term) => term.length > 2);
        if (searchTerms.length > 0) {
          const textQuery = `
            SELECT id, name, description, category, type, subtype, "mainColor", "secondaryColor", attributes, keywords, "searchDoc"
            FROM "WardrobeItem"
            WHERE ${baseWhere} AND (
              ${searchTerms.map((_, i) => `(LOWER(name) LIKE $${params.length + i + 1} OR LOWER(description) LIKE $${params.length + i + 1} OR LOWER("searchDoc") LIKE $${params.length + i + 1})`).join(' OR ')}
            )
            LIMIT ${Math.min(limit * 2, 40)}
          `;

          const textParams = searchTerms.map((term) => `%${term}%`);
          const textResults = await prisma.$queryRawUnsafe<TextResultRow[]>(
            textQuery,
            ...params,
            ...textParams,
          );

          for (const item of textResults) {
            const nameMatches = searchTerms.filter(
              (term) =>
                item.name.toLowerCase().includes(term) ||
                item.description.toLowerCase().includes(term) ||
                (item.searchDoc && item.searchDoc.toLowerCase().includes(term)),
            ).length;

            const score = Math.min(1, nameMatches / searchTerms.length);

            const existing = resultsMap.get(item.id);
            if (existing) {
              existing.score += score * 0.3;
              existing.sources.push('text');
            } else {
              resultsMap.set(item.id, {
                item,
                score: score * 0.3,
                sources: ['text'],
              });
            }
          }
        }

        // Sort by combined score and return top results
        const sortedResults = Array.from(resultsMap.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((result) => ({
            id: result.item.id,
            name: result.item.name,
            description: result.item.description,
            category: result.item.category,
            type: result.item.type,
            subtype: result.item.subtype,
            mainColor: result.item.mainColor,
            secondaryColor: result.item.secondaryColor,
            attributes: result.item.attributes,
            keywords: result.item.keywords,
          }));

        if (sortedResults.length === 0) {
          return "Nothing found in the user's wardrobe for this query.";
        }

        return sortedResults;
      } catch (err: unknown) {
        logger.error(
          { userId, query, filters, err: (err as Error)?.message },
          'Failed to search wardrobe',
        );
        throw new InternalServerError('Failed to search wardrobe', {
          cause: err,
        });
      }
    },
  });
}

/**
 * Dynamic tool for retrieving user's latest color analysis results.
 * Provides color palette information, undertone analysis, and color recommendations.
 */
export function fetchColorAnalysis(userId: string): Tool {
  // Use z.object({}) without passthrough to avoid OpenAI schema issues
  // The schema processor will add the required type and properties
  const fetchColorAnalysisSchema = z.object({}).describe('No parameters. Must be called with {}.');

  return new Tool({
    name: 'fetchColorAnalysis',
    description:
      "Retrieves the user's most recent color analysis results. Includes their recommended color palette, skin undertone, colors to wear, and colors to avoid. Use for personalized style advice.",
    schema: fetchColorAnalysisSchema,
    func: async () => {
      try {
        const result = await prisma.colorAnalysis.findFirst({
          select: {
            palette_name: true,
            palette_description: true,
            compliment: true,
            colors_suited: true,
            colors_to_wear: true,
            colors_to_avoid: true,
          },
          where: { userId },
          orderBy: { createdAt: 'desc' },
        });
        if (!result) {
          return 'No color analysis found for the user.';
        }
        result.colors_suited = Array.isArray(result.colors_suited) ? result.colors_suited : [];
        result.colors_to_wear =
          typeof result.colors_to_wear === 'object' && result.colors_to_wear !== null
            ? result.colors_to_wear
            : { clothing: [], jewelry: [] };
        result.colors_to_avoid = Array.isArray(result.colors_to_avoid)
          ? result.colors_to_avoid
          : [];
        result.palette_name = result.palette_name ?? null;
        result.palette_description = result.palette_description ?? null;
        return result;
      } catch (err: unknown) {
        logger.error({ userId, err: (err as Error)?.message }, 'Failed to fetch color analysis');
        throw new InternalServerError('Failed to fetch color analysis', {
          cause: err,
        });
      }
    },
  });
}

/**
 * Dynamic tool for retrieving user memories using semantic similarity search.
 * Optimized for fashion styling context - finds user preferences, sizes, style tastes, and constraints.
 */
export function fetchRelevantMemories(userId: string): Tool {
  const fetchRelevantMemoriesSchema = z.object({
    query: z
      .string()
      .describe(
        'A natural language query describing what you want to know about the user. Examples: "user size preferences", "favorite colors", "style preferences", "budget constraints", "fabric dislikes", "occasion needs", or "fit preferences".',
      ),
    limit: z.number().default(10).describe('Maximum number of relevant memories to return'),
  });

  return new Tool({
    name: 'fetchRelevantMemories',
    description:
      "Searches the user's fashion memories to find relevant personal information for styling advice. Retrieves stored facts about their sizes, style preferences, color likes/dislikes, budget constraints, fabric sensitivities, occasion needs, fit preferences, and other styling-relevant details. Essential for providing personalized recommendations.",
    schema: fetchRelevantMemoriesSchema,
    func: async ({ query, limit }: z.infer<typeof fetchRelevantMemoriesSchema>) => {
      if (query.trim() === '') {
        throw new BadRequestError('Query is required');
      }

      try {
        const embeddingCount = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
          'SELECT COUNT(*) as count FROM "Memory" WHERE "userId" = $1 AND "embedding" IS NOT NULL',
          userId,
        );

        if (Number(embeddingCount[0].count) === 0) {
          return "No memories found for this user. The user hasn't shared any personal preferences or information yet.";
        }

        const model = new OpenAIEmbeddings({ model: 'text-embedding-3-small' });
        logger.debug({ query }, 'Embedding memory search query');
        const embeddedQuery = await model.embedQuery(query);
        const vector = JSON.stringify(embeddedQuery);

        const memories: { id: string; memory: string; createdAt: Date; similarity: number }[] =
          await prisma.$queryRawUnsafe(
            'SELECT id, memory, "createdAt", (1 - ("embedding" <=> $1::vector)) as similarity FROM "Memory" WHERE "embedding" IS NOT NULL AND "userId" = $2 ORDER BY "embedding" <=> $1::vector LIMIT $3',
            vector,
            userId,
            limit,
          );

        if (memories.length === 0) {
          return 'No relevant memories found for this query.';
        }

        const formattedMemories = memories.map(({ memory, createdAt, similarity }) => ({
          memory,
          relevance: similarity > 0.8 ? 'high' : similarity > 0.6 ? 'medium' : 'low',
          createdAt: createdAt.toISOString().split('T')[0],
        }));

        return formattedMemories;
      } catch (err: unknown) {
        logger.error(
          { userId, query, limit, err: (err as Error)?.message },
          'Failed to fetch relevant memories',
        );
        throw new InternalServerError('Failed to fetch relevant memories', {
          cause: err,
        });
      }
    },
  });
}

// ============================================================================
// PRODUCT CATALOG SEARCH
// ============================================================================

/**
 * Extracts structured attributes from a natural language query using LLM.
 */
async function understandQuery(query: string, existingFilters: { gender?: string | undefined; ageGroup?: string | undefined }): Promise<QueryAttributes> {
  try {
    const querySchema = z.object({
      color: z.string().nullable().optional().describe('Color mentioned in query (e.g., "Black", "Navy", "White", "Burnt Orange", "Rust", "Terracotta")'),
      brand: z.string().nullable().optional().describe('Brand name if mentioned in query'),
      style: z.string().nullable().optional().describe('Style mentioned (e.g., "casual", "formal", "sporty")'),
      occasion: z.string().nullable().optional().describe('Occasion mentioned (e.g., "work", "party", "everyday", "casual", "formal", "sporty")'),
      palette: z.string().nullable().optional().describe('Seasonal color palette name if mentioned (e.g., "True Autumn", "Dark Winter", "Bright Spring", "Light Summer", "True Spring", "Soft Summer", "Soft Autumn", "Dark Autumn", "True Winter", "Bright Winter", "Dark Winter")'),
      category: z.string().nullable().optional().describe('Main category mentioned (e.g., "Clothing & Fashion", "Footwear", "Beauty & Personal Care", "Jewellery & Accessories", "Bags & Luggage", "Health & Wellness")'),
      subCategory: z.string().nullable().optional().describe('Sub category mentioned (e.g., "Tops", "Bottoms", "Footwear", "Sneakers", "Hoodies", "Shirts")'),
    });

    const model = new ChatGroq({ model: 'llama-3.3-70b-versatile' });
    const structuredModel = model.withStructuredOutput(querySchema);

    // Create minimal trace buffer for LLM call
    const traceBuffer: TraceBuffer = {
      nodeRuns: [{
        id: createId(),
        nodeName: 'query-understanding',
        startTime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }],
      llmTraces: [],
    };

    const categoryHierarchy = {
      'Clothing & Fashion': {
        'Tops': ['T-Shirts', 'Shirts', 'Blouses', 'Crop Tops', 'Tanks', 'Hoodies', 'Sweatshirts', 'Kurtas', 'Tunics', 'Kaftan', 'Jackets', 'Coats', 'Blazers', 'Shrugs', 'Sweaters', 'Cardigans'],
        'Bottoms': ['Jeans', 'Trousers', 'Joggers', 'Shorts', 'Skirts', 'Palazzos', 'Skort', 'Sweatpants'],
      },
      'Beauty & Personal Care': {
        'Skincare': ['Moisturizers', 'Cleansers', 'Toners', 'Serums', 'Essences', 'Sunscreens', 'Face Masks', 'Eye Creams'],
        'Makeup': ['Foundations', 'Concealers', 'Blush', 'Bronzer', 'Highlighter', 'Lipsticks', 'Lip Balms', 'Mascaras', 'Eyeliners'],
        'Hair Care': ['Shampoo', 'Conditioner', 'Hair Masks', 'Hair Oils', 'Hair Serums', 'Styling Products'],
        'Fragrance': ['Perfume', 'Body Mist', 'Deodorants'],
        'Men\'s Grooming': ['Beard Care', 'Shaving'],
        'Body Care': [],
      },
      'Health & Wellness': {
        'Nutrition & Supplements': ['Protein & Amino Acids', 'Vitamins & Minerals', 'Herbal & Ayurvedic', 'Weight Management', 'Sleep & Recovery', 'Immunity Booster'],
        'Smart Healthtech & Electronics': ['Smart Rings', 'Smart Bands', 'Fitness Trackers', 'Smart Scales', 'Smart mirrors', 'Gym Equipments'],
      },
      'Jewellery & Accessories': {
        'Jewellery': ['Necklaces', 'Earrings', 'Rings', 'Bracelets'],
        'Watches': [],
      },
      'Footwear': {
        'Footwear': ['Sneakers', 'Casual Shoes', 'Sports Shoes', 'Boots', 'Sandals', 'Heels', 'Flats', 'Shoes', 'Low-tops', 'High-tops', 'Flip Flops', 'Gym Shoes', 'Formal Shoes', 'Slippers'],
      },
      'Bags & Luggage': {
        'Bags & Luggage': ['Backpacks', 'Handbags', 'Totes', 'Wallets', 'Luggage', 'Sling Bags', 'Suitcases', 'Messenger Bags', 'Travel Accessories', 'Laptop Sleeves'],
      },
    };


    const systemPrompt = new SystemMessage(
      'You are a product search query analyzer. Extract structured attributes from natural language product search queries. ' +
      'Only extract attributes that are explicitly mentioned or clearly implied in the query. ' +
      'Return null for any attribute that cannot be determined from the query. Your response must be a JSON object.' +
      '\n\nIMPORTANT COLOR NORMALIZATION RULES:' +
      '- Normalize color names to standard fashion/retail color names' +
      '- Examples: "rust" -> "rust", "terracotta" -> "terracotta" or "orange", "burnt orange" -> "burnt orange" or "orange"' +
      '- "burgundy" -> "burgundy" or "maroon", "navy" -> "navy" or "blue", "beige" -> "beige" or "tan"' +
      '- Preserve specific color names when they are standard (e.g., "rust", "terracotta", "burgundy")' +
      '- For ambiguous colors, provide the most common standard name' +
      '- Return the normalized color name in lowercase' +
      '\n\nPALETTE EXTRACTION RULES:' +
      '- Extract seasonal color palette names when mentioned (e.g., "True Autumn", "Dark Winter", "Bright Spring")' +
      '- Common palette names: True Autumn, Dark Autumn, Soft Autumn, True Spring, Light Spring, Bright Spring, True Summer, Light Summer, Soft Summer, True Winter, Bright Winter, Dark Winter' +
      '- Return palette name in Title Case format (e.g., "True Autumn" not "TRUE_AUTUMN" or "true autumn")' +
      '\n\nCATEGORY EXTRACTION RULES:' +
      '- Extract main category when mentioned: "Clothing & Fashion", "Footwear", "Beauty & Personal Care", "Jewellery & Accessories", "Bags & Luggage", "Health & Wellness"' +
      '- For clothing-related queries (shirts, pants, hoodies, etc.), extract "Clothing & Fashion"' +
      '- For shoe-related queries (sneakers, boots, sandals, etc.), extract "Footwear"' +
      '- Return category name exactly as listed above' +
      '\n\nSUBCATEGORY EXTRACTION RULES:' +
      '- Extract sub category when mentioned: "Tops", "Bottoms", "Footwear", "Sneakers", "Hoodies", "Shirts", etc.' +
      '- Map product types to sub categories (e.g., "hoodie" -> "Tops", "jeans" -> "Bottoms", "sneakers" -> "Footwear")' +
      '- Return sub category name in Title Case format' +
      '\n\nOCCASION EXTRACTION RULES:' +
      '- Extract occasion when mentioned: "work", "party", "everyday", "casual", "formal", "sporty", "gym", "office", "wedding", "beach", etc.' +
      '- Normalize to common occasion names (e.g., "office" -> "work", "gym" -> "sporty")' +
      '- Return occasion name in lowercase'
    );

    const userMessage = new UserMessage(
      `Query: "${query}"\n\n` +
      (existingFilters.gender ? `Existing gender filter: ${existingFilters.gender}\n` : '') +
      (existingFilters.ageGroup ? `Existing age group filter: ${existingFilters.ageGroup}\n` : '') +
      '\nExtract all relevant product attributes from this query.'
    );

    const result = await structuredModel.run(systemPrompt, [userMessage], traceBuffer, 'query-understanding');
    
    // Convert undefined to null to match QueryAttributes type
    return {
      color: result.color ?? null,
      brand: result.brand ?? null,
      style: result.style ?? null,
      occasion: result.occasion ?? null,
      palette: result.palette ?? null,
      category: result.category ?? null,
      subCategory: result.subCategory ?? null,
    };
  } catch (err) {
    logger.warn({ query, err: (err as Error)?.message }, 'Query understanding failed, continuing without extracted attributes');
    return {};
  }
}





/**
 * Tool for searching the Broadway product catalog using hybrid retrieval.
 * 
 * Architecture:
 * - Phase 1: Broad Vector Recall - Run vector search on entire table (no strict filters)
 * - Phase 2: Intent-Based Soft Reranking - Rerank candidates in memory based on intent matching
 * 
 * This approach ensures high recall and prevents zero-result scenarios while maintaining precision
 * through semantic similarity and soft intent matching.
 */
export function searchProducts(): Tool {
  const searchProductsSchema = z
    .object({
      query: z.string().describe('Natural language product search query'),
      filters: z
        .object({
          gender: z.enum(['male', 'female', 'other']).optional(),
          ageGroup: z.enum(['teen', 'adult', 'senior']).optional(),
        })
        .strict(),
      limit: z.number().int().positive().min(8).max(12).default(12),
    })
    .strict();

  return new Tool({
    name: 'searchProducts',
    description:
      'Searches the Broadway product catalog to find products matching the query. Uses hybrid retrieval with broad vector recall and intent-based reranking. Returns product recommendations with name, brand, image, and description. Use this to recommend specific products from our catalog during styling advice.',
    schema: searchProductsSchema,
    func: async ({ query, filters = {}, limit = 5 }: z.infer<typeof searchProductsSchema>) => {
      if (query.trim() === '') {
        throw new BadRequestError('Search query is required');
      }

      try {
        // Step 1: Query Understanding - Extract structured attributes from natural language
        const queryAttrs = await understandQuery(query, {
          gender: filters.gender,
          ageGroup: filters.ageGroup,
        });
        
        // Build intent object for soft reranking
        // Note: gender and ageGroup come from filters (tool schema), not from query understanding
        const intent = {
          gender: filters.gender || null,
          ageGroup: filters.ageGroup || null,
          color: queryAttrs.color || null, // Normalized color from AI
          brand: queryAttrs.brand || null,
          style: queryAttrs.style || null,
          occasion: queryAttrs.occasion || null,
          palette: queryAttrs.palette || null, // Seasonal color palette name
          category: queryAttrs.category || null,
          subCategory: queryAttrs.subCategory || null,
        };

        // Step 2: Generate enhanced query embedding with context
        // Include occasion, color palette, category, subCategory, gender, colors, and features context
        const embeddingModel = new OpenAIEmbeddings({
          model: 'text-embedding-3-small',
        });
        
        // Build enhanced query with all context for better semantic matching
        // Include requirements: mix of clothing and footwear for complete outfit recommendations
        const enhancedQueryParts: string[] = [query];
        
        if (intent.occasion) {
          enhancedQueryParts.push(`for ${intent.occasion} occasion`);
        }
        if (intent.palette) {
          enhancedQueryParts.push(`${intent.palette} color palette`);
          // When a palette is detected, include the top colors from that palette in the query
          // This ensures we search for products in the specific colors that match the palette
          try {
            // Normalize palette name to match SeasonalPalette enum format
            // Handle both "True Spring" (Title Case) and "TRUE_SPRING" (enum format)
            let paletteEnumKey: SeasonalPalette;
            if (intent.palette.includes('_')) {
              // Already in enum format (e.g., "TRUE_SPRING")
              paletteEnumKey = intent.palette.toUpperCase() as SeasonalPalette;
            } else {
              // Convert Title Case to enum format (e.g., "True Spring" -> "TRUE_SPRING")
              paletteEnumKey = intent.palette
                .toUpperCase()
                .replace(/\s+/g, '_') as SeasonalPalette;
            }
            if (isValidPalette(paletteEnumKey)) {
              const paletteData = getPaletteData(paletteEnumKey);
              // Include top 5 colors from the palette to improve color matching
              // These specific color names will help the semantic search find products in these exact colors
              const paletteColors = paletteData.topColors
                .slice(0, 5)
                .map((c) => c.name)
                .join(', ');
              if (paletteColors) {
                enhancedQueryParts.push(`in colors ${paletteColors}`);
              }
            }
          } catch (err) {
            // If palette lookup fails, continue without palette colors
            logger.debug({ palette: intent.palette, err }, 'Failed to get palette colors for query enhancement');
          }
        }
        if (intent.category) {
          enhancedQueryParts.push(`in ${intent.category} category`);
        }
        if (intent.subCategory) {
          enhancedQueryParts.push(`${intent.subCategory} subcategory`);
        }
        if (intent.color) {
          enhancedQueryParts.push(`${intent.color} color`);
        }
        if (intent.gender) {
          enhancedQueryParts.push(`for ${intent.gender} gender`);
        }
        if (intent.style) {
          enhancedQueryParts.push(`${intent.style} style`);
        }
        // Add features context - mention common product features
        enhancedQueryParts.push('with features like comfort, quality, style, design');
        // Add requirement for variety: include both clothing and footwear products
        enhancedQueryParts.push('include variety of clothing and footwear products');
        
        const enhancedQuery = enhancedQueryParts.join(' ');
        logger.info({ enhancedQuery }, 'Embedding enhanced product search query');
        const embeddedQuery = await embeddingModel.embedQuery(enhancedQuery);
        const vector = JSON.stringify(embeddedQuery);

        // Helper function to convert enum name to database value
        // Database stores: MALE, FEMALE, OTHER (uppercase)
        const enumToDbValue = (enumValue: string | null): string | null => {
          if (!enumValue) return null;
          return enumValue.toLowerCase();
        };

        // Convert gender enum to database value for querying
        const genderDbValue = intent.gender ? enumToDbValue(intent.gender) : null;
        const ageGroupDbValue = intent.ageGroup ? enumToDbValue(intent.ageGroup) : null;
        
        // Normalize color early to check if this is a color-focused query
        const normalizedColor = intent.color ? intent.color.toLowerCase().trim() : null;
        
        // Normalize palette name - convert to Title Case to match CSV format
        // Helper function to normalize palette names (e.g., "TRUE_AUTUMN" -> "True Autumn", "true autumn" -> "True Autumn")
        const normalizePaletteName = (palette: string | null): string | null => {
          if (!palette) return null;
          // Convert to Title Case (e.g., "true autumn" -> "True Autumn")
          return palette
            .split(/\s+|_/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
        };
        const normalizedPalette = normalizePaletteName(intent.palette);

        // Phase 1: Vector Search with Gender Filter - Gender filter applied as hard constraint








        const baseConditions: string[] = [
          '"embedding" IS NOT NULL',
        ];
        const baseParams: (string | number)[] = [];
        let paramIndex = 1;

        // Apply gender filter as hard constraint to ensure gender-appropriate recommendations
        if (genderDbValue) {
          if (genderDbValue === 'MALE') {
            // For male users: include only male or null (exclude female and other)
            baseConditions.push(`(gender = 'MALE' OR gender IS NULL)`);
          } else if (genderDbValue === 'FEMALE') {
            // For female users: include female, unisex, other, or null (exclude male)
            baseConditions.push(`(gender = 'FEMALE' OR gender IS NULL OR gender = 'OTHER')`);
          }
          // Note: 'OTHER' gender from filters will allow all products (no filter applied)
        }
        
        const whereClause = baseConditions.join(' AND ');
        const vectorParamIndex = paramIndex;

        // Vector similarity search - retrieve top 200 candidates for reranking
        // Use alias to ensure consistent column name in results
        const vectorRecallQuery = `
          SELECT id, barcode, name, "brandName", gender, "ageGroup", 
                 "imageUrl" as "imageUrl", colors,
                 category, "subCategory", "productType", "colorPalette", "allTags", "createdAt",
                 ("embedding" <=> $${vectorParamIndex}::vector) as distance,
                 (1 - ("embedding" <=> $${vectorParamIndex}::vector)) as similarity
          FROM "Product"
          WHERE ${whereClause}
          ORDER BY "embedding" <=> $${vectorParamIndex}::vector
          LIMIT 1000
        `;

        // Log removed for verbosity reduction

        const vectorCandidates = await prisma.$queryRawUnsafe<any[]>(
          vectorRecallQuery,
          ...baseParams,
          vector,
        );
        
        // Map to ProductSemanticRow - handle both camelCase and lowercase column names
        // PostgreSQL with $queryRawUnsafe returns column names as-is (case-sensitive when quoted)
        const mappedCandidates: ProductSemanticRow[] = vectorCandidates.map((row: any) => {
          // Try all possible case variations for imageUrl
          const imageUrl = row.imageUrl || 
                          row.imageurl || 
                          row['imageUrl'] || 
                          row['imageurl'] ||
                          (Object.keys(row).find(k => k.toLowerCase() === 'imageurl') ? row[Object.keys(row).find(k => k.toLowerCase() === 'imageurl')!] : null) ||
                          '';
          
          return {
            ...row,
            imageUrl: imageUrl,
          };
        });

        // Log removed for verbosity reduction

        // If vector search returns 0, return empty array (no text fallback)
        if (vectorCandidates.length === 0) {
          logger.debug({ query }, 'Vector search returned 0 results');
          return [];
        }

        // Phase 2: Intent-Based Soft Reranking
        // Boost products matching gender/ageGroup/color, but don't exclude others
        // normalizedColor already defined above
        
        const rerankedCandidates = mappedCandidates.map((candidate) => {
          let score = candidate.similarity; // Start with semantic similarity score

          // Gender matching boost (strong preference)
          if (genderDbValue && candidate.gender) {
            const candidateGenderDb = enumToDbValue(candidate.gender);
            if (candidateGenderDb === genderDbValue) {
              score += 0.3; // Strong boost for gender match
            } else if (candidateGenderDb === null || candidateGenderDb === 'OTHER' || candidateGenderDb === 'UNISEX') {
              score += 0.1; // Small boost for unisex/other products
            }
            // No penalty for mismatch - we want to show results even if not perfect match
          }

          // AgeGroup matching boost
          if (ageGroupDbValue && candidate.ageGroup) {
            const candidateAgeDb = enumToDbValue(candidate.ageGroup);
            if (candidateAgeDb === ageGroupDbValue) {
              score += 0.15; // Boost for age group match
            }
          }

          // Color palette matching boost (strongest preference - matches seasonal palette)
          if (normalizedPalette && candidate.colorPalette) {
            const candidatePalette = candidate.colorPalette.trim();
            // Exact match (case-insensitive)
            if (candidatePalette.toLowerCase() === normalizedPalette.toLowerCase()) {
              score += 0.5; // Very strong boost for exact palette match
            } else {
              // Partial match (palette name contains requested palette or vice versa)
              const hasPartialMatch = 
                candidatePalette.toLowerCase().includes(normalizedPalette.toLowerCase()) ||
                normalizedPalette.toLowerCase().includes(candidatePalette.toLowerCase());
              if (hasPartialMatch) {
                score += 0.3; // Strong boost for partial palette match
              }
            }
          }

          // Color matching boost (using AI-normalized color) - similarity matching
          if (normalizedColor && candidate.colors && candidate.colors.length > 0) {
            const candidateColors = candidate.colors.map(c => c.toLowerCase().trim());
            // Check for exact match
            if (candidateColors.includes(normalizedColor)) {
              score += 0.25; // Strong boost for exact color match
            } else {
              // Check for partial/similar match (color name contains normalized color or vice versa)
              const hasPartialMatch = candidateColors.some(c => 
                c.includes(normalizedColor) || normalizedColor.includes(c)
              );
              if (hasPartialMatch) {
                score += 0.1; // Moderate boost for partial/similar color match
              }
            }
          }

          // Category matching boost - similarity matching (not exact)
          if (intent.category && candidate.category) {
            const candidateCategory = (candidate.category || '').toLowerCase().trim();
            const intentCategory = (intent.category || '').toLowerCase().trim();
            
            // Exact match
            if (candidateCategory === intentCategory) {
              score += 0.3; // Strong boost for exact category match
            } else {
              // Similarity matching - check if categories are similar
              const hasSimilarMatch = 
                candidateCategory.includes(intentCategory) ||
                intentCategory.includes(candidateCategory) ||
                // Special handling for "Clothing & Fashion" and "Footwear"
                (intentCategory.includes('clothing') && candidateCategory.includes('clothing')) ||
                (intentCategory.includes('fashion') && candidateCategory.includes('fashion')) ||
                (intentCategory.includes('footwear') && candidateCategory.includes('footwear'));
              
              if (hasSimilarMatch) {
                score += 0.15; // Moderate boost for similar category match
              }
            }
          }

          // SubCategory matching boost - similarity matching (not exact)
          if (intent.subCategory && candidate.subCategory) {
            const candidateSubCategory = (candidate.subCategory || '').toLowerCase().trim();
            const intentSubCategory = (intent.subCategory || '').toLowerCase().trim();
            
            // Exact match
            if (candidateSubCategory === intentSubCategory) {
              score += 0.25; // Strong boost for exact subCategory match
            } else {
              // Similarity matching - check if subCategories are similar
              const hasSimilarMatch = 
                candidateSubCategory.includes(intentSubCategory) ||
                intentSubCategory.includes(candidateSubCategory);
              
              if (hasSimilarMatch) {
                score += 0.12; // Moderate boost for similar subCategory match
              }
            }
          }

          // Occasion matching boost - similarity matching from allTags
          if (intent.occasion && candidate.allTags) {
            const candidateTags = (candidate.allTags || '').toLowerCase();
            const intentOccasion = (intent.occasion || '').toLowerCase().trim();
            
            // Check if allTags contains the occasion (similarity matching)
            if (candidateTags.includes(intentOccasion)) {
              score += 0.2; // Strong boost for occasion match in tags
            } else {
              // Similarity matching for common occasion variations
              const occasionVariations: { [key: string]: string[] } = {
                'work': ['office', 'professional', 'business', 'formal'],
                'party': ['celebration', 'festive', 'evening', 'night'],
                'casual': ['everyday', 'relaxed', 'comfortable', 'leisure'],
                'sporty': ['gym', 'sport', 'athletic', 'fitness', 'active'],
                'formal': ['dress', 'elegant', 'sophisticated', 'business'],
              };
              
              const variations = occasionVariations[intentOccasion] || [];
              const hasSimilarOccasion = variations.some(variation => 
                candidateTags.includes(variation)
              );
              
              if (hasSimilarOccasion) {
                score += 0.1; // Moderate boost for similar occasion match
              }
            }
          }

          // Boost for "Clothing & Fashion" and "Footwear" categories when making recommendations
          // This ensures these categories are prioritized in recommendations
          if (candidate.category) {
            const candidateCategory = (candidate.category || '').toLowerCase();
            if (candidateCategory.includes('clothing') || candidateCategory.includes('fashion')) {
              score += 0.05; // Small boost for Clothing & Fashion
            }
            if (candidateCategory.includes('footwear')) {
              score += 0.05; // Small boost for Footwear
            }
          }

          return {
            ...candidate,
            rerankScore: score,
          };
        });

        // Sort by rerank score and filter valid products
        // Simple approach: return top N products by rerank score
        // The enhanced embedding query with context handles all requirements
        const validCandidates = rerankedCandidates
          .filter((result) => {
            // Filter out products with empty or invalid imageUrls
            const imageUrl = result.imageUrl;
            return imageUrl && 
                   typeof imageUrl === 'string' && 
                   imageUrl.trim().length > 0 &&
                   (imageUrl.startsWith('http://') || 
                    imageUrl.startsWith('https://') || 
                    imageUrl.startsWith('data:'));
          })
          .sort((a, b) => b.rerankScore - a.rerankScore)
          .slice(0, limit); // Take top N products by rerank score

        // Map to final result format with barcode
        const mappedResults = validCandidates.map((result: any) => {
          // Handle PostgreSQL column name case sensitivity
          const imageUrl = result.imageUrl || result.imageurl || result['imageUrl'] || '';
          const barcode = result.barcode || '';
          
          return {
            name: result.name,
            brand: result.brandName || result.brandname,
            gender: result.gender,
            ageGroup: result.ageGroup || result.agegroup,
            colors: result.colors,
            imageUrl: imageUrl,
            barcode: barcode,
          };
        });

        logger.debug(
          { query, resultCount: mappedResults.length },
          'Product search completed',
        );

        return mappedResults;
      } catch (err: unknown) {
        logger.error({ query, filters, err: (err as Error)?.message }, 'Failed to search products');
        throw new InternalServerError('Failed to search products', {
          cause: err,
        });
      }
    },
  });
}
