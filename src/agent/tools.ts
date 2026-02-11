import { WardrobeItem, WardrobeItemCategory } from '@prisma/client';
import { z } from 'zod';

import { OpenAIEmbeddings, Tool } from '../lib/ai';

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
};

type ProductSemanticRow = ProductRow & { distance: number };

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
 * Tool for searching the Broadway product catalog.
 * Uses text search on name, brand, and description with structured filters.
 * Returns product recommendations with images.
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
          color: z
            .string()
            .optional()
            .describe("Filter by color (e.g., 'Black', 'Navy', 'White', 'Beige')"),
          brand: z.string().optional().describe('Filter by brand name'),
        })
        .strict()
        .default({}),
      limit: z.number().int().positive().default(5),
    })
    .strict();

  return new Tool({
    name: 'searchProducts',
    description:
      'Searches the Broadway product catalog to find products matching the query. Uses text search on name, brand, and description combined with filters for gender, age group, color, and brand. Returns product recommendations with name, brand, image, and description. Use this to recommend specific products from our catalog during styling advice.',
    schema: searchProductsSchema,
    func: async ({ query, filters = {}, limit = 5 }: z.infer<typeof searchProductsSchema>) => {
      if (query.trim() === '') {
        throw new BadRequestError('Search query is required');
      }

      try {
        // Build filter conditions
        const conditions: string[] = ['"isActive" = true'];
        const params: (string | number)[] = [];
        let paramIndex = 1;

        if (filters?.gender) {
          params.push(filters.gender.toLowerCase());
          conditions.push(`"gender"::text = $${paramIndex++}`);
        }

        if (filters?.ageGroup) {
          params.push(filters.ageGroup.toLowerCase());
          conditions.push(`"ageGroup"::text = $${paramIndex++}`);
        }

        if (filters?.color) {
          // Use LIKE for partial matching on colors array
          params.push(`%${filters.color.toLowerCase()}%`);
          conditions.push(
            `EXISTS (
              SELECT 1 FROM unnest("colors") AS col 
              WHERE LOWER(col::text) LIKE $${paramIndex}
            )`,
          );
          paramIndex++;
        }

        if (filters?.brand) {
          params.push(filters.brand.toLowerCase());
          conditions.push(`LOWER("brandName") = $${paramIndex++}`);
        }

        const whereClause = conditions.join(' AND ');

        // Text Search on name, brandName, and description
        const searchTerms = query
          .toLowerCase()
          .split(/\s+/)
          .filter((term) => term.length > 2);

        let results: ProductRow[] = [];

        if (searchTerms.length > 0) {
          const textConditions = searchTerms.map(
            (_, i) =>
              `(LOWER(name) LIKE $${paramIndex + i} OR LOWER("brandName") LIKE $${paramIndex + i} OR LOWER(description) LIKE $${paramIndex + i})`,
          );
          const textParams = searchTerms.map((term) => `%${term}%`);

          const textQuery = `
            SELECT id, barcode, name, "brandName" as "brandName", gender, "ageGroup" as "ageGroup", description, "imageUrl", colors
            FROM "Product"
            WHERE ${whereClause} AND (${textConditions.join(' OR ')})
            ORDER BY "createdAt" DESC
            LIMIT ${limit * 2}
          `;

          results = await prisma.$queryRawUnsafe<ProductRow[]>(
            textQuery,
            ...params,
            ...textParams,
          );
        } else {
          // If no search terms, just return filtered products
          const simpleQuery = `
            SELECT id, barcode, name, "brandName" as "brandName", gender, "ageGroup" as "ageGroup", description, "imageUrl", colors
            FROM "Product"
            WHERE ${whereClause}
            ORDER BY "createdAt" DESC
            LIMIT ${limit * 2}
          `;

          results = await prisma.$queryRawUnsafe<ProductRow[]>(simpleQuery, ...params);
        }

        // Score results based on match quality
        const scoredResults = results.map((item) => {
          const queryLower = query.toLowerCase();
          let score = 0;

          // Name matches get highest score
          if (item.name.toLowerCase().includes(queryLower)) {
            score += 3;
          }
          // Brand matches get medium score
          if (item.brandName.toLowerCase().includes(queryLower)) {
            score += 2;
          }
          // Description matches get lower score
          if (item.description && item.description.toLowerCase().includes(queryLower)) {
            score += 1;
          }

          // Count matching search terms
          const matchingTerms = searchTerms.filter(
            (term) =>
              item.name.toLowerCase().includes(term) ||
              item.brandName.toLowerCase().includes(term) ||
              (item.description && item.description.toLowerCase().includes(term)),
          ).length;

          score += matchingTerms * 0.5;

          return { item, score };
        });

        // Sort by score and return top results
        const sortedResults = scoredResults
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((result) => ({
            name: result.item.name,
            brand: result.item.brandName,
            gender: result.item.gender,
            ageGroup: result.item.ageGroup,
            description: result.item.description,
            colors: result.item.colors,
            imageUrl: result.item.imageUrl,
          }));

        // Fallback: if no results with filters, try without optional filters
        // IMPORTANT: Do NOT perform lenient fallback if gender or ageGroup filters were explicitly provided
        // as this can lead to incorrect recommendations (e.g., showing male products for a female query)
        if (
          sortedResults.length === 0 &&
          !(filters?.gender || filters?.ageGroup) && // Only fallback if NO gender or ageGroup filter was set
          (filters?.color || filters?.brand) // Still allow fallback for color/brand if no gender/ageGroup
        ) {
          logger.debug(
            { query, filters },
            'No results with filters, trying without optional filters (lenient fallback)',
          );

          const lenientConditions: string[] = ['"isActive" = true'];
          const lenientParams: (string | number)[] = [];
          let lenientParamIndex = 1;

          if (searchTerms.length > 0) {
            const textConditions = searchTerms.map(
              (_, i) =>
                `(LOWER(name) LIKE $${lenientParamIndex + i} OR LOWER("brandName") LIKE $${lenientParamIndex + i} OR LOWER(description) LIKE $${lenientParamIndex + i})`,
            );
            const textParams = searchTerms.map((term) => `%${term}%`);

            const lenientQuery = `
              SELECT id, barcode, name, "brandName" as "brandName", gender, "ageGroup" as "ageGroup", description, "imageUrl", colors
              FROM "Product"
              WHERE ${lenientConditions.join(' AND ')} AND (${textConditions.join(' OR ')})
              ORDER BY "createdAt" DESC
              LIMIT ${limit * 2}
            `;

            const lenientResults = await prisma.$queryRawUnsafe<ProductRow[]>(
              lenientQuery,
              ...textParams,
            );

            const lenientScored = lenientResults.map((item) => {
              const queryLower = query.toLowerCase();
              let score = 0;

              if (item.name.toLowerCase().includes(queryLower)) score += 3;
              if (item.brandName.toLowerCase().includes(queryLower)) score += 2;
              if (item.description && item.description.toLowerCase().includes(queryLower)) score += 1;

              const matchingTerms = searchTerms.filter(
                (term) =>
                  item.name.toLowerCase().includes(term) ||
                  item.brandName.toLowerCase().includes(term) ||
                  (item.description && item.description.toLowerCase().includes(term)),
              ).length;

              score += matchingTerms * 0.5;
              return { item, score };
            });

            const lenientSorted = lenientScored
              .sort((a, b) => b.score - a.score)
              .slice(0, limit)
              .map((result) => ({
                name: result.item.name,
                brand: result.item.brandName,
                gender: result.item.gender,
                ageGroup: result.item.ageGroup,
                description: result.item.description,
                colors: result.item.colors,
                imageUrl: result.item.imageUrl,
              }));

            if (lenientSorted.length > 0) {
              logger.info(
                { query, filters, resultCount: lenientSorted.length },
                'Product search completed (lenient fallback)',
              );
              return lenientSorted;
            }
          }
        }

        // Final fallback: return recent active products
        if (sortedResults.length === 0) {
          logger.debug(
            { query, filters },
            'No results found after all searches, returning fallback products',
          );

                    const fallbackConditions: string[] = [
                      `"isActive" = true`,
                      `"imageUrl" IS NOT NULL`,
                      `"imageUrl" != ''`
                    ];
                    const fallbackParams: (string | number)[] = [];
                    let fallbackParamIndex = 1;
          
                              if (filters?.gender) {
                                fallbackParams.push(filters.gender.toLowerCase());
                                fallbackConditions.push(`"gender"::text = $${fallbackParamIndex++}`);
                              }          
                              if (filters?.ageGroup) {
                                fallbackParams.push(filters.ageGroup.toLowerCase());
                                fallbackConditions.push(`"ageGroup"::text = $${fallbackParamIndex++}`);
                              }          
                    const fallbackWhereClause = fallbackConditions.join(' AND ');
          
                    const fallbackQuery = `
                      SELECT id, barcode, name, "brandName" as "brandName", gender, "ageGroup" as "ageGroup", description, "imageUrl", colors
                      FROM "Product"
                      WHERE ${fallbackWhereClause}
                      ORDER BY "createdAt" DESC
                      LIMIT ${limit}
                    `;
          
                    const fallbackResults = await prisma.$queryRawUnsafe<ProductRow[]>(fallbackQuery, ...fallbackParams);
          if (fallbackResults.length > 0) {
            logger.info(
              { query, filters, resultCount: fallbackResults.length },
              'Product search completed (fallback to recent products)',
            );

            return fallbackResults.map((item) => ({
              name: item.name,
              brand: item.brandName,
              gender: item.gender,
              ageGroup: item.ageGroup,
              description: item.description,
              colors: item.colors,
              imageUrl: item.imageUrl,
            }));
          }

          logger.warn(
            { query, filters },
            'Fallback search returned no products - database may be empty',
          );
          return [];
        }

        logger.info(
          { query, filters, resultCount: sortedResults.length },
          'Product search completed',
        );

        return sortedResults;
      } catch (err: unknown) {
        logger.error({ query, filters, err: (err as Error)?.message }, 'Failed to search products');
        throw new InternalServerError('Failed to search products', {
          cause: err,
        });
      }
    },
  });
}
