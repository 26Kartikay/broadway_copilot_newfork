import OpenAI from 'openai';
import { getPaletteData, resolveSeasonalPalette } from '../../data/seasonalPalettes';
import { openaiRerankByQuery } from '../../lib/openaiRerank';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

export interface SearchCatalogInput {
  query?: string;
  category?: string;
  colors?: string[];
  occasions?: string[];
  style?: string;
  colorSeason?: string;
  gender?: string;             // 'male' | 'female' — soft signal used in reranking
  /** Guest chose not to pick one aisle — omit single-gender SQL filter and diversify embedding text. */
  genderMix?: boolean;
  priceRange?: { min: number; max: number };
  limit?: number;
  excludeProductIds?: string[]; // Never return these (already shown this session)
  excludeHandleIds?: string[];  // Never return products with these handleIds (variant-level dedup)
}

export interface FormattedProduct {
  id: string;
  handleId: string;
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

const EMBEDDING_MODEL = 'text-embedding-3-small';
const VECTOR_RECALL_LIMIT = 500;
const MAX_LIMIT = 40;

type AudienceTags = {
  gender?: string;
  ageGroup?: string;
  colorPalette?: string;
  subCategory?: string;
  allTags?: string;
};

function audienceFromTags(tags: unknown): AudienceTags {
  if (!tags || typeof tags !== 'object') return {};
  const o = tags as Record<string, unknown>;
  const out: AudienceTags = {};
  if (typeof o.gender === 'string') out.gender = o.gender;
  if (typeof o.ageGroup === 'string') out.ageGroup = o.ageGroup;
  if (typeof o.colorPalette === 'string') out.colorPalette = o.colorPalette;
  if (typeof o.subCategory === 'string') out.subCategory = o.subCategory;
  if (typeof o.allTags === 'string') out.allTags = o.allTags;
  return out;
}

function normalizePaletteName(palette: string | null | undefined): string | null {
  if (!palette) return null;
  return palette
    .split(/\s+|_/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function getOpenAI(): OpenAI | null {
  const k = process.env.OPENAI_API_KEY?.trim();
  if (!k) return null;
  return new OpenAI({ apiKey: k });
}

async function embedQuery(text: string): Promise<number[] | null> {
  const client = getOpenAI();
  if (!client) return null;
  try {
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000),
    });
    return res.data[0]?.embedding ?? null;
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, 'OpenAI embedding failed');
    return null;
  }
}

/** Rich natural-language string for embedding (aligned with legacy searchProducts enhancement). */
function buildEmbeddingText(input: SearchCatalogInput): string {
  const parts: string[] = [];
  const base = (input.query ?? '').trim() || 'fashion and lifestyle products';
  parts.push(base);

  if (input.occasions?.length) {
    parts.push(`for ${input.occasions.join(', ')} occasion`);
  }

  const rawSeason = input.colorSeason?.trim();
  if (rawSeason) {
    parts.push(`${rawSeason} color palette`);
    const paletteKey = resolveSeasonalPalette(rawSeason);
    if (paletteKey) {
      try {
        const paletteData = getPaletteData(paletteKey);
        const paletteColors = paletteData.topColors
          .slice(0, 5)
          .map((c) => c.name)
          .join(', ');
        if (paletteColors) parts.push(`in colors ${paletteColors}`);
      } catch {
        /* ignore */
      }
    }
  }

  if (input.category) {
    parts.push(`in ${input.category.replace(/_/g, ' ')} category`);
  }
  if (input.colors?.length) {
    parts.push(`${input.colors.join(', ')} color`);
  }
  if (input.style) {
    parts.push(`${input.style} style`);
  }
  if (input.genderMix) {
    parts.push(
      'Curate a balanced mix of menswear and womenswear (and unisex where relevant); avoid skewing to one gender.',
    );
  }
  parts.push('with features like comfort, quality, style, design');
  return parts.join(' ');
}

interface VectorRow {
  id: string;
  handleId: string;
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
  componentTags: unknown;
  similarity: number;
}

function mapRow(r: Record<string, unknown>): VectorRow | null {
  const imageUrl = String(r.imageUrl ?? r.imageurl ?? r['imageUrl'] ?? r['imageurl'] ?? '').trim();
  if (!imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) return null;
  return {
    id: String(r.id),
    handleId: String(r.handleId ?? r.handleid ?? ''),
    name: String(r.name ?? ''),
    brand: String(r.brand ?? ''),
    category: String(r.category ?? ''),
    generalTag: String(r.generalTag ?? r.generaltag ?? ''),
    style: (r.style as string | null) ?? null,
    fit: (r.fit as string | null) ?? null,
    colors: Array.isArray(r.colors) ? (r.colors as string[]) : [],
    occasions: Array.isArray(r.occasions) ? (r.occasions as string[]) : [],
    imageUrl,
    productLink: String(r.productLink ?? r.productlink ?? ''),
    componentTags: r.componentTags ?? r.componenttags,
    similarity: Number(r.similarity ?? 0),
  };
}

function rerankScore(
  row: VectorRow,
  intent: {
    normalizedColor: string | null;
    normalizedPalette: string | null;
    category: string | null;
    occasion: string | null;
    style: string | null;
    gender: string | null;
  },
): number {
  let score = row.similarity;
  const aud = audienceFromTags(row.componentTags);

  if (intent.normalizedPalette && aud.colorPalette) {
    const cp = aud.colorPalette.trim();
    if (cp.toLowerCase() === intent.normalizedPalette.toLowerCase()) {
      score += 0.5;
    } else if (
      cp.toLowerCase().includes(intent.normalizedPalette.toLowerCase()) ||
      intent.normalizedPalette.toLowerCase().includes(cp.toLowerCase())
    ) {
      score += 0.3;
    }
  }

  const nc = intent.normalizedColor;
  if (nc && row.colors.length > 0) {
    const candidateColors = row.colors.map((c) => c.toLowerCase().trim());
    if (candidateColors.includes(nc)) {
      score += 0.25;
    } else if (candidateColors.some((c) => c.includes(nc) || nc.includes(c))) {
      score += 0.1;
    }
  }

  if (intent.category && row.category) {
    const cc = row.category.toLowerCase().replace(/_/g, ' ').trim();
    const ic = intent.category.toLowerCase().trim();
    if (cc === ic) score += 0.3;
    else if (cc.includes(ic) || ic.includes(cc)) score += 0.15;
  }

  if (intent.occasion && aud.allTags) {
    const tags = (aud.allTags || '').toLowerCase();
    const occ = intent.occasion.toLowerCase().trim();
    if (tags.includes(occ)) score += 0.2;
  }

  if (intent.style && row.style) {
    if (row.style.toLowerCase().includes(intent.style.toLowerCase())) score += 0.12;
  }

  // Gender soft signal — boost matching, mild penalty for mismatch
  if (intent.gender && aud.gender) {
    const rg = aud.gender.toLowerCase();
    const ig = intent.gender.toLowerCase();
    if (rg === 'unisex') score += 0.05;
    else if (rg === ig) score += 0.2;
    else score -= 0.1;
  }

  const cat = row.category.toLowerCase();
  if (cat.includes('clothing') || cat.includes('fashion')) score += 0.05;
  if (cat.includes('footwear')) score += 0.05;

  return score;
}

function shouldApplyGenderFilter(category?: string): boolean {
  if (!category) return true;
  const c = category.toUpperCase();
  return c.includes('CLOTHING') || c.includes('FASHION') || c.includes('FOOTWEAR');
}

async function searchCatalogVector(
  input: SearchCatalogInput,
  limit: number,
  /** When set, SQL filters use this object (e.g. relaxed) while embedding text still comes from `input`. */
  filterInput?: SearchCatalogInput,
): Promise<FormattedProduct[]> {
  const fi = filterInput ?? input;
  const embeddingText = buildEmbeddingText(input);
  const tEmbed = Date.now();
  const embedding = await embedQuery(embeddingText);
  if (!embedding) {
    return [];
  }
  logger.info(
    { ms: Date.now() - tEmbed, embeddingChars: embeddingText.length },
    'Catalog vector embedQuery',
  );

  const vectorJson = JSON.stringify(embedding);
  const clauses: string[] = ['"isActive" = true', '"embedding" IS NOT NULL'];
  const params: unknown[] = [];
  let p = 1;

  if (fi.category) {
    clauses.push(`"category"::text = $${p++}`);
    params.push(fi.category);
  }
  if (fi.style) {
    clauses.push(`"style" = $${p++}`);
    params.push(fi.style);
  }
  if (fi.colors && fi.colors.length > 0) {
    clauses.push(`"colors" && $${p++}::text[]`);
    params.push(fi.colors);
  }
  if (fi.occasions && fi.occasions.length > 0) {
    clauses.push(`"occasions" && $${p++}::text[]`);
    params.push(fi.occasions);
  }
  const excludeIds = input.excludeProductIds?.filter(Boolean) ?? [];
  if (excludeIds.length > 0) {
    clauses.push(`id != ALL($${p++}::text[])`);
    params.push(excludeIds);
  }

  const excludeHandleIds = input.excludeHandleIds?.filter(Boolean) ?? [];
  if (excludeHandleIds.length > 0) {
    clauses.push(`"handleId" != ALL($${p++}::text[])`);
    params.push(excludeHandleIds);
  }
  const genderToFilter = input.genderMix ? '' : (input.gender?.toLowerCase().trim() ?? '');
  if (genderToFilter && shouldApplyGenderFilter(fi.category)) {
    clauses.push(
      `("componentTags" IS NULL OR "componentTags"->>'gender' IS NULL OR LOWER("componentTags"->>'gender') = 'unisex' OR LOWER("componentTags"->>'gender') = $${p++})`,
    );
    params.push(genderToFilter);
  }

  const vectorParam = p;
  params.push(vectorJson);

  const sql = `
    SELECT id, "handleId", name, brand, category::text AS category, "generalTag", style, fit, colors, occasions,
           "imageUrl", "productLink", "componentTags",
           (1 - ("embedding" <=> $${vectorParam}::vector)) AS similarity
    FROM "Product"
    WHERE ${clauses.join(' AND ')}
    ORDER BY "embedding" <=> $${vectorParam}::vector
    LIMIT ${VECTOR_RECALL_LIMIT}
  `;

  const tSql = Date.now();
  const raw = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params);
  logger.info({ ms: Date.now() - tSql, rowCount: raw.length }, 'Catalog vector pg query');

  const intent = {
    normalizedColor: input.colors?.[0]?.toLowerCase().trim() ?? null,
    normalizedPalette: normalizePaletteName(input.colorSeason),
    category: input.category?.trim() ?? null,
    occasion: input.occasions?.[0]?.trim() ?? null,
    style: input.style?.trim() ?? null,
    gender: input.genderMix ? null : (input.gender?.toLowerCase().trim() ?? null),
  };

  const candidates: VectorRow[] = [];
  for (const row of raw) {
    const m = mapRow(row);
    if (m) candidates.push(m);
  }

  if (candidates.length === 0) {
    logger.info(
      { embeddingPreview: embeddingText.slice(0, 160) },
      'Vector catalog search returned no rows (missing embeddings or filters too strict)',
    );
    return [];
  }

  const scoredAll = candidates.map((c) => ({
    ...c,
    rerankScore: rerankScore(c, intent),
  }));

  scoredAll.sort((a, b) => b.rerankScore - a.rerankScore);

  // Deduplicate by handleId — keep the highest-scored variant of each product
  const seenHandles = new Set<string>();
  const scored = scoredAll.filter((c) => {
    if (!c.handleId || seenHandles.has(c.handleId)) return false;
    seenHandles.add(c.handleId);
    return true;
  });

  const reranked =
    (await openaiRerankByQuery(
      embeddingText,
      scored,
      (c) =>
        `${c.name} | ${c.brand} | ${c.generalTag} | cat:${c.category} | colors:${c.colors.slice(0, 6).join(',')}`,
    )) ?? scored;

  return reranked.slice(0, Math.min(limit, MAX_LIMIT)).map((r) => ({
    id: r.id,
    handleId: r.handleId,
    name: r.name,
    brand: r.brand,
    category: r.category,
    generalTag: r.generalTag,
    style: r.style,
    fit: r.fit,
    colors: r.colors,
    occasions: r.occasions,
    imageUrl: r.imageUrl,
    productLink: r.productLink,
  }));
}

/** Legacy substring fallback when embeddings unavailable or recall empty. */
async function searchCatalogIlike(
  input: SearchCatalogInput,
  limit: number,
  relaxed = false,
): Promise<FormattedProduct[]> {
  const query = input.query;
  const category = relaxed ? undefined : input.category;
  const colors = relaxed ? [] : (input.colors ?? []);
  const occasions = relaxed ? [] : (input.occasions ?? []);
  const style = relaxed ? undefined : input.style;

  const baseConditions: string[] = ['"isActive" = true'];
  const params: unknown[] = [];
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
  if (query?.trim()) {
    baseConditions.push(`"searchDoc" ILIKE $${paramIndex++}`);
    params.push(`%${query.trim()}%`);
  }
  const ilikeExcludeIds = input.excludeProductIds?.filter(Boolean) ?? [];
  if (ilikeExcludeIds.length > 0) {
    baseConditions.push(`id != ALL($${paramIndex++}::text[])`);
    params.push(ilikeExcludeIds);
  }

  const ilikeExcludeHandleIds = input.excludeHandleIds?.filter(Boolean) ?? [];
  if (ilikeExcludeHandleIds.length > 0) {
    baseConditions.push(`"handleId" != ALL($${paramIndex++}::text[])`);
    params.push(ilikeExcludeHandleIds);
  }
  const ilikeGender = input.genderMix ? '' : (input.gender?.toLowerCase().trim() ?? '');
  if (ilikeGender && shouldApplyGenderFilter(category)) {
    baseConditions.push(
      `("componentTags" IS NULL OR "componentTags"->>'gender' IS NULL OR LOWER("componentTags"->>'gender') = 'unisex' OR LOWER("componentTags"->>'gender') = $${paramIndex++})`,
    );
    params.push(ilikeGender);
  }

  const sql = `
    SELECT id, "handleId", name, brand, category::text, "generalTag", style, fit, colors, occasions, "imageUrl", "productLink"
    FROM "Product"
    WHERE ${baseConditions.join(' AND ')}
    ORDER BY "createdAt" DESC
    LIMIT $${paramIndex}
  `;
  params.push(Math.min(limit, MAX_LIMIT));

  const products = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params);

  // Deduplicate by handleId — keep first (most recent) per product
  const seenHandles = new Set<string>();
  return products
    .filter((p) => {
      const hid = String(p.handleId ?? p.handleid ?? '');
      if (!hid || seenHandles.has(hid)) return false;
      seenHandles.add(hid);
      return true;
    })
    .map((p) => ({
      id: String(p.id),
      handleId: String(p.handleId ?? p.handleid ?? ''),
      name: String(p.name),
      brand: String(p.brand),
      category: String(p.category),
      generalTag: String(p.generalTag ?? ''),
      style: (p.style as string | null) ?? null,
      fit: (p.fit as string | null) ?? null,
      colors: Array.isArray(p.colors) ? (p.colors as string[]) : [],
      occasions: Array.isArray(p.occasions) ? (p.occasions as string[]) : [],
      imageUrl: String(p.imageUrl ?? ''),
      productLink: String(p.productLink ?? ''),
    }));
}

export type SearchCatalogResult = {
  products: FormattedProduct[];
  totalFound: number;
  error?: string;
};

export async function searchCatalog(input: SearchCatalogInput): Promise<SearchCatalogResult> {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), MAX_LIMIT);

  try {
    let products: FormattedProduct[] = [];
    let resolvedViaEmbedding = false;

    if (getOpenAI()) {
      products = await searchCatalogVector(input, limit);
      if (products.length > 0) resolvedViaEmbedding = true;

      const hadStrictFilters = Boolean(
        input.category ||
        input.style ||
        (input.colors && input.colors.length > 0) ||
        (input.occasions && input.occasions.length > 0),
      );
      if (products.length === 0 && hadStrictFilters) {
        // Same embedding text as `input`, but no SQL filters (avoids 0-row vector + model retry)
        const relaxed = await searchCatalogVector(input, limit, {});
        if (relaxed.length > 0) {
          products = relaxed;
          resolvedViaEmbedding = true;
          logger.info(
            { resultCount: products.length },
            'Catalog: vector retry without category/style/color/occasion SQL filters',
          );
        }
      }
    } else {
      logger.warn('OPENAI_API_KEY not set; catalog search using searchDoc ILIKE fallback only');
    }

    let ilikeMode: 'none' | 'strict' | 'relaxed' = 'none';
    if (products.length === 0) {
      products = await searchCatalogIlike(input, limit, false);
      ilikeMode = products.length > 0 ? 'strict' : 'none';
      if (products.length === 0) {
        products = await searchCatalogIlike(input, limit, true);
        ilikeMode = products.length > 0 ? 'relaxed' : 'none';
      }
    }

    if (products.length > 0) {
      const suggestedHandleIds = products.map((p) => p.handleId);
      const uniqueHandles = new Set(suggestedHandleIds.filter(Boolean));
      logger.info(
        {
          resultCount: products.length,
          limit,
          suggested_handle_ids: suggestedHandleIds,
          unique_handle_id_count: uniqueHandles.size,
          empty_handle_id_count: suggestedHandleIds.filter((h) => !h).length,
          duplicate_handle_ids_present: suggestedHandleIds.filter(Boolean).length !== uniqueHandles.size,
        },
        'Catalog: suggested products (handle id audit)',
      );
      if (resolvedViaEmbedding) {
        logger.info(
          { resultCount: products.length, model: EMBEDDING_MODEL },
          'Catalog: vector similarity search',
        );
      } else if (ilikeMode === 'relaxed') {
        logger.info(
          { limit, resultCount: products.length },
          'Catalog: used relaxed ILIKE fallback',
        );
      } else if (ilikeMode === 'strict') {
        logger.info(
          { limit, resultCount: products.length },
          getOpenAI()
            ? 'Catalog: used ILIKE fallback after empty vector'
            : 'Catalog: used ILIKE fallback (no OpenAI key)',
        );
      }
    }

    return {
      products,
      totalFound: products.length,
    };
  } catch (err) {
    logger.error({ err, input }, 'Error in searchCatalog tool');
    return { products: [], totalFound: 0, error: String(err) };
  }
}
