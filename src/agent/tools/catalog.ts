import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

export interface SearchCatalogInput {
  query?: string;
  category?: string;
  colors?: string[];
  occasions?: string[];
  style?: string;
  colorSeason?: string;
  priceRange?: { min: number; max: number };
  limit?: number;
}

export interface FormattedProduct {
  id: string;
  name: string;
  brand: string;
  category: string;
  generalTag: string;
  style: string | null;
  fit: string | null;
  colors: string[];
  occasions: string[];
  imageUrl: string;
  productLink: string;
}

export async function searchCatalog(input: SearchCatalogInput) {
  const {
    query,
    category,
    colors = [],
    occasions = [],
    style,
    limit = 6
  } = input;

  try {
    let baseConditions: string[] = ['"isActive" = true'];
    let params: any[] = [];
    let paramIndex = 1;

    if (category) {
      baseConditions.push(`"category"::text = $${paramIndex++}`);
      params.push(category);
    }

    if (style) {
      baseConditions.push(`"style" = $${paramIndex++}`);
      params.push(style);
    }

    if (colors.length > 0) {
      baseConditions.push(`"colors" && $${paramIndex++}`);
      params.push(colors);
    }

    if (occasions.length > 0) {
      baseConditions.push(`"occasions" && $${paramIndex++}`);
      params.push(occasions);
    }

    if (query) {
      // Full Text Search using PostgreSQL's ILIKE on searchDoc as a fallback for pure Anthropic stack
      baseConditions.push(`"searchDoc" ILIKE $${paramIndex++}`);
      params.push(`%${query}%`);
    }

    const whereClause = baseConditions.join(' AND ');

    const sql = `
      SELECT id, name, brand, category::text, "generalTag", style, fit, colors, occasions, "imageUrl", "productLink"
      FROM "Product"
      WHERE ${whereClause}
      ORDER BY "createdAt" DESC
      LIMIT $${paramIndex}
    `;
    
    const products = await prisma.$queryRawUnsafe<any[]>(sql, ...params, Math.min(limit, 12));

    const formattedProducts: FormattedProduct[] = products.map(p => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      category: p.category,
      generalTag: p.generalTag,
      style: p.style,
      fit: p.fit,
      colors: p.colors || [],
      occasions: p.occasions || [],
      imageUrl: p.imageUrl,
      productLink: p.productLink
    }));

    return {
      products: formattedProducts,
      totalFound: formattedProducts.length
    };
  } catch (err) {
    logger.error({ err, input }, 'Error in searchCatalog tool');
    return { products: [], totalFound: 0, error: String(err) };
  }
}
