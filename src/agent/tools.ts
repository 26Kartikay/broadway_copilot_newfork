import { WardrobeItem, WardrobeItemCategory } from '@prisma/client';
import { z } from 'zod';

import { ChatOpenAI, OpenAIEmbeddings, SystemMessage, Tool, UserMessage } from '../lib/ai';
import type { TraceBuffer } from '../agent/tracing';
import { createId } from '@paralleldrive/cuid2';

import { prisma } from '../lib/prisma';
import { BadRequestError, InternalServerError } from '../utils/errors';
import { logger } from '../utils/logger';

// ============================================================================
// PRODUCT TYPES
// ============================================================================

type ProductRow = {
  id: string;
  barcode: string;
  name: string;
  brandName: string;
  gender: string | null;
  ageGroup: string | null;
  description: string;
  imageUrl: string;
  colors: string[];
  category: string | null;
  subCategory: string | null;
  productType: string | null;
  style: string | null;
  occasion: string | null;
  fit: string | null;
  season: string | null;
  popularityScore: number | null;
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
  category?: string | null;
  subCategory?: string | null;
  productType?: string | null;
  gender?: string | null;
  ageGroup?: string | null;
  color?: string | null;
  brand?: string | null;
  style?: string | null;
  occasion?: string | null;
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
        logger.debug({ userId, result }, 'Raw fetchColorAnalysis result');
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
    limit: z.number().default(5).describe('Maximum number of relevant memories to return'),
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
      category: z.string().nullable().optional().describe('Main product category from hierarchy: "Clothing & Fashion", "Beauty & Personal Care", "Health & Wellness", "Jewellery & Accessories", "Footwear", "Bags & Luggage"'),
      subCategory: z.string().nullable().optional().describe('Product subcategory from hierarchy (e.g., "Tops", "Bottoms", "Skincare", "Footwear", "Jewellery")'),
      productType: z.string().nullable().optional().describe('Specific product type from hierarchy (e.g., "T-Shirts", "Jeans", "Moisturizers", "Sneakers", "Handbags")'),
      gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable().optional().describe('Gender if mentioned in query'),
      ageGroup: z.enum(['TEEN', 'ADULT', 'SENIOR']).nullable().optional().describe('Age group if mentioned in query'),
      color: z.string().nullable().optional().describe('Color mentioned in query (e.g., "Black", "Navy", "White")'),
      brand: z.string().nullable().optional().describe('Brand name if mentioned in query'),
      style: z.string().nullable().optional().describe('Style mentioned (e.g., "casual", "formal", "sporty")'),
      occasion: z.string().nullable().optional().describe('Occasion mentioned (e.g., "work", "party", "everyday")'),
    });

    const model = new ChatOpenAI({ model: 'gpt-4o-mini' });
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
      'Return null for any attribute that cannot be determined from the query. ' +
      '\n\nIMPORTANT COLOR NORMALIZATION RULES:' +
      '- Normalize color names to standard fashion/retail color names' +
      '- Examples: "rust" -> "rust", "terracotta" -> "terracotta" or "orange", "burnt orange" -> "burnt orange" or "orange"' +
      '- "burgundy" -> "burgundy" or "maroon", "navy" -> "navy" or "blue", "beige" -> "beige" or "tan"' +
      '- Preserve specific color names when they are standard (e.g., "rust", "terracotta", "burgundy")' +
      '- For ambiguous colors, provide the most common standard name' +
      '- Return the normalized color name in lowercase' +
      '\n\nCATEGORY/SUBCATEGORY/PRODUCT TYPE EXTRACTION RULES:' +
      '- Use the following hierarchy to extract categories, subcategories, and product types:' +
      JSON.stringify(categoryHierarchy, null, 2) +
      '\n- DO NOT extract generic words like "fashion", "clothing", "items", "products" as category' +
      '- Extract category from the main categories listed above (e.g., "Clothing & Fashion", "Beauty & Personal Care")' +
      '- Extract subCategory from the subcategories within the main category (e.g., "Tops", "Bottoms", "Skincare")' +
      '- Extract productType from the specific product types within the subcategory (e.g., "T-Shirts", "Jeans", "Moisturizers")' +
      '- Match product types exactly as they appear in the hierarchy (case-sensitive)' +
      '- If the query says "fashion items" or "clothing", return null for category (these are too generic)' +
      '- Return null for category/subCategory/productType if you cannot determine a specific match from the hierarchy' +
      '\n\nOTHER NORMALIZATION:' +
      '- Gender: "MALE" not "male" or "men", "FEMALE" not "female" or "women"' +
      '- AgeGroup: "ADULT" not "adult" or "adults", "TEEN" not "teen", "SENIOR" not "senior"'
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
      category: result.category ?? null,
      subCategory: result.subCategory ?? null,
      productType: result.productType ?? null,
      gender: result.gender ?? null,
      ageGroup: result.ageGroup ?? null,
      color: result.color ?? null,
      brand: result.brand ?? null,
      style: result.style ?? null,
      occasion: result.occasion ?? null,
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
          gender: z
            .enum(['MALE', 'FEMALE', 'OTHER'])
            .optional()
            .describe('Filter by gender (MALE, FEMALE, OTHER)'),
          ageGroup: z
            .enum(['TEEN', 'ADULT', 'SENIOR'])
            .optional()
            .describe('Filter by age group (TEEN, ADULT, SENIOR)'),

        })
        .strict()
        .default({}),
      limit: z.number().int().positive().default(5),
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
        
        // Build intent object for soft reranking (explicit filters take precedence)
        const intent: QueryAttributes = {
          gender: filters.gender || queryAttrs.gender || null,
          ageGroup: filters.ageGroup || queryAttrs.ageGroup || null,
          category: queryAttrs.category || null,
          subCategory: queryAttrs.subCategory || null,
          color: queryAttrs.color || null, // Normalized color from AI
          // Note: brand is handled via semantic similarity, not strict filtering
        };

        // Step 2: Generate query embedding
        const embeddingModel = new OpenAIEmbeddings({
          model: 'text-embedding-3-small',
        });
        const embeddedQuery = await embeddingModel.embedQuery(query);
        const vector = JSON.stringify(embeddedQuery);

        // Helper function to convert enum name to database value
        // Prisma maps: MALE -> "male", FEMALE -> "female", OTHER -> "other"
        const enumToDbValue = (enumValue: string | null): string | null => {
          if (!enumValue) return null;
          return enumValue.toLowerCase();
        };

        // Convert gender enum to database value for querying
        const genderDbValue = intent.gender ? enumToDbValue(intent.gender) : null;
        const ageGroupDbValue = intent.ageGroup ? enumToDbValue(intent.ageGroup) : null;
        
        // Normalize color early to check if this is a color-focused query
        const normalizedColor = intent.color ? intent.color.toLowerCase().trim() : null;

        // Phase 1: Broad Vector Recall - Get candidates WITHOUT strict gender filter
        // This ensures we always get results, even if gender filter is too restrictive








        const baseConditions: string[] = [
          '"isActive" = true',
          '"embedding" IS NOT NULL',
          // Note: Don't filter imageUrl at SQL level - filter in JavaScript to see what's actually in DB
        ];
        const baseParams: (string | number)[] = [];
        let paramIndex = 1;

        // Apply soft filters (category, subCategory, etc.) but NOT gender/ageGroup/color as hard filters
        // Gender, ageGroup, and color will be used for reranking in Phase 2
        // Filter out generic category words that shouldn't be used as hard filters
        // Also, if the query is primarily about color, don't apply category filters (they're too restrictive)
        const genericCategoryWords = ['fashion', 'clothing', 'items', 'products', 'apparel', 'wear'];
        const isColorQuery = normalizedColor !== null; // If we have a normalized color, it's likely a color-focused query
        
        // Only apply category filter if:
        // 1. Category is not generic
        // 2. Query is not primarily color-focused (color queries should be broad)
        if (intent.category && 
            !genericCategoryWords.includes(intent.category.toLowerCase().trim()) &&
            !isColorQuery) {
          baseConditions.push(`"category" ILIKE $${paramIndex++}`);
          baseParams.push(`%${intent.category}%`);
        }
        // Same logic for subCategory and productType - skip if color query
        if (intent.subCategory && !isColorQuery) {
          baseConditions.push(`"subCategory" ILIKE $${paramIndex++}`);
          baseParams.push(`%${intent.subCategory}%`);
        }
        if (intent.productType && !isColorQuery) {
          baseConditions.push(`"productType" ILIKE $${paramIndex++}`);
          baseParams.push(`%${intent.productType}%`);
        }
        if (queryAttrs.brand) { // Use queryAttrs.brand as filters.brand was removed from schema
          baseConditions.push(`"brandName" ILIKE $${paramIndex++}`);
          baseParams.push(`%${queryAttrs.brand}%`);
        }
        // Note: Color is NOT added as a hard filter - it will be used for soft reranking
        
        const whereClause = baseConditions.join(' AND ');
        const vectorParamIndex = paramIndex;

        // Vector similarity search - retrieve top 200 candidates for reranking
        // Use alias to ensure consistent column name in results
        const vectorRecallQuery = `
          SELECT id, barcode, name, "brandName", gender, "ageGroup", description, 
                 "imageUrl" as "imageUrl", colors,
                 category, "subCategory", "productType", style, occasion, fit, season, "popularityScore", "createdAt",
                 ("embedding" <=> $${vectorParamIndex}::vector) as distance,
                 (1 - ("embedding" <=> $${vectorParamIndex}::vector)) as similarity
          FROM "Product"
          WHERE ${whereClause}
          ORDER BY "embedding" <=> $${vectorParamIndex}::vector
          LIMIT 200
        `;

        // Log the actual query for debugging
        logger.debug(
          {
            query,
            filters,
            whereClause,
            baseParamsCount: baseParams.length,
            vectorParamIndex,
          },
          'Executing vector recall query',
        );

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

        logger.info(
          {
            query,
            filters,
            candidates: mappedCandidates.length,
            whereClause,
          },
          'Phase 1 vector recall completed.',
        );

        // normalizedColor already defined above

        // Fallback: If vector search returns 0, try text-based search
        if (vectorCandidates.length === 0) {
          logger.warn(
            { query, filters, whereClause },
            'Vector search returned 0 candidates, trying text-based fallback',
          );

          // Text-based fallback search - use normalized color if available, otherwise use original query
          const searchTerms: string[] = [];
          const searchParams: string[] = [];
          let paramIdx = 1;

          // Add original query term
          searchTerms.push(`(LOWER(name) LIKE $${paramIdx} OR LOWER(description) LIKE $${paramIdx} OR LOWER("brandName") LIKE $${paramIdx})`);
          searchParams.push(`%${query.toLowerCase()}%`);
          paramIdx++;

          // Add normalized color term if available (separate from query)
          if (normalizedColor && normalizedColor !== query.toLowerCase()) {
            searchTerms.push(`EXISTS (SELECT 1 FROM unnest(colors) AS color WHERE LOWER(color) LIKE $${paramIdx})`);
            searchParams.push(`%${normalizedColor}%`);
            paramIdx++;
          } else {
            // If no normalized color, search colors with original query
            searchTerms.push(`EXISTS (SELECT 1 FROM unnest(colors) AS color WHERE LOWER(color) LIKE $1)`);
          }

          const textSearchQuery = `
            SELECT id, barcode, name, "brandName", gender, "ageGroup", description, "imageUrl", colors,
                   category, "subCategory", "productType", style, occasion, fit, season, "popularityScore", "createdAt",
                   0.5 as distance,
                   0.5 as similarity
            FROM "Product"
            WHERE "isActive" = true
              AND "imageUrl" IS NOT NULL
              AND "imageUrl" != ''
              AND LENGTH(TRIM("imageUrl")) > 0
              AND ("imageUrl" LIKE 'http://%' OR "imageUrl" LIKE 'https://%' OR "imageUrl" LIKE 'data:%')
              AND (${searchTerms.join(' OR ')})
            LIMIT 200
          `;

          const textCandidates = await prisma.$queryRawUnsafe<ProductSemanticRow[]>(
            textSearchQuery,
            ...searchParams,
          );

          logger.info(
            { query, textCandidates: textCandidates.length },
            'Text-based fallback search completed',
          );

          if (textCandidates.length === 0) {
            return []; // Return empty if both searches fail
          }

          // Use text candidates for reranking (normalizedColor already defined above)
          const rerankedCandidates = textCandidates.map((candidate) => {
            let score = candidate.similarity; // Start with base similarity score

            // Gender matching boost (strong preference)
            if (genderDbValue && candidate.gender) {
              const candidateGenderDb = enumToDbValue(candidate.gender);
              if (candidateGenderDb === genderDbValue) {
                score += 0.3; // Strong boost for gender match
              } else if (candidateGenderDb === null || candidateGenderDb === 'other' || candidateGenderDb === 'unisex') {
                score += 0.1; // Small boost for unisex/other products
              }
            }

            // AgeGroup matching boost
            if (ageGroupDbValue && candidate.ageGroup) {
              const candidateAgeDb = enumToDbValue(candidate.ageGroup);
              if (candidateAgeDb === ageGroupDbValue) {
                score += 0.15; // Boost for age group match
              }
            }

            // Color matching boost (using AI-normalized color)
            if (normalizedColor && candidate.colors && candidate.colors.length > 0) {
              const candidateColors = candidate.colors.map(c => c.toLowerCase().trim());
              // Check for exact match
              if (candidateColors.includes(normalizedColor)) {
                score += 0.25; // Strong boost for exact color match
              } else {
                // Check for partial match (color name contains normalized color or vice versa)
                const hasPartialMatch = candidateColors.some(c => 
                  c.includes(normalizedColor) || normalizedColor.includes(c)
                );
                if (hasPartialMatch) {
                  score += 0.1; // Moderate boost for partial color match
                }
              }
            }

            return {
              ...candidate,
              rerankScore: score,
            };
          });

          // Sort by rerank score and take top results
          // Filter out products with empty/null imageUrl before mapping
          const finalResults = rerankedCandidates
            .sort((a, b) => b.rerankScore - a.rerankScore)
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
            .slice(0, limit)
            .map((result) => ({
              name: result.name,
              brand: result.brandName,
              gender: result.gender,
              ageGroup: result.ageGroup,
              description: result.description,
              colors: result.colors,
              imageUrl: result.imageUrl, // Already validated above
            }));

          logger.info(
            {
              query,
              filters,
              resultCount: finalResults.length,
              textCandidatesCount: textCandidates.length,
              genderFilter: genderDbValue,
              ageGroupFilter: ageGroupDbValue,
              normalizedColor: normalizedColor,
              method: 'text-fallback',
            },
            'Product search completed (text fallback + intent-based reranking)',
          );

          return finalResults;
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
            } else if (candidateGenderDb === null || candidateGenderDb === 'other' || candidateGenderDb === 'unisex') {
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

          // Color matching boost (using AI-normalized color)
          if (normalizedColor && candidate.colors && candidate.colors.length > 0) {
            const candidateColors = candidate.colors.map(c => c.toLowerCase().trim());
            // Check for exact match
            if (candidateColors.includes(normalizedColor)) {
              score += 0.25; // Strong boost for exact color match
            } else {
              // Check for partial match (color name contains normalized color or vice versa)
              const hasPartialMatch = candidateColors.some(c => 
                c.includes(normalizedColor) || normalizedColor.includes(c)
              );
              if (hasPartialMatch) {
                score += 0.1; // Moderate boost for partial color match
              }
            }
          }

          return {
            ...candidate,
            rerankScore: score,
          };
        });

        // Sort by rerank score and take top results
        // Filter out products with empty/null imageUrl before mapping
        const beforeFilter = rerankedCandidates.length;
        const finalResults = rerankedCandidates
          .sort((a, b) => b.rerankScore - a.rerankScore)
          .filter((result) => {
            // Filter out products with empty or invalid imageUrls
            const imageUrl = result.imageUrl;
            const isValid = imageUrl && 
                   typeof imageUrl === 'string' && 
                   imageUrl.trim().length > 0 &&
                   (imageUrl.startsWith('http://') || 
                    imageUrl.startsWith('https://') || 
                    imageUrl.startsWith('data:'));
            
            if (!isValid) {
              logger.debug(
                {
                  query,
                  productName: result.name,
                  imageUrl: imageUrl,
                  imageUrlType: typeof imageUrl,
                  imageUrlLength: imageUrl ? imageUrl.length : 0,
                },
                'Filtering out product with invalid/empty imageUrl',
              );
            }
            
            return isValid;
          })
          .slice(0, limit)
          .map((result: any) => {
            // Handle PostgreSQL column name case sensitivity
            // PostgreSQL might return "imageUrl" or "imageurl" depending on quoting
            const imageUrl = result.imageUrl || result.imageurl || result['imageUrl'] || '';
            
            // Debug: Log the raw result to see what we're getting
            logger.debug(
              {
                query,
                productName: result.name,
                rawImageUrl: imageUrl,
                imageUrlType: typeof imageUrl,
                imageUrlLength: imageUrl ? imageUrl.length : 0,
                allKeys: Object.keys(result),
                hasImageUrl: !!result.imageUrl,
                hasImageurl: !!result.imageurl,
              },
              'Mapping product result',
            );
            
            return {
              name: result.name,
              brand: result.brandName || result.brandname,
              gender: result.gender,
              ageGroup: result.ageGroup || result.agegroup,
              description: result.description,
              colors: result.colors || [],
              imageUrl: imageUrl, // Handle case sensitivity
            };
          });

        logger.info(
          {
            query,
            filters,
            resultCount: finalResults.length,
            vectorCandidatesCount: vectorCandidates.length,
            genderFilter: genderDbValue,
            ageGroupFilter: ageGroupDbValue,
            normalizedColor: normalizedColor,
          },
          'Product search completed (vector recall + intent-based reranking)',
        );

        return finalResults;
      } catch (err: unknown) {
        logger.error({ query, filters, err: (err as Error)?.message }, 'Failed to search products');
        throw new InternalServerError('Failed to search products', {
          cause: err,
        });
      }
    },
  });
}
