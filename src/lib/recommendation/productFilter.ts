import OpenAI from 'openai';
import { prisma } from '../prisma';
import { logger } from '../../utils/logger';
import type { ExtractedIntent, RawProductRow } from './types';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const VECTOR_RECALL_LIMIT = 500;

/**
 * All products share category = CLOTHING_FASHION in the DB — the ProductCategory enum
 * is not a reliable filter signal for non-clothing verticals.
 * Real differentiation lives in componentTags->>'subCategory' and allTags.
 * These patterns are ILIKE wildcards matched against those fields.
 * CLOTHING_FASHION has no entry here — it relies on type/tag filters, not category.
 */
const CATEGORY_SUBCATEGORY_PATTERNS: Record<string, string[]> = {
  BAGS_LUGGAGE: [
    '%Backpack%', '%Handbag%', '%Tote%', '%Wallet%', '%Sling Bag%',
    '%Duffel%', '%Laptop Bag%', '%Travel Bag%', '%Luggage%',
    '%Messenger%', '%Laptop Sleeve%', '%Travel Accessor%',
  ],
  FOOTWEAR: [
    '%Sneaker%', '%Shoe%', '%Boot%', '%Sandal%', '%Slider%',
    '%Heel%', '%Flat%', '%Loafer%', '%Slipper%', '%Flip Flop%',
    '%Running Shoe%', '%Training Shoe%', '%Sports Shoe%',
  ],
  JEWELLERY_ACCESSORIES: [
    '%Necklace%', '%Earring%', '%Ring%', '%Bracelet%', '%Watch%',
  ],
  BEAUTY_PERSONAL_CARE: [
    '%Moisturizer%', '%Cleanser%', '%Toner%', '%Serum%', '%Sunscreen%',
    '%Foundation%', '%Concealer%', '%Blush%', '%Lipstick%', '%Lip Balm%',
    '%Mascara%', '%Eyeliner%', '%Shampoo%', '%Conditioner%',
    '%Hair Mask%', '%Hair Oil%', '%Perfume%', '%Body Mist%',
    '%Deodorant%', '%Beard Care%',
  ],
  HEALTH_WELLNESS: [
    '%Protein%', '%Vitamin%', '%Supplement%', '%Smart Ring%',
    '%Smart Band%', '%Fitness Tracker%', '%Whey%', '%Probiotic%',
  ],
};

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  if (!_openai) _openai = new OpenAI({ apiKey: key });
  return _openai;
}

async function embedText(text: string): Promise<number[] | null> {
  const client = getOpenAI();
  if (!client) return null;
  try {
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000),
    });
    return res.data[0]?.embedding ?? null;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[RecEng Stage2] OpenAI embedding failed');
    return null;
  }
}

function mapRow(r: Record<string, unknown>, fallbackSimilarity = 0): RawProductRow | null {
  const imageUrl = String(r.imageUrl ?? r.imageurl ?? '').trim();
  if (!imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) return null;
  return {
    id: String(r.id),
    handleId: String(r.handleId ?? r.handleid ?? ''),
    name: String(r.name ?? ''),
    brand: String(r.brand ?? ''),
    generalTag: String(r.generalTag ?? r.generaltag ?? ''),
    colors: Array.isArray(r.colors) ? (r.colors as string[]) : [],
    imageUrl,
    productLink: String(r.productLink ?? r.productlink ?? ''),
    componentTags: ((r.componentTags ?? r.componenttags ?? {}) as Record<string, unknown>),
    similarity: typeof r.similarity === 'number' ? r.similarity : fallbackSimilarity,
  };
}

/** Build hard-filter WHERE clauses from the extracted intent. */
function buildHardFilterClauses(
  intent: ExtractedIntent,
  excludeIds: string[],
  excludeHandleIds: string[],
  relaxed = false,
  brand?: string | null,
  fitPreference?: string | null,
): { clauses: string[]; params: unknown[]; nextP: number } {
  const clauses: string[] = ['"isActive" = true', '"embedding" IS NOT NULL'];
  const params: unknown[] = [];
  let p = 1;

  // Category filter — translated to subCategory/allTags patterns because all products in the DB
  // share category = CLOTHING_FASHION regardless of vertical (bags, shoes, jewellery, etc.).
  // Always applied even in relaxed mode.
  if (intent.legacyCategory) {
    const subCatPatterns = CATEGORY_SUBCATEGORY_PATTERNS[intent.legacyCategory];
    if (subCatPatterns?.length) {
      clauses.push(
        `EXISTS (SELECT 1 FROM unnest($${p++}::text[]) AS term WHERE "componentTags"->>'subCategory' ILIKE term OR "componentTags"->>'allTags' ILIKE term OR "subCategory" ILIKE term OR "allTags" ILIKE term)`,
      );
      params.push(subCatPatterns);
    }
    // CLOTHING_FASHION: no pattern filter — all products share this enum, so a filter
    // would be redundant. Type and tag filters below handle clothing-specific discrimination.
  }

  // Brand hard filter (always applied when user explicitly named a brand; partial ILIKE so
  // "Mokobara" also matches "Mokobara India" and handles any casing variations)
  if (brand?.trim()) {
    clauses.push(`"brand" ILIKE $${p++}`);
    params.push(`%${brand.trim()}%`);
  }

  if (!relaxed) {
    // SubCategory: check componentTags->subCategory, generalTag, AND allTags
    if (intent.subCategory) {
      clauses.push(
        `("componentTags"->>'subCategory' ILIKE $${p} OR "generalTag" ILIKE $${p} OR "componentTags"->>'allTags' ILIKE $${p})`,
      );
      params.push(`%${intent.subCategory}%`);
      p++;
    }

    // Type: check generalTag AND allTags (more specific than subCategory)
    if (intent.type) {
      clauses.push(
        `("generalTag" ILIKE $${p} OR "componentTags"->>'subCategory' ILIKE $${p} OR "componentTags"->>'allTags' ILIKE $${p})`,
      );
      params.push(`%${intent.type}%`);
      p++;
    }

    // tags_must_include: each tag must appear in allTags (AND logic)
    for (const tag of intent.tags_must_include) {
      clauses.push(`"componentTags"->>'allTags' ILIKE $${p++}`);
      params.push(`%${tag}%`);
    }

    // tags_must_exclude: none of these tags allowed
    for (const tag of intent.tags_must_exclude) {
      clauses.push(
        `("componentTags"->>'allTags' IS NULL OR "componentTags"->>'allTags' NOT ILIKE $${p++})`,
      );
      params.push(`%${tag}%`);
    }

    // Colors hard filter
    if (intent.colors && intent.colors.length > 0) {
      clauses.push(`"colors" && $${p++}::text[]`);
      params.push(intent.colors);
    }

    // Fit preference: keep products with no fit data OR matching fit
    if (fitPreference?.trim()) {
      clauses.push(`("fit" IS NULL OR "fit" ILIKE $${p++})`);
      params.push(`%${fitPreference.trim()}%`);
    }
  }

  // Gender hard filter (always applied, even in relaxed mode)
  if (intent.gender) {
    clauses.push(
      `("componentTags" IS NULL OR "componentTags"->>'gender' IS NULL OR LOWER("componentTags"->>'gender') = 'unisex' OR LOWER("componentTags"->>'gender') = $${p++})`,
    );
    params.push(intent.gender.toLowerCase());
  }

  // Exclude already-shown products by id
  const cleanExcludeIds = excludeIds.filter(Boolean);
  if (cleanExcludeIds.length > 0) {
    clauses.push(`id != ALL($${p++}::text[])`);
    params.push(cleanExcludeIds);
  }

  // Exclude already-shown products by handleId (catches variants with different ids)
  const cleanExcludeHandleIds = excludeHandleIds.filter(Boolean);
  if (cleanExcludeHandleIds.length > 0) {
    clauses.push(`"handleId" != ALL($${p++}::text[])`);
    params.push(cleanExcludeHandleIds);
  }

  return { clauses, params, nextP: p };
}

async function vectorSearch(
  intent: ExtractedIntent,
  excludeIds: string[],
  excludeHandleIds: string[],
  relaxed: boolean,
  brand?: string | null,
  fitPreference?: string | null,
): Promise<RawProductRow[]> {
  const tEmbed = Date.now();
  const embedding = await embedText(intent.semantic_query);
  if (!embedding) return [];

  logger.info(
    { ms: Date.now() - tEmbed, query: intent.semantic_query.slice(0, 80), relaxed },
    '[RecEng Stage2] Embedding generated',
  );

  const { clauses, params, nextP } = buildHardFilterClauses(intent, excludeIds, excludeHandleIds, relaxed, brand, fitPreference);
  const vectorJson = JSON.stringify(embedding);
  const vp = nextP;
  params.push(vectorJson);

  const sql = `
    SELECT id, "handleId", name, brand, "generalTag", colors, "imageUrl", "productLink", "componentTags",
           (1 - ("embedding" <=> $${vp}::vector)) AS similarity
    FROM "Product"
    WHERE ${clauses.join(' AND ')}
    ORDER BY "embedding" <=> $${vp}::vector
    LIMIT ${VECTOR_RECALL_LIMIT}
  `;

  const tSql = Date.now();
  const raw = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params);
  logger.info(
    { ms: Date.now() - tSql, rowCount: raw.length, relaxed, clauseCount: clauses.length - 2 },
    '[RecEng Stage2] Postgres vector query complete',
  );

  const rows: RawProductRow[] = [];
  for (const r of raw) {
    const mapped = mapRow(r);
    if (mapped) rows.push(mapped);
  }
  return rows;
}

/** Bare-minimum vector search: only gender + brand hard filters + exclude lists.
 * Used as a third-tier fallback when category + relaxed filters both return 0 rows.
 * Lets pure semantic similarity do the heavy lifting with minimal SQL constraints. */
async function vectorSearchBareMinimum(
  intent: ExtractedIntent,
  excludeIds: string[],
  excludeHandleIds: string[],
  brand?: string | null,
): Promise<RawProductRow[]> {
  const embedding = await embedText(intent.semantic_query);
  if (!embedding) return [];

  const clauses: string[] = ['"isActive" = true', '"embedding" IS NOT NULL'];
  const params: unknown[] = [];
  let p = 1;

  if (brand?.trim()) {
    clauses.push(`"brand" ILIKE $${p++}`);
    params.push(`%${brand.trim()}%`);
  }

  if (intent.gender) {
    clauses.push(
      `("componentTags" IS NULL OR "componentTags"->>'gender' IS NULL OR LOWER("componentTags"->>'gender') = 'unisex' OR LOWER("componentTags"->>'gender') = $${p++})`,
    );
    params.push(intent.gender.toLowerCase());
  }

  const cleanExcludeIds = excludeIds.filter(Boolean);
  if (cleanExcludeIds.length > 0) {
    clauses.push(`id != ALL($${p++}::text[])`);
    params.push(cleanExcludeIds);
  }

  const cleanExcludeHandleIds = excludeHandleIds.filter(Boolean);
  if (cleanExcludeHandleIds.length > 0) {
    clauses.push(`"handleId" != ALL($${p++}::text[])`);
    params.push(cleanExcludeHandleIds);
  }

  const vectorJson = JSON.stringify(embedding);
  const vp = p;
  params.push(vectorJson);

  const sql = `
    SELECT id, "handleId", name, brand, "generalTag", colors, "imageUrl", "productLink", "componentTags",
           (1 - ("embedding" <=> $${vp}::vector)) AS similarity
    FROM "Product"
    WHERE ${clauses.join(' AND ')}
    ORDER BY "embedding" <=> $${vp}::vector
    LIMIT ${VECTOR_RECALL_LIMIT}
  `;

  const tSql = Date.now();
  const raw = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params);
  logger.info(
    { ms: Date.now() - tSql, rowCount: raw.length },
    '[RecEng Stage2] Bare-minimum vector query complete',
  );

  const rows: RawProductRow[] = [];
  for (const r of raw) {
    const mapped = mapRow(r);
    if (mapped) rows.push(mapped);
  }
  return rows;
}

async function ilikeSearch(
  intent: ExtractedIntent,
  excludeIds: string[],
  excludeHandleIds: string[],
  limit: number,
): Promise<RawProductRow[]> {
  const clauses: string[] = ['"isActive" = true'];
  const params: unknown[] = [];
  let p = 1;

  if (intent.legacyCategory) {
    const subCatPatterns = CATEGORY_SUBCATEGORY_PATTERNS[intent.legacyCategory];
    if (subCatPatterns?.length) {
      clauses.push(
        `EXISTS (SELECT 1 FROM unnest($${p++}::text[]) AS term WHERE "componentTags"->>'subCategory' ILIKE term OR "componentTags"->>'allTags' ILIKE term OR "subCategory" ILIKE term OR "allTags" ILIKE term)`,
      );
      params.push(subCatPatterns);
    }
    // CLOTHING_FASHION: no filter (all products share this category)
  }

  const searchTerm = intent.subCategory ?? intent.type ?? intent.semantic_query;
  if (searchTerm) {
    // Check searchDoc (full text), generalTag, and allTags
    clauses.push(
      `("searchDoc" ILIKE $${p} OR "generalTag" ILIKE $${p} OR "componentTags"->>'allTags' ILIKE $${p})`,
    );
    params.push(`%${searchTerm}%`);
    p++;
  }

  if (intent.gender) {
    clauses.push(
      `("componentTags" IS NULL OR "componentTags"->>'gender' IS NULL OR LOWER("componentTags"->>'gender') = 'unisex' OR LOWER("componentTags"->>'gender') = $${p++})`,
    );
    params.push(intent.gender.toLowerCase());
  }

  const cleanExcludeIds = excludeIds.filter(Boolean);
  if (cleanExcludeIds.length > 0) {
    clauses.push(`id != ALL($${p++}::text[])`);
    params.push(cleanExcludeIds);
  }

  const cleanExcludeHandleIds = excludeHandleIds.filter(Boolean);
  if (cleanExcludeHandleIds.length > 0) {
    clauses.push(`"handleId" != ALL($${p++}::text[])`);
    params.push(cleanExcludeHandleIds);
  }

  params.push(Math.min(limit * 10, VECTOR_RECALL_LIMIT));

  const sql = `
    SELECT id, "handleId", name, brand, "generalTag", colors, "imageUrl", "productLink", "componentTags"
    FROM "Product"
    WHERE ${clauses.join(' AND ')}
    ORDER BY "createdAt" DESC
    LIMIT $${p}
  `;

  logger.info('[RecEng Stage2] Running ILIKE fallback search');
  const raw = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params);
  logger.info({ rowCount: raw.length }, '[RecEng Stage2] ILIKE fallback complete');

  const rows: RawProductRow[] = [];
  for (const r of raw) {
    const mapped = mapRow(r, 0.5); // neutral similarity for ILIKE results
    if (mapped) rows.push(mapped);
  }
  return rows;
}

/**
 * Main search entry point — 4-tier fallback:
 * 1. Strict:       all filters (subCategory patterns + brand + gender + type/tags/colors/fit)
 * 2. Relaxed:      drop subCategory/type/tags/colors/fit; keep category patterns + brand + gender
 * 3. Bare-minimum: drop everything except brand + gender; pure semantic similarity
 *                  (catches cases where category patterns don't match stored subCategory values)
 * 4. ILIKE:        last resort text search, no embeddings required
 */
export async function runFilteredSearch(
  intent: ExtractedIntent,
  excludeIds: string[],
  excludeHandleIds: string[],
  limit: number,
  brand?: string | null,
  fitPreference?: string | null,
): Promise<{ rows: RawProductRow[]; searchMode: string }> {
  if (!getOpenAI()) {
    logger.warn('[RecEng Stage2] No OPENAI_API_KEY — falling back to ILIKE');
    const rows = await ilikeSearch(intent, excludeIds, excludeHandleIds, limit);
    return { rows, searchMode: 'ilike_no_openai' };
  }

  // Tier 1: strict vector search (all filters)
  let rows = await vectorSearch(intent, excludeIds, excludeHandleIds, false, brand, fitPreference);
  if (rows.length > 0) return { rows, searchMode: 'vector_strict' };

  const hasNonCategoryFilters = Boolean(
    intent.subCategory || intent.type || intent.tags_must_include.length > 0 ||
    (intent.colors && intent.colors.length > 0) || fitPreference,
  );

  // Tier 2: relaxed vector (drop subCategory/type/tags/colors/fit, keep category pattern + brand + gender)
  if (hasNonCategoryFilters) {
    logger.info('[RecEng Stage2] Strict vector returned 0 rows — trying relaxed vector search');
    rows = await vectorSearch(intent, excludeIds, excludeHandleIds, true, brand);
    if (rows.length > 0) return { rows, searchMode: 'vector_relaxed' };
  }

  // Tier 3: bare-minimum vector (drop category patterns too — only brand + gender)
  // Handles the case where the category filter itself is the bottleneck (e.g. subCategory
  // values in DB don't match our ILIKE patterns, or product is miscategorised).
  if (intent.legacyCategory) {
    logger.info('[RecEng Stage2] Category-filtered vector returned 0 rows — trying bare-minimum vector (brand+gender only)');
    rows = await vectorSearchBareMinimum(intent, excludeIds, excludeHandleIds, brand);
    if (rows.length > 0) return { rows, searchMode: 'vector_bare_minimum' };
  }

  // Tier 4: ILIKE text fallback (no embeddings required)
  logger.info('[RecEng Stage2] Vector search returned 0 rows — trying ILIKE fallback');
  rows = await ilikeSearch(intent, excludeIds, excludeHandleIds, limit);
  return { rows, searchMode: rows.length > 0 ? 'ilike_fallback' : 'empty' };
}
