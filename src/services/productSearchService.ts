import { ProductSearchIntent, ProductSearchResponse, ProductSearchResult } from '../types/productSearch';
import { logger } from '../utils/logger';

/**
 * Product Search Service
 * Handles structured product search via Broadway Search API endpoint
 * Replaces the vector-based approach with deterministic, safe API calls
 */
export class ProductSearchService {
  private readonly broadwayUrl: string;
  private readonly apiKey: string | undefined;

  constructor() {
    this.broadwayUrl = process.env.ELASTICSEARCH_URL || 'https://dev.broadwaylive.in/search_service/v1/search/products';
    this.apiKey = process.env.ELASTICSEARCH_API_KEY;
  }

  /**
   * Search products using structured intent via Broadway Search API
   */
  async searchProducts(intent: ProductSearchIntent): Promise<ProductSearchResponse> {
    try {
      const searchRequest = this.buildBroadwaySearchQuery(intent);

      const response = await this.makeBroadwaySearchRequest(searchRequest);

      const results = this.transformBroadwayResponse(response);

      logger.info({
        intent,
        resultCount: results.length,
        totalFromAPI: response.data?.total_hits || 0
      }, 'Product search completed via Broadway API');

      return {
        results,
        total: response.data?.total_hits || 0,
        intent,
      };
    } catch (error) {
      logger.error({
        intent,
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to search products via Broadway API');

      // Fallback: return empty results with error info
      return {
        results: [],
        total: 0,
        intent,
      };
    }
  }

  /**
   * Build Broadway search query from structured intent
   * Use the format that works with their API and filter out empty values
   */
  private buildBroadwaySearchQuery(intent: ProductSearchIntent): any {
    const { query_text, filters, sort, limit } = intent;

    // Build filters array for Broadway API format, filtering out empty values
    const filtersArray: any[] = [];

    // Only add filters that have valid, non-empty values
    if (filters?.brand && Array.isArray(filters.brand) && filters.brand.length > 0 && filters.brand[0]?.trim()) {
      filtersArray.push({
        field: 'brand_name',
        value: filters.brand[0].trim()
      });
    }

    if (filters?.colors && Array.isArray(filters.colors) && filters.colors.length > 0 && filters.colors[0]?.trim()) {
      filtersArray.push({
        field: 'variant_colors',
        value: filters.colors[0].trim()
      });
    }

    if (filters?.category && typeof filters.category === 'string' && filters.category.trim()) {
      filtersArray.push({
        field: 'category_name',
        value: filters.category.trim()
      });
    }

    if (filters?.style && typeof filters.style === 'string' && filters.style.trim()) {
      filtersArray.push({
        field: 'style',
        value: filters.style.trim()
      });
    }

    if (filters?.fit && typeof filters.fit === 'string' && filters.fit.trim()) {
      filtersArray.push({
        field: 'fit',
        value: filters.fit.trim()
      });
    }

    if (filters?.occasion && typeof filters.occasion === 'string' && filters.occasion.trim()) {
      filtersArray.push({
        field: 'occasion',
        value: filters.occasion.trim()
      });
    }

    if (filters?.max_price !== null && filters?.max_price !== undefined && !isNaN(filters.max_price)) {
      filtersArray.push({
        field: 'selling_price',
        value: filters.max_price,
        operator: 'lte'
      });
    }

    if (filters?.min_price !== null && filters?.min_price !== undefined && !isNaN(filters.min_price)) {
      filtersArray.push({
        field: 'selling_price',
        value: filters.min_price,
        operator: 'gte'
      });
    }

    // Map sort values to Broadway API format
    let sortBy = 'relevance';
    switch (sort) {
      case 'price_asc':
        sortBy = 'price_asc';
        break;
      case 'price_desc':
        sortBy = 'price_desc';
        break;
      case 'rating':
        sortBy = 'rating';
        break;
      case 'relevance':
      default:
        sortBy = 'relevance';
        break;
    }

    // For now, only send basic query without filters to test
    // TODO: Debug filter format with Broadway API team
    const query: any = {
      query: query_text || '',
      page: 1,
      per_page: limit,
      sort_by: sortBy,
      fields: [
        'name', 'brand_name', 'category_name', 'primary_image_url',
        'variant_colors', 'selling_price', 'slug'
      ]
      // Temporarily remove filters to avoid 422 errors
      // filters: filtersArray
    };

    return query;
  }

  /**
   * Make HTTP request to Broadway Search API
   */
  private async makeBroadwaySearchRequest(query: any): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey !== undefined) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(this.broadwayUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(query),
    });

    if (!response.ok) {
      throw new Error(`Broadway API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Transform Broadway API response to our format
   */
  private transformBroadwayResponse(apiResponse: any): ProductSearchResult[] {
    if (!apiResponse.success || !apiResponse.data?.results) {
      return [];
    }

    return apiResponse.data.results.map((product: any) => ({
      name: product.name,
      brand: product.brand_name || product.brand?.name,
      type: product.category_name,
      style: product.style || null,
      fit: product.fit || null,
      colors: product.variant_colors?.map((vc: any) => vc.name) || [],
      occasions: product.occasions || [],
      imageUrl: product.primary_image_url,
      productLink: product.slug ? `https://broadwaylive.in/products/${product.slug}` : `https://broadwaylive.in/products/${product.id}`,
    }));
  }

  /**
   * Fallback search using simple text query
   */
  async fallbackSearch(query: string, limit: number = 10): Promise<ProductSearchResult[]> {
    try {
      // Simple Broadway search query for fallback
      const fallbackQuery = {
        query: query,
        page: 1,
        per_page: limit,
        sort_by: 'relevance',
        filters: [],
        fields: [
          'name', 'brand_name', 'category_name', 'primary_image_url',
          'variant_colors', 'selling_price'
        ]
      };

      const response = await this.makeBroadwaySearchRequest(fallbackQuery);
      const results = this.transformBroadwayResponse(response);

      logger.info({
        query,
        resultCount: results.length
      }, 'Fallback product search completed via Broadway API');

      return results;
    } catch (error) {
      logger.error({
        query,
        error: error instanceof Error ? error.message : String(error)
      }, 'Fallback product search failed');

      return [];
    }
  }
}
