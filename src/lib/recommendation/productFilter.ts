import OpenAI from 'openai';
import { prisma } from '../prisma';
import { logger } from '../../utils/logger';
import type { ExtractedIntent, RawProductRow } from './types';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const VECTOR_RECALL_LIMIT = 500;

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
): { clauses: string[]; params: unknown[]; nextP: number } {
  const clauses: string[] = ['"isActive" = true', '"embedding" IS NOT NULL'];
  const params: unknown[] = [];
  let p = 1;

  // Category hard filter (always applied, even in relaxed mode)
  if (intent.legacyCategory) {
    clauses.push(`"category"::text = $${p++}`);
    params.push(intent.legacyCategory);
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
): Promise<RawProductRow[]> {
  const tEmbed = Date.now();
  const embedding = await embedText(intent.semantic_query);
  if (!embedding) return [];

  logger.info(
    { ms: Date.now() - tEmbed, query: intent.semantic_query.slice(0, 80), relaxed },
    '[RecEng Stage2] Embedding generated',
  );

  const { clauses, params, nextP } = buildHardFilterClauses(intent, excludeIds, excludeHandleIds, relaxed);
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
    clauses.push(`"category"::text = $${p++}`);
    params.push(intent.legacyCategory);
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
 * Main search entry point.
 * 1. Vector search with hard filters
 * 2. Relaxed vector search (drop subCategory/type/tag filters, keep category+gender) if 0 rows
 * 3. ILIKE fallback if still 0 rows
 */
export async function runFilteredSearch(
  intent: ExtractedIntent,
  excludeIds: string[],
  excludeHandleIds: string[],
  limit: number,
): Promise<{ rows: RawProductRow[]; searchMode: string }> {
  if (!getOpenAI()) {
    logger.warn('[RecEng Stage2] No OPENAI_API_KEY — falling back to ILIKE');
    const rows = await ilikeSearch(intent, excludeIds, excludeHandleIds, limit);
    return { rows, searchMode: 'ilike_no_openai' };
  }

  // Stage 2a: strict vector search
  let rows = await vectorSearch(intent, excludeIds, excludeHandleIds, false);
  if (rows.length > 0) return { rows, searchMode: 'vector_strict' };

  const hasStrictFilters = Boolean(
    intent.subCategory || intent.type || intent.tags_must_include.length > 0 || (intent.colors && intent.colors.length > 0),
  );

  // Stage 2b: relaxed vector search (drop subCategory/type/tag filters)
  if (hasStrictFilters) {
    logger.info('[RecEng Stage2] Strict vector returned 0 rows — trying relaxed vector search');
    rows = await vectorSearch(intent, excludeIds, excludeHandleIds, true);
    if (rows.length > 0) return { rows, searchMode: 'vector_relaxed' };
  }

  // Stage 2c: ILIKE fallback
  logger.info('[RecEng Stage2] Vector search returned 0 rows — trying ILIKE fallback');
  rows = await ilikeSearch(intent, excludeIds, excludeHandleIds, limit);
  return { rows, searchMode: rows.length > 0 ? 'ilike_fallback' : 'empty' };
}
