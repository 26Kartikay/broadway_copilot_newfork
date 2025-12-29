import { z } from 'zod';

/**
 * Structured search intent schema for product recommendations
 * This replaces the vector-based approach with explicit, safe search parameters
 */
export const ProductSearchIntentSchema = z.object({
  query_text: z.string().describe('Main search keywords or product description'),
  filters: z.object({
    brand: z.array(z.string()).optional().describe('Filter by specific brands'),
    colors: z.array(z.string()).optional().describe('Filter by product colors'),
    sizes: z.array(z.string()).optional().describe('Filter by product sizes'),
    max_price: z.number().positive().nullable().optional().describe('Maximum price filter'),
    min_price: z.number().positive().nullable().optional().describe('Minimum price filter'),
    category: z.string().optional().describe('Filter by product category'),
    style: z.string().optional().describe('Filter by style aesthetic'),
    fit: z.string().optional().describe('Filter by fit/silhouette'),
    occasion: z.string().optional().describe('Filter by occasion'),
  }).optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'rating'])
    .default('relevance')
    .describe('Sort order for results'),
  limit: z.number().int().positive().min(1).max(20)
    .default(10)
    .describe('Maximum number of results to return'),
});

export type ProductSearchIntent = z.infer<typeof ProductSearchIntentSchema>;

/**
 * Product search result type - maintains compatibility with existing bot card format
 */
export type ProductSearchResult = {
  name: string;
  brand: string;
  type: string | null;
  style: string | null;
  fit: string | null;
  colors: string[];
  occasions: string[];
  imageUrl: string;
  productLink: string;
};

/**
 * Product search response type
 */
export type ProductSearchResponse = {
  results: ProductSearchResult[];
  total: number;
  intent: ProductSearchIntent;
};
