"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchWardrobe = searchWardrobe;
exports.fetchColorAnalysis = fetchColorAnalysis;
exports.fetchRelevantMemories = fetchRelevantMemories;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const ai_1 = require("../lib/ai");
const prisma_1 = require("../lib/prisma");
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
function searchWardrobe(userId) {
    const searchWardrobeSchema = zod_1.z.object({
        query: zod_1.z
            .string()
            .describe("A natural language description of the clothing item(s) you're looking for. Be specific about style, occasion, color, or type (e.g., 'navy chinos for work', 'casual summer dress')."),
        filters: zod_1.z
            .object({
            category: zod_1.z.enum(client_1.WardrobeItemCategory).optional().describe('Filter by clothing category'),
            type: zod_1.z
                .string()
                .optional()
                .describe("Filter by specific item type (e.g., 'jeans', 'blouse')"),
            color: zod_1.z.string().optional().describe('Filter by color (matches main or secondary color)'),
            keywords: zod_1.z.array(zod_1.z.string()).optional().describe('Filter by specific keywords or tags'),
        })
            .optional()
            .describe('Optional filters to narrow down search results'),
        limit: zod_1.z.number().default(20).describe('Maximum number of results to return'),
    });
    return new ai_1.Tool({
        name: 'searchWardrobe',
        description: "Searches the user's digital wardrobe using hybrid search combining semantic similarity, keyword matching, and filtering. Ideal for finding specific items for styling suggestions, outfit building, or wardrobe analysis. Returns detailed item information including colors, attributes, and style characteristics.",
        schema: searchWardrobeSchema,
        func: async ({ query, filters, limit }) => {
            if (query.trim() === '') {
                throw new errors_1.BadRequestError('Search query is required');
            }
            try {
                const model = new ai_1.OpenAIEmbeddings({
                    model: 'text-embedding-3-small',
                });
                const baseConditions = [`"userId" = $1`];
                const params = [userId];
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
                    baseConditions.push(`(LOWER("mainColor") = $${params.length} OR LOWER("secondaryColor") = $${params.length})`);
                }
                const baseWhere = baseConditions.join(' AND ');
                const resultsMap = new Map();
                const embeddingCount = await prisma_1.prisma.$queryRawUnsafe('SELECT COUNT(*) as count FROM "WardrobeItem" WHERE "userId" = $1 AND "embedding" IS NOT NULL', userId);
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
                    const semanticResults = await prisma_1.prisma.$queryRawUnsafe(semanticQuery, ...params, vector);
                    for (const item of semanticResults) {
                        const { distance, ...itemData } = item;
                        const score = Math.max(0, 1 - distance);
                        resultsMap.set(item.id, {
                            item: itemData,
                            score: score * 0.6,
                            sources: ['semantic'],
                        });
                    }
                }
                if (filters?.keywords && filters.keywords.length > 0) {
                    const keywordQuery = `
            SELECT id, name, description, category, type, subtype, "mainColor", "secondaryColor", attributes, keywords, "searchDoc",
                   array_length(keywords & $${params.length + 1}, 1) as keyword_matches
            FROM "WardrobeItem"
            WHERE ${baseWhere} AND keywords && $${params.length + 1}
            ORDER BY array_length(keywords & $${params.length + 1}, 1) DESC
            LIMIT ${Math.min(limit * 2, 40)}
          `;
                    const keywordResults = await prisma_1.prisma.$queryRawUnsafe(keywordQuery, ...params, filters.keywords.map((k) => k.toLowerCase()));
                    for (const item of keywordResults) {
                        const { keyword_matches, ...itemData } = item;
                        const score = Math.min(1, (keyword_matches || 0) / Math.max(filters.keywords.length, 1));
                        const existing = resultsMap.get(item.id);
                        if (existing) {
                            existing.score += score * 0.3;
                            existing.sources.push('keywords');
                        }
                        else {
                            resultsMap.set(item.id, {
                                item: itemData,
                                score: score * 0.3,
                                sources: ['keywords'],
                            });
                        }
                    }
                }
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
                    const textResults = await prisma_1.prisma.$queryRawUnsafe(textQuery, ...params, ...textParams);
                    for (const item of textResults) {
                        const nameMatches = searchTerms.filter((term) => item.name.toLowerCase().includes(term) ||
                            item.description.toLowerCase().includes(term) ||
                            (item.searchDoc && item.searchDoc.toLowerCase().includes(term))).length;
                        const score = Math.min(1, nameMatches / searchTerms.length);
                        const existing = resultsMap.get(item.id);
                        if (existing) {
                            existing.score += score * 0.3;
                            existing.sources.push('text');
                        }
                        else {
                            resultsMap.set(item.id, {
                                item,
                                score: score * 0.3,
                                sources: ['text'],
                            });
                        }
                    }
                }
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
            }
            catch (err) {
                logger_1.logger.error({ userId, query, filters, err: err?.message }, 'Failed to search wardrobe');
                throw new errors_1.InternalServerError('Failed to search wardrobe', {
                    cause: err,
                });
            }
        },
    });
}
function fetchColorAnalysis(userId) {
    const fetchColorAnalysisSchema = zod_1.z
        .object({})
        .strict()
        .describe('No parameters. Must be called with {}.');
    return new ai_1.Tool({
        name: 'fetchColorAnalysis',
        description: "Retrieves the user's most recent color analysis results. Includes their recommended color palette, skin undertone, colors to wear, and colors to avoid. Use for personalized style advice.",
        schema: fetchColorAnalysisSchema,
        func: async () => {
            try {
                const result = await prisma_1.prisma.colorAnalysis.findFirst({
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
                logger_1.logger.debug({ userId, result }, 'Raw fetchColorAnalysis result');
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
            }
            catch (err) {
                logger_1.logger.error({ userId, err: err?.message }, 'Failed to fetch color analysis');
                throw new errors_1.InternalServerError('Failed to fetch color analysis', {
                    cause: err,
                });
            }
        },
    });
}
function fetchRelevantMemories(userId) {
    const fetchRelevantMemoriesSchema = zod_1.z.object({
        query: zod_1.z
            .string()
            .describe('A natural language query describing what you want to know about the user. Examples: "user size preferences", "favorite colors", "style preferences", "budget constraints", "fabric dislikes", "occasion needs", or "fit preferences".'),
        limit: zod_1.z.number().default(5).describe('Maximum number of relevant memories to return'),
    });
    return new ai_1.Tool({
        name: 'fetchRelevantMemories',
        description: "Searches the user's fashion memories to find relevant personal information for styling advice. Retrieves stored facts about their sizes, style preferences, color likes/dislikes, budget constraints, fabric sensitivities, occasion needs, fit preferences, and other styling-relevant details. Essential for providing personalized recommendations.",
        schema: fetchRelevantMemoriesSchema,
        func: async ({ query, limit }) => {
            if (query.trim() === '') {
                throw new errors_1.BadRequestError('Query is required');
            }
            try {
                const embeddingCount = await prisma_1.prisma.$queryRawUnsafe('SELECT COUNT(*) as count FROM "Memory" WHERE "userId" = $1 AND "embedding" IS NOT NULL', userId);
                if (Number(embeddingCount[0].count) === 0) {
                    return "No memories found for this user. The user hasn't shared any personal preferences or information yet.";
                }
                const model = new ai_1.OpenAIEmbeddings({ model: 'text-embedding-3-small' });
                const embeddedQuery = await model.embedQuery(query);
                const vector = JSON.stringify(embeddedQuery);
                const memories = await prisma_1.prisma.$queryRawUnsafe('SELECT id, memory, "createdAt", (1 - ("embedding" <=> $1::vector)) as similarity FROM "Memory" WHERE "embedding" IS NOT NULL AND "userId" = $2 ORDER BY "embedding" <=> $1::vector LIMIT $3', vector, userId, limit);
                if (memories.length === 0) {
                    return 'No relevant memories found for this query.';
                }
                const formattedMemories = memories.map(({ memory, createdAt, similarity }) => ({
                    memory,
                    relevance: similarity > 0.8 ? 'high' : similarity > 0.6 ? 'medium' : 'low',
                    createdAt: createdAt.toISOString().split('T')[0],
                }));
                return formattedMemories;
            }
            catch (err) {
                logger_1.logger.error({ userId, query, limit, err: err?.message }, 'Failed to fetch relevant memories');
                throw new errors_1.InternalServerError('Failed to fetch relevant memories', {
                    cause: err,
                });
            }
        },
    });
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC90b29scy50cyIsInNvdXJjZXMiOlsiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC90b29scy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQWlDQSx3Q0F3TkM7QUFNRCxnREFnREM7QUFNRCxzREFnRUM7QUFyWEQsMkNBQW9FO0FBQ3BFLDZCQUF3QjtBQUV4QixrQ0FBbUQ7QUFFbkQsMENBQXVDO0FBQ3ZDLDRDQUF1RTtBQUN2RSw0Q0FBeUM7QUEwQnpDLFNBQWdCLGNBQWMsQ0FBQyxNQUFjO0lBQzNDLE1BQU0sb0JBQW9CLEdBQUcsT0FBQyxDQUFDLE1BQU0sQ0FBQztRQUNwQyxLQUFLLEVBQUUsT0FBQzthQUNMLE1BQU0sRUFBRTthQUNSLFFBQVEsQ0FDUCxxTEFBcUwsQ0FDdEw7UUFDSCxPQUFPLEVBQUUsT0FBQzthQUNQLE1BQU0sQ0FBQztZQUNOLFFBQVEsRUFBRSxPQUFDLENBQUMsSUFBSSxDQUFDLDZCQUFvQixDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLDZCQUE2QixDQUFDO1lBQ3pGLElBQUksRUFBRSxPQUFDO2lCQUNKLE1BQU0sRUFBRTtpQkFDUixRQUFRLEVBQUU7aUJBQ1YsUUFBUSxDQUFDLHdEQUF3RCxDQUFDO1lBQ3JFLEtBQUssRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxDQUFDLG1EQUFtRCxDQUFDO1lBQzFGLFFBQVEsRUFBRSxPQUFDLENBQUMsS0FBSyxDQUFDLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsQ0FBQyxxQ0FBcUMsQ0FBQztTQUN6RixDQUFDO2FBQ0QsUUFBUSxFQUFFO2FBQ1YsUUFBUSxDQUFDLGdEQUFnRCxDQUFDO1FBQzdELEtBQUssRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxxQ0FBcUMsQ0FBQztLQUM5RSxDQUFDLENBQUM7SUFFSCxPQUFPLElBQUksU0FBSSxDQUFDO1FBQ2QsSUFBSSxFQUFFLGdCQUFnQjtRQUN0QixXQUFXLEVBQ1Qsc1RBQXNUO1FBQ3hULE1BQU0sRUFBRSxvQkFBb0I7UUFDNUIsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUF3QyxFQUFFLEVBQUU7WUFDOUUsSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUM7Z0JBQ3hCLE1BQU0sSUFBSSx3QkFBZSxDQUFDLDBCQUEwQixDQUFDLENBQUM7WUFDeEQsQ0FBQztZQUVELElBQUksQ0FBQztnQkFDSCxNQUFNLEtBQUssR0FBRyxJQUFJLHFCQUFnQixDQUFDO29CQUNqQyxLQUFLLEVBQUUsd0JBQXdCO2lCQUNoQyxDQUFDLENBQUM7Z0JBRUgsTUFBTSxjQUFjLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQztnQkFDekMsTUFBTSxNQUFNLEdBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQztnQkFFbEMsSUFBSSxPQUFPLEVBQUUsUUFBUSxFQUFFLENBQUM7b0JBQ3RCLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDO29CQUM5QixjQUFjLENBQUMsSUFBSSxDQUFDLHVCQUF1QixNQUFNLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztnQkFDOUQsQ0FBQztnQkFFRCxJQUFJLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQztvQkFDbEIsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUM7b0JBQ3hDLGNBQWMsQ0FBQyxJQUFJLENBQUMsb0JBQW9CLE1BQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO2dCQUMzRCxDQUFDO2dCQUVELElBQUksT0FBTyxFQUFFLEtBQUssRUFBRSxDQUFDO29CQUNuQixNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztvQkFDekMsY0FBYyxDQUFDLElBQUksQ0FDakIsMEJBQTBCLE1BQU0sQ0FBQyxNQUFNLGtDQUFrQyxNQUFNLENBQUMsTUFBTSxHQUFHLENBQzFGLENBQUM7Z0JBQ0osQ0FBQztnQkFFRCxNQUFNLFNBQVMsR0FBRyxjQUFjLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO2dCQUMvQyxNQUFNLFVBQVUsR0FBRyxJQUFJLEdBQUcsRUFHdkIsQ0FBQztnQkFHSixNQUFNLGNBQWMsR0FBRyxNQUFNLGVBQU0sQ0FBQyxlQUFlLENBQ2pELDhGQUE4RixFQUM5RixNQUFNLENBQ1AsQ0FBQztnQkFDRixNQUFNLGNBQWMsR0FBRyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ3pDLElBQUksY0FBYyxJQUFJLE1BQU0sQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQ3ZELE1BQU0sUUFBUSxHQUFHLE1BQU0sS0FBSyxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQztvQkFDL0MsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQztvQkFFeEMsSUFBSSxhQUFhLEdBQUc7O3VDQUVTLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQzs7Z0RBRVIsU0FBUzt3Q0FDakIsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDO29CQUNyQyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssR0FBRyxDQUFDLEVBQUUsRUFBRSxDQUFDO1dBQ2hDLENBQUM7b0JBRUYsTUFBTSxlQUFlLEdBQUcsTUFBTSxlQUFNLENBQUMsZUFBZSxDQUNsRCxhQUFhLEVBQ2IsR0FBRyxNQUFNLEVBQ1QsTUFBTSxDQUNQLENBQUM7b0JBRUYsS0FBSyxNQUFNLElBQUksSUFBSSxlQUFlLEVBQUUsQ0FBQzt3QkFDbkMsTUFBTSxFQUFFLFFBQVEsRUFBRSxHQUFHLFFBQVEsRUFBRSxHQUFHLElBQUksQ0FBQzt3QkFDdkMsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLFFBQVEsQ0FBQyxDQUFDO3dCQUN4QyxVQUFVLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUU7NEJBQ3RCLElBQUksRUFBRSxRQUFROzRCQUNkLEtBQUssRUFBRSxLQUFLLEdBQUcsR0FBRzs0QkFDbEIsT0FBTyxFQUFFLENBQUMsVUFBVSxDQUFDO3lCQUN0QixDQUFDLENBQUM7b0JBQ0wsQ0FBQztnQkFDSCxDQUFDO2dCQUdELElBQUksT0FBTyxFQUFFLFFBQVEsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztvQkFDckQsTUFBTSxZQUFZLEdBQUc7OzhDQUVlLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQzs7b0JBRTNDLFNBQVMscUJBQXFCLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQztnREFDbkIsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDO29CQUM3QyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssR0FBRyxDQUFDLEVBQUUsRUFBRSxDQUFDO1dBQ2hDLENBQUM7b0JBRUYsTUFBTSxjQUFjLEdBQUcsTUFBTSxlQUFNLENBQUMsZUFBZSxDQUNqRCxZQUFZLEVBQ1osR0FBRyxNQUFNLEVBQ1QsT0FBTyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUM3QyxDQUFDO29CQUVGLEtBQUssTUFBTSxJQUFJLElBQUksY0FBYyxFQUFFLENBQUM7d0JBQ2xDLE1BQU0sRUFBRSxlQUFlLEVBQUUsR0FBRyxRQUFRLEVBQUUsR0FBRyxJQUFJLENBQUM7d0JBQzlDLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQ3BCLENBQUMsRUFDRCxDQUFDLGVBQWUsSUFBSSxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQyxDQUM5RCxDQUFDO3dCQUVGLE1BQU0sUUFBUSxHQUFHLFVBQVUsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO3dCQUN6QyxJQUFJLFFBQVEsRUFBRSxDQUFDOzRCQUNiLFFBQVEsQ0FBQyxLQUFLLElBQUksS0FBSyxHQUFHLEdBQUcsQ0FBQzs0QkFDOUIsUUFBUSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7d0JBQ3BDLENBQUM7NkJBQU0sQ0FBQzs0QkFDTixVQUFVLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUU7Z0NBQ3RCLElBQUksRUFBRSxRQUFRO2dDQUNkLEtBQUssRUFBRSxLQUFLLEdBQUcsR0FBRztnQ0FDbEIsT0FBTyxFQUFFLENBQUMsVUFBVSxDQUFDOzZCQUN0QixDQUFDLENBQUM7d0JBQ0wsQ0FBQztvQkFDSCxDQUFDO2dCQUNILENBQUM7Z0JBR0QsTUFBTSxXQUFXLEdBQUcsS0FBSztxQkFDdEIsV0FBVyxFQUFFO3FCQUNiLEtBQUssQ0FBQyxLQUFLLENBQUM7cUJBQ1osTUFBTSxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDO2dCQUNyQyxJQUFJLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQzNCLE1BQU0sU0FBUyxHQUFHOzs7b0JBR1IsU0FBUztnQkFDYixXQUFXLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsc0JBQXNCLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxHQUFHLENBQUMsZ0NBQWdDLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxHQUFHLENBQUMsZ0NBQWdDLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQzs7b0JBRTVMLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxHQUFHLENBQUMsRUFBRSxFQUFFLENBQUM7V0FDaEMsQ0FBQztvQkFFRixNQUFNLFVBQVUsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxJQUFJLElBQUksR0FBRyxDQUFDLENBQUM7b0JBQzFELE1BQU0sV0FBVyxHQUFHLE1BQU0sZUFBTSxDQUFDLGVBQWUsQ0FDOUMsU0FBUyxFQUNULEdBQUcsTUFBTSxFQUNULEdBQUcsVUFBVSxDQUNkLENBQUM7b0JBRUYsS0FBSyxNQUFNLElBQUksSUFBSSxXQUFXLEVBQUUsQ0FBQzt3QkFDL0IsTUFBTSxXQUFXLEdBQUcsV0FBVyxDQUFDLE1BQU0sQ0FDcEMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUNQLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQzs0QkFDdEMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDOzRCQUM3QyxDQUFDLElBQUksQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FDbEUsQ0FBQyxNQUFNLENBQUM7d0JBRVQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsV0FBVyxHQUFHLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQzt3QkFFNUQsTUFBTSxRQUFRLEdBQUcsVUFBVSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7d0JBQ3pDLElBQUksUUFBUSxFQUFFLENBQUM7NEJBQ2IsUUFBUSxDQUFDLEtBQUssSUFBSSxLQUFLLEdBQUcsR0FBRyxDQUFDOzRCQUM5QixRQUFRLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQzt3QkFDaEMsQ0FBQzs2QkFBTSxDQUFDOzRCQUNOLFVBQVUsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRTtnQ0FDdEIsSUFBSTtnQ0FDSixLQUFLLEVBQUUsS0FBSyxHQUFHLEdBQUc7Z0NBQ2xCLE9BQU8sRUFBRSxDQUFDLE1BQU0sQ0FBQzs2QkFDbEIsQ0FBQyxDQUFDO3dCQUNMLENBQUM7b0JBQ0gsQ0FBQztnQkFDSCxDQUFDO2dCQUdELE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxDQUFDO3FCQUNsRCxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUM7cUJBQ2pDLEtBQUssQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDO3FCQUNmLEdBQUcsQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsQ0FBQztvQkFDaEIsRUFBRSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRTtvQkFDbEIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSTtvQkFDdEIsV0FBVyxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVztvQkFDcEMsUUFBUSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUTtvQkFDOUIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSTtvQkFDdEIsT0FBTyxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTztvQkFDNUIsU0FBUyxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUztvQkFDaEMsY0FBYyxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsY0FBYztvQkFDMUMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVTtvQkFDbEMsUUFBUSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUTtpQkFDL0IsQ0FBQyxDQUFDLENBQUM7Z0JBRU4sSUFBSSxhQUFhLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO29CQUMvQixPQUFPLHNEQUFzRCxDQUFDO2dCQUNoRSxDQUFDO2dCQUVELE9BQU8sYUFBYSxDQUFDO1lBQ3ZCLENBQUM7WUFBQyxPQUFPLEdBQVksRUFBRSxDQUFDO2dCQUN0QixlQUFNLENBQUMsS0FBSyxDQUNWLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsR0FBRyxFQUFHLEdBQWEsRUFBRSxPQUFPLEVBQUUsRUFDeEQsMkJBQTJCLENBQzVCLENBQUM7Z0JBQ0YsTUFBTSxJQUFJLDRCQUFtQixDQUFDLDJCQUEyQixFQUFFO29CQUN6RCxLQUFLLEVBQUUsR0FBRztpQkFDWCxDQUFDLENBQUM7WUFDTCxDQUFDO1FBQ0gsQ0FBQztLQUNGLENBQUMsQ0FBQztBQUNMLENBQUM7QUFNRCxTQUFnQixrQkFBa0IsQ0FBQyxNQUFjO0lBQy9DLE1BQU0sd0JBQXdCLEdBQUcsT0FBQztTQUMvQixNQUFNLENBQUMsRUFBRSxDQUFDO1NBQ1YsTUFBTSxFQUFFO1NBQ1IsUUFBUSxDQUFDLHdDQUF3QyxDQUFDLENBQUM7SUFFdEQsT0FBTyxJQUFJLFNBQUksQ0FBQztRQUNkLElBQUksRUFBRSxvQkFBb0I7UUFDMUIsV0FBVyxFQUNULDRMQUE0TDtRQUM5TCxNQUFNLEVBQUUsd0JBQXdCO1FBQ2hDLElBQUksRUFBRSxLQUFLLElBQUksRUFBRTtZQUNmLElBQUksQ0FBQztnQkFDSCxNQUFNLE1BQU0sR0FBRyxNQUFNLGVBQU0sQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDO29CQUNsRCxNQUFNLEVBQUU7d0JBQ04sWUFBWSxFQUFFLElBQUk7d0JBQ2xCLG1CQUFtQixFQUFFLElBQUk7d0JBQ3pCLFVBQVUsRUFBRSxJQUFJO3dCQUNoQixhQUFhLEVBQUUsSUFBSTt3QkFDbkIsY0FBYyxFQUFFLElBQUk7d0JBQ3BCLGVBQWUsRUFBRSxJQUFJO3FCQUN0QjtvQkFDRCxLQUFLLEVBQUUsRUFBRSxNQUFNLEVBQUU7b0JBQ2pCLE9BQU8sRUFBRSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUU7aUJBQy9CLENBQUMsQ0FBQztnQkFDSCxlQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxFQUFFLCtCQUErQixDQUFDLENBQUM7Z0JBQ2xFLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztvQkFDWixPQUFPLHVDQUF1QyxDQUFDO2dCQUNqRCxDQUFDO2dCQUNELE1BQU0sQ0FBQyxhQUFhLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDdkYsTUFBTSxDQUFDLGNBQWM7b0JBQ25CLE9BQU8sTUFBTSxDQUFDLGNBQWMsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLGNBQWMsS0FBSyxJQUFJO3dCQUN6RSxDQUFDLENBQUMsTUFBTSxDQUFDLGNBQWM7d0JBQ3ZCLENBQUMsQ0FBQyxFQUFFLFFBQVEsRUFBRSxFQUFFLEVBQUUsT0FBTyxFQUFFLEVBQUUsRUFBRSxDQUFDO2dCQUNwQyxNQUFNLENBQUMsZUFBZSxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLGVBQWUsQ0FBQztvQkFDNUQsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxlQUFlO29CQUN4QixDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUNQLE1BQU0sQ0FBQyxZQUFZLEdBQUcsTUFBTSxDQUFDLFlBQVksSUFBSSxJQUFJLENBQUM7Z0JBQ2xELE1BQU0sQ0FBQyxtQkFBbUIsR0FBRyxNQUFNLENBQUMsbUJBQW1CLElBQUksSUFBSSxDQUFDO2dCQUNoRSxPQUFPLE1BQU0sQ0FBQztZQUNoQixDQUFDO1lBQUMsT0FBTyxHQUFZLEVBQUUsQ0FBQztnQkFDdEIsZUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUcsR0FBYSxFQUFFLE9BQU8sRUFBRSxFQUFFLGdDQUFnQyxDQUFDLENBQUM7Z0JBQ3pGLE1BQU0sSUFBSSw0QkFBbUIsQ0FBQyxnQ0FBZ0MsRUFBRTtvQkFDOUQsS0FBSyxFQUFFLEdBQUc7aUJBQ1gsQ0FBQyxDQUFDO1lBQ0wsQ0FBQztRQUNILENBQUM7S0FDRixDQUFDLENBQUM7QUFDTCxDQUFDO0FBTUQsU0FBZ0IscUJBQXFCLENBQUMsTUFBYztJQUNsRCxNQUFNLDJCQUEyQixHQUFHLE9BQUMsQ0FBQyxNQUFNLENBQUM7UUFDM0MsS0FBSyxFQUFFLE9BQUM7YUFDTCxNQUFNLEVBQUU7YUFDUixRQUFRLENBQ1AsdU9BQXVPLENBQ3hPO1FBQ0gsS0FBSyxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLCtDQUErQyxDQUFDO0tBQ3ZGLENBQUMsQ0FBQztJQUVILE9BQU8sSUFBSSxTQUFJLENBQUM7UUFDZCxJQUFJLEVBQUUsdUJBQXVCO1FBQzdCLFdBQVcsRUFDVCx3VkFBd1Y7UUFDMVYsTUFBTSxFQUFFLDJCQUEyQjtRQUNuQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBK0MsRUFBRSxFQUFFO1lBQzVFLElBQUksS0FBSyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDO2dCQUN4QixNQUFNLElBQUksd0JBQWUsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO1lBQ2pELENBQUM7WUFFRCxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxjQUFjLEdBQUcsTUFBTSxlQUFNLENBQUMsZUFBZSxDQUNqRCx3RkFBd0YsRUFDeEYsTUFBTSxDQUNQLENBQUM7Z0JBRUYsSUFBSSxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO29CQUMxQyxPQUFPLHNHQUFzRyxDQUFDO2dCQUNoSCxDQUFDO2dCQUVELE1BQU0sS0FBSyxHQUFHLElBQUkscUJBQWdCLENBQUMsRUFBRSxLQUFLLEVBQUUsd0JBQXdCLEVBQUUsQ0FBQyxDQUFDO2dCQUN4RSxNQUFNLGFBQWEsR0FBRyxNQUFNLEtBQUssQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQ3BELE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsYUFBYSxDQUFDLENBQUM7Z0JBRTdDLE1BQU0sUUFBUSxHQUNaLE1BQU0sZUFBTSxDQUFDLGVBQWUsQ0FDMUIsNkxBQTZMLEVBQzdMLE1BQU0sRUFDTixNQUFNLEVBQ04sS0FBSyxDQUNOLENBQUM7Z0JBRUosSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO29CQUMxQixPQUFPLDRDQUE0QyxDQUFDO2dCQUN0RCxDQUFDO2dCQUVELE1BQU0saUJBQWlCLEdBQUcsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRSxVQUFVLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztvQkFDN0UsTUFBTTtvQkFDTixTQUFTLEVBQUUsVUFBVSxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxVQUFVLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLEtBQUs7b0JBQzFFLFNBQVMsRUFBRSxTQUFTLENBQUMsV0FBVyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztpQkFDakQsQ0FBQyxDQUFDLENBQUM7Z0JBRUosT0FBTyxpQkFBaUIsQ0FBQztZQUMzQixDQUFDO1lBQUMsT0FBTyxHQUFZLEVBQUUsQ0FBQztnQkFDdEIsZUFBTSxDQUFDLEtBQUssQ0FDVixFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEdBQUcsRUFBRyxHQUFhLEVBQUUsT0FBTyxFQUFFLEVBQ3RELG1DQUFtQyxDQUNwQyxDQUFDO2dCQUNGLE1BQU0sSUFBSSw0QkFBbUIsQ0FBQyxtQ0FBbUMsRUFBRTtvQkFDakUsS0FBSyxFQUFFLEdBQUc7aUJBQ1gsQ0FBQyxDQUFDO1lBQ0wsQ0FBQztRQUNILENBQUM7S0FDRixDQUFDLENBQUM7QUFDTCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgV2FyZHJvYmVJdGVtLCBXYXJkcm9iZUl0ZW1DYXRlZ29yeSB9IGZyb20gJ0BwcmlzbWEvY2xpZW50JztcbmltcG9ydCB7IHogfSBmcm9tICd6b2QnO1xuXG5pbXBvcnQgeyBPcGVuQUlFbWJlZGRpbmdzLCBUb29sIH0gZnJvbSAnLi4vbGliL2FpJztcblxuaW1wb3J0IHsgcHJpc21hIH0gZnJvbSAnLi4vbGliL3ByaXNtYSc7XG5pbXBvcnQgeyBCYWRSZXF1ZXN0RXJyb3IsIEludGVybmFsU2VydmVyRXJyb3IgfSBmcm9tICcuLi91dGlscy9lcnJvcnMnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vdXRpbHMvbG9nZ2VyJztcblxudHlwZSBXYXJkcm9iZVJvdyA9IFBpY2s8XG4gIFdhcmRyb2JlSXRlbSxcbiAgfCAnaWQnXG4gIHwgJ25hbWUnXG4gIHwgJ2Rlc2NyaXB0aW9uJ1xuICB8ICdjYXRlZ29yeSdcbiAgfCAndHlwZSdcbiAgfCAnc3VidHlwZSdcbiAgfCAnbWFpbkNvbG9yJ1xuICB8ICdzZWNvbmRhcnlDb2xvcidcbiAgfCAnYXR0cmlidXRlcydcbiAgfCAna2V5d29yZHMnXG4gIHwgJ3NlYXJjaERvYydcbj47XG5cbnR5cGUgU2VtYW50aWNSZXN1bHRSb3cgPSBXYXJkcm9iZVJvdyAmIHsgZGlzdGFuY2U6IG51bWJlciB9O1xudHlwZSBLZXl3b3JkUmVzdWx0Um93ID0gV2FyZHJvYmVSb3cgJiB7IGtleXdvcmRfbWF0Y2hlczogbnVtYmVyIHwgbnVsbCB9O1xudHlwZSBUZXh0UmVzdWx0Um93ID0gV2FyZHJvYmVSb3c7XG5cbi8qKlxuICogRHluYW1pYyB0b29sIGZvciBzZWFyY2hpbmcgdXNlciB3YXJkcm9iZSB1c2luZyBoeWJyaWQgc2VhcmNoIGFwcHJvYWNoLlxuICogQ29tYmluZXMgc2VtYW50aWMgc2ltaWxhcml0eSwga2V5d29yZCBtYXRjaGluZywgYW5kIHRleHQgc2VhcmNoIHdpdGggb3B0aW9uYWwgZmlsdGVycy5cbiAqIE9wdGltaXplZCBmb3IgTExNIHN0eWxpbmcgc3VnZ2VzdGlvbnMgYW5kIG91dGZpdCByZWNvbW1lbmRhdGlvbnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZWFyY2hXYXJkcm9iZSh1c2VySWQ6IHN0cmluZyk6IFRvb2wge1xuICBjb25zdCBzZWFyY2hXYXJkcm9iZVNjaGVtYSA9IHoub2JqZWN0KHtcbiAgICBxdWVyeTogelxuICAgICAgLnN0cmluZygpXG4gICAgICAuZGVzY3JpYmUoXG4gICAgICAgIFwiQSBuYXR1cmFsIGxhbmd1YWdlIGRlc2NyaXB0aW9uIG9mIHRoZSBjbG90aGluZyBpdGVtKHMpIHlvdSdyZSBsb29raW5nIGZvci4gQmUgc3BlY2lmaWMgYWJvdXQgc3R5bGUsIG9jY2FzaW9uLCBjb2xvciwgb3IgdHlwZSAoZS5nLiwgJ25hdnkgY2hpbm9zIGZvciB3b3JrJywgJ2Nhc3VhbCBzdW1tZXIgZHJlc3MnKS5cIixcbiAgICAgICksXG4gICAgZmlsdGVyczogelxuICAgICAgLm9iamVjdCh7XG4gICAgICAgIGNhdGVnb3J5OiB6LmVudW0oV2FyZHJvYmVJdGVtQ2F0ZWdvcnkpLm9wdGlvbmFsKCkuZGVzY3JpYmUoJ0ZpbHRlciBieSBjbG90aGluZyBjYXRlZ29yeScpLFxuICAgICAgICB0eXBlOiB6XG4gICAgICAgICAgLnN0cmluZygpXG4gICAgICAgICAgLm9wdGlvbmFsKClcbiAgICAgICAgICAuZGVzY3JpYmUoXCJGaWx0ZXIgYnkgc3BlY2lmaWMgaXRlbSB0eXBlIChlLmcuLCAnamVhbnMnLCAnYmxvdXNlJylcIiksXG4gICAgICAgIGNvbG9yOiB6LnN0cmluZygpLm9wdGlvbmFsKCkuZGVzY3JpYmUoJ0ZpbHRlciBieSBjb2xvciAobWF0Y2hlcyBtYWluIG9yIHNlY29uZGFyeSBjb2xvciknKSxcbiAgICAgICAga2V5d29yZHM6IHouYXJyYXkoei5zdHJpbmcoKSkub3B0aW9uYWwoKS5kZXNjcmliZSgnRmlsdGVyIGJ5IHNwZWNpZmljIGtleXdvcmRzIG9yIHRhZ3MnKSxcbiAgICAgIH0pXG4gICAgICAub3B0aW9uYWwoKVxuICAgICAgLmRlc2NyaWJlKCdPcHRpb25hbCBmaWx0ZXJzIHRvIG5hcnJvdyBkb3duIHNlYXJjaCByZXN1bHRzJyksXG4gICAgbGltaXQ6IHoubnVtYmVyKCkuZGVmYXVsdCgyMCkuZGVzY3JpYmUoJ01heGltdW0gbnVtYmVyIG9mIHJlc3VsdHMgdG8gcmV0dXJuJyksXG4gIH0pO1xuXG4gIHJldHVybiBuZXcgVG9vbCh7XG4gICAgbmFtZTogJ3NlYXJjaFdhcmRyb2JlJyxcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgIFwiU2VhcmNoZXMgdGhlIHVzZXIncyBkaWdpdGFsIHdhcmRyb2JlIHVzaW5nIGh5YnJpZCBzZWFyY2ggY29tYmluaW5nIHNlbWFudGljIHNpbWlsYXJpdHksIGtleXdvcmQgbWF0Y2hpbmcsIGFuZCBmaWx0ZXJpbmcuIElkZWFsIGZvciBmaW5kaW5nIHNwZWNpZmljIGl0ZW1zIGZvciBzdHlsaW5nIHN1Z2dlc3Rpb25zLCBvdXRmaXQgYnVpbGRpbmcsIG9yIHdhcmRyb2JlIGFuYWx5c2lzLiBSZXR1cm5zIGRldGFpbGVkIGl0ZW0gaW5mb3JtYXRpb24gaW5jbHVkaW5nIGNvbG9ycywgYXR0cmlidXRlcywgYW5kIHN0eWxlIGNoYXJhY3RlcmlzdGljcy5cIixcbiAgICBzY2hlbWE6IHNlYXJjaFdhcmRyb2JlU2NoZW1hLFxuICAgIGZ1bmM6IGFzeW5jICh7IHF1ZXJ5LCBmaWx0ZXJzLCBsaW1pdCB9OiB6LmluZmVyPHR5cGVvZiBzZWFyY2hXYXJkcm9iZVNjaGVtYT4pID0+IHtcbiAgICAgIGlmIChxdWVyeS50cmltKCkgPT09ICcnKSB7XG4gICAgICAgIHRocm93IG5ldyBCYWRSZXF1ZXN0RXJyb3IoJ1NlYXJjaCBxdWVyeSBpcyByZXF1aXJlZCcpO1xuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBtb2RlbCA9IG5ldyBPcGVuQUlFbWJlZGRpbmdzKHtcbiAgICAgICAgICBtb2RlbDogJ3RleHQtZW1iZWRkaW5nLTMtc21hbGwnLFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBiYXNlQ29uZGl0aW9ucyA9IFtgXCJ1c2VySWRcIiA9ICQxYF07XG4gICAgICAgIGNvbnN0IHBhcmFtczogc3RyaW5nW10gPSBbdXNlcklkXTtcblxuICAgICAgICBpZiAoZmlsdGVycz8uY2F0ZWdvcnkpIHtcbiAgICAgICAgICBwYXJhbXMucHVzaChmaWx0ZXJzLmNhdGVnb3J5KTtcbiAgICAgICAgICBiYXNlQ29uZGl0aW9ucy5wdXNoKGBcImNhdGVnb3J5XCI6OnRleHQgPSAkJHtwYXJhbXMubGVuZ3RofWApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGZpbHRlcnM/LnR5cGUpIHtcbiAgICAgICAgICBwYXJhbXMucHVzaChmaWx0ZXJzLnR5cGUudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgICAgYmFzZUNvbmRpdGlvbnMucHVzaChgTE9XRVIoXCJ0eXBlXCIpID0gJCR7cGFyYW1zLmxlbmd0aH1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChmaWx0ZXJzPy5jb2xvcikge1xuICAgICAgICAgIHBhcmFtcy5wdXNoKGZpbHRlcnMuY29sb3IudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgICAgYmFzZUNvbmRpdGlvbnMucHVzaChcbiAgICAgICAgICAgIGAoTE9XRVIoXCJtYWluQ29sb3JcIikgPSAkJHtwYXJhbXMubGVuZ3RofSBPUiBMT1dFUihcInNlY29uZGFyeUNvbG9yXCIpID0gJCR7cGFyYW1zLmxlbmd0aH0pYCxcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYmFzZVdoZXJlID0gYmFzZUNvbmRpdGlvbnMuam9pbignIEFORCAnKTtcbiAgICAgICAgY29uc3QgcmVzdWx0c01hcCA9IG5ldyBNYXA8XG4gICAgICAgICAgc3RyaW5nLFxuICAgICAgICAgIHsgaXRlbTogV2FyZHJvYmVSb3c7IHNjb3JlOiBudW1iZXI7IHNvdXJjZXM6IHN0cmluZ1tdIH1cbiAgICAgICAgPigpO1xuXG4gICAgICAgIC8vIDEuIFNlbWFudGljIFNlYXJjaCAoVmVjdG9yIFNpbWlsYXJpdHkpXG4gICAgICAgIGNvbnN0IGVtYmVkZGluZ0NvdW50ID0gYXdhaXQgcHJpc21hLiRxdWVyeVJhd1Vuc2FmZTxBcnJheTx7IGNvdW50OiBiaWdpbnQgfT4+KFxuICAgICAgICAgICdTRUxFQ1QgQ09VTlQoKikgYXMgY291bnQgRlJPTSBcIldhcmRyb2JlSXRlbVwiIFdIRVJFIFwidXNlcklkXCIgPSAkMSBBTkQgXCJlbWJlZGRpbmdcIiBJUyBOT1QgTlVMTCcsXG4gICAgICAgICAgdXNlcklkLFxuICAgICAgICApO1xuICAgICAgICBjb25zdCBlbWJlZGRpbmdTdGF0cyA9IGVtYmVkZGluZ0NvdW50WzBdO1xuICAgICAgICBpZiAoZW1iZWRkaW5nU3RhdHMgJiYgTnVtYmVyKGVtYmVkZGluZ1N0YXRzLmNvdW50KSA+IDApIHtcbiAgICAgICAgICBjb25zdCBlbWJlZGRlZCA9IGF3YWl0IG1vZGVsLmVtYmVkUXVlcnkocXVlcnkpO1xuICAgICAgICAgIGNvbnN0IHZlY3RvciA9IEpTT04uc3RyaW5naWZ5KGVtYmVkZGVkKTtcblxuICAgICAgICAgIGxldCBzZW1hbnRpY1F1ZXJ5ID0gYFxuICAgICAgICAgICAgU0VMRUNUIGlkLCBuYW1lLCBkZXNjcmlwdGlvbiwgY2F0ZWdvcnksIHR5cGUsIHN1YnR5cGUsIFwibWFpbkNvbG9yXCIsIFwic2Vjb25kYXJ5Q29sb3JcIiwgYXR0cmlidXRlcywga2V5d29yZHMsIFwic2VhcmNoRG9jXCIsXG4gICAgICAgICAgICAgICAgICAgKFwiZW1iZWRkaW5nXCIgPD0+ICQke3BhcmFtcy5sZW5ndGggKyAxfTo6dmVjdG9yKSBhcyBkaXN0YW5jZVxuICAgICAgICAgICAgRlJPTSBcIldhcmRyb2JlSXRlbVwiXG4gICAgICAgICAgICBXSEVSRSBcImVtYmVkZGluZ1wiIElTIE5PVCBOVUxMIEFORCAke2Jhc2VXaGVyZX1cbiAgICAgICAgICAgIE9SREVSIEJZIFwiZW1iZWRkaW5nXCIgPD0+ICQke3BhcmFtcy5sZW5ndGggKyAxfTo6dmVjdG9yXG4gICAgICAgICAgICBMSU1JVCAke01hdGgubWluKGxpbWl0ICogMiwgNDApfVxuICAgICAgICAgIGA7XG5cbiAgICAgICAgICBjb25zdCBzZW1hbnRpY1Jlc3VsdHMgPSBhd2FpdCBwcmlzbWEuJHF1ZXJ5UmF3VW5zYWZlPFNlbWFudGljUmVzdWx0Um93W10+KFxuICAgICAgICAgICAgc2VtYW50aWNRdWVyeSxcbiAgICAgICAgICAgIC4uLnBhcmFtcyxcbiAgICAgICAgICAgIHZlY3RvcixcbiAgICAgICAgICApO1xuXG4gICAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIHNlbWFudGljUmVzdWx0cykge1xuICAgICAgICAgICAgY29uc3QgeyBkaXN0YW5jZSwgLi4uaXRlbURhdGEgfSA9IGl0ZW07XG4gICAgICAgICAgICBjb25zdCBzY29yZSA9IE1hdGgubWF4KDAsIDEgLSBkaXN0YW5jZSk7XG4gICAgICAgICAgICByZXN1bHRzTWFwLnNldChpdGVtLmlkLCB7XG4gICAgICAgICAgICAgIGl0ZW06IGl0ZW1EYXRhLFxuICAgICAgICAgICAgICBzY29yZTogc2NvcmUgKiAwLjYsIC8vIFdlaWdodCBzZW1hbnRpYyBzZWFyY2ggYXQgNjAlXG4gICAgICAgICAgICAgIHNvdXJjZXM6IFsnc2VtYW50aWMnXSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIDIuIEtleXdvcmQgU2VhcmNoIChBcnJheSBvdmVybGFwIGFuZCB0ZXh0IHNlYXJjaClcbiAgICAgICAgaWYgKGZpbHRlcnM/LmtleXdvcmRzICYmIGZpbHRlcnMua2V5d29yZHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IGtleXdvcmRRdWVyeSA9IGBcbiAgICAgICAgICAgIFNFTEVDVCBpZCwgbmFtZSwgZGVzY3JpcHRpb24sIGNhdGVnb3J5LCB0eXBlLCBzdWJ0eXBlLCBcIm1haW5Db2xvclwiLCBcInNlY29uZGFyeUNvbG9yXCIsIGF0dHJpYnV0ZXMsIGtleXdvcmRzLCBcInNlYXJjaERvY1wiLFxuICAgICAgICAgICAgICAgICAgIGFycmF5X2xlbmd0aChrZXl3b3JkcyAmICQke3BhcmFtcy5sZW5ndGggKyAxfSwgMSkgYXMga2V5d29yZF9tYXRjaGVzXG4gICAgICAgICAgICBGUk9NIFwiV2FyZHJvYmVJdGVtXCJcbiAgICAgICAgICAgIFdIRVJFICR7YmFzZVdoZXJlfSBBTkQga2V5d29yZHMgJiYgJCR7cGFyYW1zLmxlbmd0aCArIDF9XG4gICAgICAgICAgICBPUkRFUiBCWSBhcnJheV9sZW5ndGgoa2V5d29yZHMgJiAkJHtwYXJhbXMubGVuZ3RoICsgMX0sIDEpIERFU0NcbiAgICAgICAgICAgIExJTUlUICR7TWF0aC5taW4obGltaXQgKiAyLCA0MCl9XG4gICAgICAgICAgYDtcblxuICAgICAgICAgIGNvbnN0IGtleXdvcmRSZXN1bHRzID0gYXdhaXQgcHJpc21hLiRxdWVyeVJhd1Vuc2FmZTxLZXl3b3JkUmVzdWx0Um93W10+KFxuICAgICAgICAgICAga2V5d29yZFF1ZXJ5LFxuICAgICAgICAgICAgLi4ucGFyYW1zLFxuICAgICAgICAgICAgZmlsdGVycy5rZXl3b3Jkcy5tYXAoKGspID0+IGsudG9Mb3dlckNhc2UoKSksXG4gICAgICAgICAgKTtcblxuICAgICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBrZXl3b3JkUmVzdWx0cykge1xuICAgICAgICAgICAgY29uc3QgeyBrZXl3b3JkX21hdGNoZXMsIC4uLml0ZW1EYXRhIH0gPSBpdGVtO1xuICAgICAgICAgICAgY29uc3Qgc2NvcmUgPSBNYXRoLm1pbihcbiAgICAgICAgICAgICAgMSxcbiAgICAgICAgICAgICAgKGtleXdvcmRfbWF0Y2hlcyB8fCAwKSAvIE1hdGgubWF4KGZpbHRlcnMua2V5d29yZHMubGVuZ3RoLCAxKSxcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nID0gcmVzdWx0c01hcC5nZXQoaXRlbS5pZCk7XG4gICAgICAgICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgICAgICAgZXhpc3Rpbmcuc2NvcmUgKz0gc2NvcmUgKiAwLjM7XG4gICAgICAgICAgICAgIGV4aXN0aW5nLnNvdXJjZXMucHVzaCgna2V5d29yZHMnKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHJlc3VsdHNNYXAuc2V0KGl0ZW0uaWQsIHtcbiAgICAgICAgICAgICAgICBpdGVtOiBpdGVtRGF0YSxcbiAgICAgICAgICAgICAgICBzY29yZTogc2NvcmUgKiAwLjMsXG4gICAgICAgICAgICAgICAgc291cmNlczogWydrZXl3b3JkcyddLFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyAzLiBUZXh0IFNlYXJjaCAoTmFtZSBhbmQgZGVzY3JpcHRpb24pXG4gICAgICAgIGNvbnN0IHNlYXJjaFRlcm1zID0gcXVlcnlcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKVxuICAgICAgICAgIC5zcGxpdCgvXFxzKy8pXG4gICAgICAgICAgLmZpbHRlcigodGVybSkgPT4gdGVybS5sZW5ndGggPiAyKTtcbiAgICAgICAgaWYgKHNlYXJjaFRlcm1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCB0ZXh0UXVlcnkgPSBgXG4gICAgICAgICAgICBTRUxFQ1QgaWQsIG5hbWUsIGRlc2NyaXB0aW9uLCBjYXRlZ29yeSwgdHlwZSwgc3VidHlwZSwgXCJtYWluQ29sb3JcIiwgXCJzZWNvbmRhcnlDb2xvclwiLCBhdHRyaWJ1dGVzLCBrZXl3b3JkcywgXCJzZWFyY2hEb2NcIlxuICAgICAgICAgICAgRlJPTSBcIldhcmRyb2JlSXRlbVwiXG4gICAgICAgICAgICBXSEVSRSAke2Jhc2VXaGVyZX0gQU5EIChcbiAgICAgICAgICAgICAgJHtzZWFyY2hUZXJtcy5tYXAoKF8sIGkpID0+IGAoTE9XRVIobmFtZSkgTElLRSAkJHtwYXJhbXMubGVuZ3RoICsgaSArIDF9IE9SIExPV0VSKGRlc2NyaXB0aW9uKSBMSUtFICQke3BhcmFtcy5sZW5ndGggKyBpICsgMX0gT1IgTE9XRVIoXCJzZWFyY2hEb2NcIikgTElLRSAkJHtwYXJhbXMubGVuZ3RoICsgaSArIDF9KWApLmpvaW4oJyBPUiAnKX1cbiAgICAgICAgICAgIClcbiAgICAgICAgICAgIExJTUlUICR7TWF0aC5taW4obGltaXQgKiAyLCA0MCl9XG4gICAgICAgICAgYDtcblxuICAgICAgICAgIGNvbnN0IHRleHRQYXJhbXMgPSBzZWFyY2hUZXJtcy5tYXAoKHRlcm0pID0+IGAlJHt0ZXJtfSVgKTtcbiAgICAgICAgICBjb25zdCB0ZXh0UmVzdWx0cyA9IGF3YWl0IHByaXNtYS4kcXVlcnlSYXdVbnNhZmU8VGV4dFJlc3VsdFJvd1tdPihcbiAgICAgICAgICAgIHRleHRRdWVyeSxcbiAgICAgICAgICAgIC4uLnBhcmFtcyxcbiAgICAgICAgICAgIC4uLnRleHRQYXJhbXMsXG4gICAgICAgICAgKTtcblxuICAgICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiB0ZXh0UmVzdWx0cykge1xuICAgICAgICAgICAgY29uc3QgbmFtZU1hdGNoZXMgPSBzZWFyY2hUZXJtcy5maWx0ZXIoXG4gICAgICAgICAgICAgICh0ZXJtKSA9PlxuICAgICAgICAgICAgICAgIGl0ZW0ubmFtZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHRlcm0pIHx8XG4gICAgICAgICAgICAgICAgaXRlbS5kZXNjcmlwdGlvbi50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHRlcm0pIHx8XG4gICAgICAgICAgICAgICAgKGl0ZW0uc2VhcmNoRG9jICYmIGl0ZW0uc2VhcmNoRG9jLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXModGVybSkpLFxuICAgICAgICAgICAgKS5sZW5ndGg7XG5cbiAgICAgICAgICAgIGNvbnN0IHNjb3JlID0gTWF0aC5taW4oMSwgbmFtZU1hdGNoZXMgLyBzZWFyY2hUZXJtcy5sZW5ndGgpO1xuXG4gICAgICAgICAgICBjb25zdCBleGlzdGluZyA9IHJlc3VsdHNNYXAuZ2V0KGl0ZW0uaWQpO1xuICAgICAgICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgICAgICAgIGV4aXN0aW5nLnNjb3JlICs9IHNjb3JlICogMC4zO1xuICAgICAgICAgICAgICBleGlzdGluZy5zb3VyY2VzLnB1c2goJ3RleHQnKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHJlc3VsdHNNYXAuc2V0KGl0ZW0uaWQsIHtcbiAgICAgICAgICAgICAgICBpdGVtLFxuICAgICAgICAgICAgICAgIHNjb3JlOiBzY29yZSAqIDAuMyxcbiAgICAgICAgICAgICAgICBzb3VyY2VzOiBbJ3RleHQnXSxcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gU29ydCBieSBjb21iaW5lZCBzY29yZSBhbmQgcmV0dXJuIHRvcCByZXN1bHRzXG4gICAgICAgIGNvbnN0IHNvcnRlZFJlc3VsdHMgPSBBcnJheS5mcm9tKHJlc3VsdHNNYXAudmFsdWVzKCkpXG4gICAgICAgICAgLnNvcnQoKGEsIGIpID0+IGIuc2NvcmUgLSBhLnNjb3JlKVxuICAgICAgICAgIC5zbGljZSgwLCBsaW1pdClcbiAgICAgICAgICAubWFwKChyZXN1bHQpID0+ICh7XG4gICAgICAgICAgICBpZDogcmVzdWx0Lml0ZW0uaWQsXG4gICAgICAgICAgICBuYW1lOiByZXN1bHQuaXRlbS5uYW1lLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IHJlc3VsdC5pdGVtLmRlc2NyaXB0aW9uLFxuICAgICAgICAgICAgY2F0ZWdvcnk6IHJlc3VsdC5pdGVtLmNhdGVnb3J5LFxuICAgICAgICAgICAgdHlwZTogcmVzdWx0Lml0ZW0udHlwZSxcbiAgICAgICAgICAgIHN1YnR5cGU6IHJlc3VsdC5pdGVtLnN1YnR5cGUsXG4gICAgICAgICAgICBtYWluQ29sb3I6IHJlc3VsdC5pdGVtLm1haW5Db2xvcixcbiAgICAgICAgICAgIHNlY29uZGFyeUNvbG9yOiByZXN1bHQuaXRlbS5zZWNvbmRhcnlDb2xvcixcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHJlc3VsdC5pdGVtLmF0dHJpYnV0ZXMsXG4gICAgICAgICAgICBrZXl3b3JkczogcmVzdWx0Lml0ZW0ua2V5d29yZHMsXG4gICAgICAgICAgfSkpO1xuXG4gICAgICAgIGlmIChzb3J0ZWRSZXN1bHRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIHJldHVybiBcIk5vdGhpbmcgZm91bmQgaW4gdGhlIHVzZXIncyB3YXJkcm9iZSBmb3IgdGhpcyBxdWVyeS5cIjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBzb3J0ZWRSZXN1bHRzO1xuICAgICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihcbiAgICAgICAgICB7IHVzZXJJZCwgcXVlcnksIGZpbHRlcnMsIGVycjogKGVyciBhcyBFcnJvcik/Lm1lc3NhZ2UgfSxcbiAgICAgICAgICAnRmFpbGVkIHRvIHNlYXJjaCB3YXJkcm9iZScsXG4gICAgICAgICk7XG4gICAgICAgIHRocm93IG5ldyBJbnRlcm5hbFNlcnZlckVycm9yKCdGYWlsZWQgdG8gc2VhcmNoIHdhcmRyb2JlJywge1xuICAgICAgICAgIGNhdXNlOiBlcnIsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0sXG4gIH0pO1xufVxuXG4vKipcbiAqIER5bmFtaWMgdG9vbCBmb3IgcmV0cmlldmluZyB1c2VyJ3MgbGF0ZXN0IGNvbG9yIGFuYWx5c2lzIHJlc3VsdHMuXG4gKiBQcm92aWRlcyBjb2xvciBwYWxldHRlIGluZm9ybWF0aW9uLCB1bmRlcnRvbmUgYW5hbHlzaXMsIGFuZCBjb2xvciByZWNvbW1lbmRhdGlvbnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmZXRjaENvbG9yQW5hbHlzaXModXNlcklkOiBzdHJpbmcpOiBUb29sIHtcbiAgY29uc3QgZmV0Y2hDb2xvckFuYWx5c2lzU2NoZW1hID0gelxuICAgIC5vYmplY3Qoe30pXG4gICAgLnN0cmljdCgpXG4gICAgLmRlc2NyaWJlKCdObyBwYXJhbWV0ZXJzLiBNdXN0IGJlIGNhbGxlZCB3aXRoIHt9LicpO1xuXG4gIHJldHVybiBuZXcgVG9vbCh7XG4gICAgbmFtZTogJ2ZldGNoQ29sb3JBbmFseXNpcycsXG4gICAgZGVzY3JpcHRpb246XG4gICAgICBcIlJldHJpZXZlcyB0aGUgdXNlcidzIG1vc3QgcmVjZW50IGNvbG9yIGFuYWx5c2lzIHJlc3VsdHMuIEluY2x1ZGVzIHRoZWlyIHJlY29tbWVuZGVkIGNvbG9yIHBhbGV0dGUsIHNraW4gdW5kZXJ0b25lLCBjb2xvcnMgdG8gd2VhciwgYW5kIGNvbG9ycyB0byBhdm9pZC4gVXNlIGZvciBwZXJzb25hbGl6ZWQgc3R5bGUgYWR2aWNlLlwiLFxuICAgIHNjaGVtYTogZmV0Y2hDb2xvckFuYWx5c2lzU2NoZW1hLFxuICAgIGZ1bmM6IGFzeW5jICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHByaXNtYS5jb2xvckFuYWx5c2lzLmZpbmRGaXJzdCh7XG4gICAgICAgICAgc2VsZWN0OiB7XG4gICAgICAgICAgICBwYWxldHRlX25hbWU6IHRydWUsXG4gICAgICAgICAgICBwYWxldHRlX2Rlc2NyaXB0aW9uOiB0cnVlLFxuICAgICAgICAgICAgY29tcGxpbWVudDogdHJ1ZSxcbiAgICAgICAgICAgIGNvbG9yc19zdWl0ZWQ6IHRydWUsXG4gICAgICAgICAgICBjb2xvcnNfdG9fd2VhcjogdHJ1ZSxcbiAgICAgICAgICAgIGNvbG9yc190b19hdm9pZDogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHdoZXJlOiB7IHVzZXJJZCB9LFxuICAgICAgICAgIG9yZGVyQnk6IHsgY3JlYXRlZEF0OiAnZGVzYycgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIGxvZ2dlci5kZWJ1Zyh7IHVzZXJJZCwgcmVzdWx0IH0sICdSYXcgZmV0Y2hDb2xvckFuYWx5c2lzIHJlc3VsdCcpO1xuICAgICAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgICAgIHJldHVybiAnTm8gY29sb3IgYW5hbHlzaXMgZm91bmQgZm9yIHRoZSB1c2VyLic7XG4gICAgICAgIH1cbiAgICAgICAgcmVzdWx0LmNvbG9yc19zdWl0ZWQgPSBBcnJheS5pc0FycmF5KHJlc3VsdC5jb2xvcnNfc3VpdGVkKSA/IHJlc3VsdC5jb2xvcnNfc3VpdGVkIDogW107XG4gICAgICAgIHJlc3VsdC5jb2xvcnNfdG9fd2VhciA9XG4gICAgICAgICAgdHlwZW9mIHJlc3VsdC5jb2xvcnNfdG9fd2VhciA9PT0gJ29iamVjdCcgJiYgcmVzdWx0LmNvbG9yc190b193ZWFyICE9PSBudWxsXG4gICAgICAgICAgICA/IHJlc3VsdC5jb2xvcnNfdG9fd2VhclxuICAgICAgICAgICAgOiB7IGNsb3RoaW5nOiBbXSwgamV3ZWxyeTogW10gfTtcbiAgICAgICAgcmVzdWx0LmNvbG9yc190b19hdm9pZCA9IEFycmF5LmlzQXJyYXkocmVzdWx0LmNvbG9yc190b19hdm9pZClcbiAgICAgICAgICA/IHJlc3VsdC5jb2xvcnNfdG9fYXZvaWRcbiAgICAgICAgICA6IFtdO1xuICAgICAgICByZXN1bHQucGFsZXR0ZV9uYW1lID0gcmVzdWx0LnBhbGV0dGVfbmFtZSA/PyBudWxsO1xuICAgICAgICByZXN1bHQucGFsZXR0ZV9kZXNjcmlwdGlvbiA9IHJlc3VsdC5wYWxldHRlX2Rlc2NyaXB0aW9uID8/IG51bGw7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9IGNhdGNoIChlcnI6IHVua25vd24pIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKHsgdXNlcklkLCBlcnI6IChlcnIgYXMgRXJyb3IpPy5tZXNzYWdlIH0sICdGYWlsZWQgdG8gZmV0Y2ggY29sb3IgYW5hbHlzaXMnKTtcbiAgICAgICAgdGhyb3cgbmV3IEludGVybmFsU2VydmVyRXJyb3IoJ0ZhaWxlZCB0byBmZXRjaCBjb2xvciBhbmFseXNpcycsIHtcbiAgICAgICAgICBjYXVzZTogZXJyLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9LFxuICB9KTtcbn1cblxuLyoqXG4gKiBEeW5hbWljIHRvb2wgZm9yIHJldHJpZXZpbmcgdXNlciBtZW1vcmllcyB1c2luZyBzZW1hbnRpYyBzaW1pbGFyaXR5IHNlYXJjaC5cbiAqIE9wdGltaXplZCBmb3IgZmFzaGlvbiBzdHlsaW5nIGNvbnRleHQgLSBmaW5kcyB1c2VyIHByZWZlcmVuY2VzLCBzaXplcywgc3R5bGUgdGFzdGVzLCBhbmQgY29uc3RyYWludHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmZXRjaFJlbGV2YW50TWVtb3JpZXModXNlcklkOiBzdHJpbmcpOiBUb29sIHtcbiAgY29uc3QgZmV0Y2hSZWxldmFudE1lbW9yaWVzU2NoZW1hID0gei5vYmplY3Qoe1xuICAgIHF1ZXJ5OiB6XG4gICAgICAuc3RyaW5nKClcbiAgICAgIC5kZXNjcmliZShcbiAgICAgICAgJ0EgbmF0dXJhbCBsYW5ndWFnZSBxdWVyeSBkZXNjcmliaW5nIHdoYXQgeW91IHdhbnQgdG8ga25vdyBhYm91dCB0aGUgdXNlci4gRXhhbXBsZXM6IFwidXNlciBzaXplIHByZWZlcmVuY2VzXCIsIFwiZmF2b3JpdGUgY29sb3JzXCIsIFwic3R5bGUgcHJlZmVyZW5jZXNcIiwgXCJidWRnZXQgY29uc3RyYWludHNcIiwgXCJmYWJyaWMgZGlzbGlrZXNcIiwgXCJvY2Nhc2lvbiBuZWVkc1wiLCBvciBcImZpdCBwcmVmZXJlbmNlc1wiLicsXG4gICAgICApLFxuICAgIGxpbWl0OiB6Lm51bWJlcigpLmRlZmF1bHQoNSkuZGVzY3JpYmUoJ01heGltdW0gbnVtYmVyIG9mIHJlbGV2YW50IG1lbW9yaWVzIHRvIHJldHVybicpLFxuICB9KTtcblxuICByZXR1cm4gbmV3IFRvb2woe1xuICAgIG5hbWU6ICdmZXRjaFJlbGV2YW50TWVtb3JpZXMnLFxuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgXCJTZWFyY2hlcyB0aGUgdXNlcidzIGZhc2hpb24gbWVtb3JpZXMgdG8gZmluZCByZWxldmFudCBwZXJzb25hbCBpbmZvcm1hdGlvbiBmb3Igc3R5bGluZyBhZHZpY2UuIFJldHJpZXZlcyBzdG9yZWQgZmFjdHMgYWJvdXQgdGhlaXIgc2l6ZXMsIHN0eWxlIHByZWZlcmVuY2VzLCBjb2xvciBsaWtlcy9kaXNsaWtlcywgYnVkZ2V0IGNvbnN0cmFpbnRzLCBmYWJyaWMgc2Vuc2l0aXZpdGllcywgb2NjYXNpb24gbmVlZHMsIGZpdCBwcmVmZXJlbmNlcywgYW5kIG90aGVyIHN0eWxpbmctcmVsZXZhbnQgZGV0YWlscy4gRXNzZW50aWFsIGZvciBwcm92aWRpbmcgcGVyc29uYWxpemVkIHJlY29tbWVuZGF0aW9ucy5cIixcbiAgICBzY2hlbWE6IGZldGNoUmVsZXZhbnRNZW1vcmllc1NjaGVtYSxcbiAgICBmdW5jOiBhc3luYyAoeyBxdWVyeSwgbGltaXQgfTogei5pbmZlcjx0eXBlb2YgZmV0Y2hSZWxldmFudE1lbW9yaWVzU2NoZW1hPikgPT4ge1xuICAgICAgaWYgKHF1ZXJ5LnRyaW0oKSA9PT0gJycpIHtcbiAgICAgICAgdGhyb3cgbmV3IEJhZFJlcXVlc3RFcnJvcignUXVlcnkgaXMgcmVxdWlyZWQnKTtcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZW1iZWRkaW5nQ291bnQgPSBhd2FpdCBwcmlzbWEuJHF1ZXJ5UmF3VW5zYWZlPFt7IGNvdW50OiBiaWdpbnQgfV0+KFxuICAgICAgICAgICdTRUxFQ1QgQ09VTlQoKikgYXMgY291bnQgRlJPTSBcIk1lbW9yeVwiIFdIRVJFIFwidXNlcklkXCIgPSAkMSBBTkQgXCJlbWJlZGRpbmdcIiBJUyBOT1QgTlVMTCcsXG4gICAgICAgICAgdXNlcklkLFxuICAgICAgICApO1xuXG4gICAgICAgIGlmIChOdW1iZXIoZW1iZWRkaW5nQ291bnRbMF0uY291bnQpID09PSAwKSB7XG4gICAgICAgICAgcmV0dXJuIFwiTm8gbWVtb3JpZXMgZm91bmQgZm9yIHRoaXMgdXNlci4gVGhlIHVzZXIgaGFzbid0IHNoYXJlZCBhbnkgcGVyc29uYWwgcHJlZmVyZW5jZXMgb3IgaW5mb3JtYXRpb24geWV0LlwiO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbW9kZWwgPSBuZXcgT3BlbkFJRW1iZWRkaW5ncyh7IG1vZGVsOiAndGV4dC1lbWJlZGRpbmctMy1zbWFsbCcgfSk7XG4gICAgICAgIGNvbnN0IGVtYmVkZGVkUXVlcnkgPSBhd2FpdCBtb2RlbC5lbWJlZFF1ZXJ5KHF1ZXJ5KTtcbiAgICAgICAgY29uc3QgdmVjdG9yID0gSlNPTi5zdHJpbmdpZnkoZW1iZWRkZWRRdWVyeSk7XG5cbiAgICAgICAgY29uc3QgbWVtb3JpZXM6IHsgaWQ6IHN0cmluZzsgbWVtb3J5OiBzdHJpbmc7IGNyZWF0ZWRBdDogRGF0ZTsgc2ltaWxhcml0eTogbnVtYmVyIH1bXSA9XG4gICAgICAgICAgYXdhaXQgcHJpc21hLiRxdWVyeVJhd1Vuc2FmZShcbiAgICAgICAgICAgICdTRUxFQ1QgaWQsIG1lbW9yeSwgXCJjcmVhdGVkQXRcIiwgKDEgLSAoXCJlbWJlZGRpbmdcIiA8PT4gJDE6OnZlY3RvcikpIGFzIHNpbWlsYXJpdHkgRlJPTSBcIk1lbW9yeVwiIFdIRVJFIFwiZW1iZWRkaW5nXCIgSVMgTk9UIE5VTEwgQU5EIFwidXNlcklkXCIgPSAkMiBPUkRFUiBCWSBcImVtYmVkZGluZ1wiIDw9PiAkMTo6dmVjdG9yIExJTUlUICQzJyxcbiAgICAgICAgICAgIHZlY3RvcixcbiAgICAgICAgICAgIHVzZXJJZCxcbiAgICAgICAgICAgIGxpbWl0LFxuICAgICAgICAgICk7XG5cbiAgICAgICAgaWYgKG1lbW9yaWVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIHJldHVybiAnTm8gcmVsZXZhbnQgbWVtb3JpZXMgZm91bmQgZm9yIHRoaXMgcXVlcnkuJztcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGZvcm1hdHRlZE1lbW9yaWVzID0gbWVtb3JpZXMubWFwKCh7IG1lbW9yeSwgY3JlYXRlZEF0LCBzaW1pbGFyaXR5IH0pID0+ICh7XG4gICAgICAgICAgbWVtb3J5LFxuICAgICAgICAgIHJlbGV2YW5jZTogc2ltaWxhcml0eSA+IDAuOCA/ICdoaWdoJyA6IHNpbWlsYXJpdHkgPiAwLjYgPyAnbWVkaXVtJyA6ICdsb3cnLFxuICAgICAgICAgIGNyZWF0ZWRBdDogY3JlYXRlZEF0LnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXSxcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIHJldHVybiBmb3JtYXR0ZWRNZW1vcmllcztcbiAgICAgIH0gY2F0Y2ggKGVycjogdW5rbm93bikge1xuICAgICAgICBsb2dnZXIuZXJyb3IoXG4gICAgICAgICAgeyB1c2VySWQsIHF1ZXJ5LCBsaW1pdCwgZXJyOiAoZXJyIGFzIEVycm9yKT8ubWVzc2FnZSB9LFxuICAgICAgICAgICdGYWlsZWQgdG8gZmV0Y2ggcmVsZXZhbnQgbWVtb3JpZXMnLFxuICAgICAgICApO1xuICAgICAgICB0aHJvdyBuZXcgSW50ZXJuYWxTZXJ2ZXJFcnJvcignRmFpbGVkIHRvIGZldGNoIHJlbGV2YW50IG1lbW9yaWVzJywge1xuICAgICAgICAgIGNhdXNlOiBlcnIsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0sXG4gIH0pO1xufVxuIl19