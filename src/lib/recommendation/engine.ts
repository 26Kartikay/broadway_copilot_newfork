import { openaiRerankByQuery } from '../openaiRerank';
import { logger } from '../../utils/logger';
import { detectRecipient } from './recipientDetector';
import { extractIntent } from './intentExtractor';
import { runFilteredSearch } from './productFilter';
import {
  configIdFromComponentTags,
  dedupeKeyFromProduct,
  skuIdFromComponentTags,
} from './configDedupe';
import { computeScore } from './scorer';
import type {
  ExtractedIntent,
  RecipientContext,
  RecommendationEngineInput,
  RecommendationResult,
  RecommendedProduct,
  ScoredRow,
} from './types';

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const SCORE_THRESHOLD = 0.50;
const FALLBACK_THRESHOLD = 0.35;

/** Build a structured shopping-intent string passed to the reranker for anchoring. */
function buildRerankContext(intent: ExtractedIntent, recipientCtx: RecipientContext): string {
  const parts: string[] = [];
  if (intent.legacyCategory) parts.push(`Category: ${intent.legacyCategory.replace(/_/g, ' ')}`);
  if (intent.subCategory) parts.push(`Sub-category: ${intent.subCategory}`);
  if (intent.type) parts.push(`Type: ${intent.type}`);
  if (intent.gender) parts.push(`Gender: ${intent.gender}`);
  if (intent.ageGroup) parts.push(`Age group: ${intent.ageGroup}`);
  if (intent.occasion) parts.push(`Occasion: ${intent.occasion}`);
  if (intent.colors?.length) parts.push(`Colors wanted: ${intent.colors.join(', ')}`);
  if (intent.colorPalette) parts.push(`Color palette: ${intent.colorPalette}`);
  if (intent.tags_must_include.length) parts.push(`Must include tags: ${intent.tags_must_include.join(', ')}`);
  if (intent.tags_must_exclude.length) parts.push(`Must exclude tags: ${intent.tags_must_exclude.join(', ')}`);
  if (recipientCtx.shopping_for === 'other') {
    parts.push(`Shopping for: ${recipientCtx.recipient_relationship ?? 'someone else'}`);
    if (recipientCtx.recipient_gender) parts.push(`Recipient gender: ${recipientCtx.recipient_gender}`);
    if (recipientCtx.gift_context) parts.push('This is a gift purchase');
  }
  return parts.join('\n');
}

/** Rich one-line product description for the reranker — semantic fields only, no numeric scores. */
function buildProductSummary(s: ScoredRow): string {
  const sub = String(s.componentTags.subCategory ?? '');
  const occasion = String(s.componentTags.occasion ?? '');
  const palette = String(s.componentTags.colorPalette ?? '');
  const allTags = String(s.componentTags.allTags ?? '');
  const tagSnippet = allTags.split(',').slice(0, 8).join(',');
  return [
    s.name,
    s.brand,
    s.generalTag,
    sub ? `sub:${sub}` : '',
    `colors:${s.colors.slice(0, 5).join('/')}`,
    occasion ? `occasion:${occasion}` : '',
    palette ? `palette:${palette}` : '',
    tagSnippet ? `tags:${tagSnippet}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
}

function summarizeFilters(intent: ExtractedIntent): string {
  const parts: string[] = [];
  if (intent.legacyCategory) parts.push(`cat=${intent.legacyCategory}`);
  if (intent.subCategory) parts.push(`sub=${intent.subCategory}`);
  if (intent.type) parts.push(`type=${intent.type}`);
  if (intent.gender) parts.push(`gender=${intent.gender}`);
  if (intent.ageGroup) parts.push(`age=${intent.ageGroup}`);
  if (intent.colors?.length) parts.push(`colors=[${intent.colors.join(',')}]`);
  if (intent.occasion) parts.push(`occasion=${intent.occasion}`);
  if (intent.tags_must_include.length) parts.push(`must=[${intent.tags_must_include.join(',')}]`);
  if (intent.tags_must_exclude.length) parts.push(`excl=[${intent.tags_must_exclude.join(',')}]`);
  return parts.join(' | ') || 'none';
}

export async function runRecommendationEngine(
  input: RecommendationEngineInput,
): Promise<RecommendationResult> {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const excludeIds = input.exclude_product_ids ?? [];
  const excludeHandleIds = input.exclude_handle_ids ?? [];
  const tStart = Date.now();

  logger.info(
    {
      query: input.user_query,
      userGender: input.user_profile.gender ?? null,
      userAgeGroup: input.user_profile.ageGroup ?? null,
      excludeCount: excludeIds.length,
      limit,
    },
    '[RecEng] ═══ Starting recommendation engine ═══',
  );

  // ── Stage 0: Recipient detection ────────────────────────────────────────────
  logger.info('[RecEng] ─── Stage 0: Recipient detection ───');
  const recipientCtx = await detectRecipient(input.user_query, input.user_profile);

  const profileUsed = recipientCtx.shopping_for === 'self';
  const genderFilterUsed =
    recipientCtx.shopping_for === 'self'
      ? (input.user_profile.gender ?? null)
      : recipientCtx.shopping_for === 'other'
        ? (recipientCtx.recipient_gender ?? null)
        : null;

  logger.info(
    {
      shopping_for: recipientCtx.shopping_for,
      recipient_gender: recipientCtx.recipient_gender,
      recipient_age_group: recipientCtx.recipient_age_group,
      recipient_relationship: recipientCtx.recipient_relationship,
      gift_context: recipientCtx.gift_context,
      confidence: recipientCtx.confidence,
      effective_gender_filter: genderFilterUsed,
      profile_used: profileUsed,
    },
    '[RecEng] Stage 0 result',
  );

  // ── Stage 1: Intent extraction ───────────────────────────────────────────────
  logger.info('[RecEng] ─── Stage 1: Intent extraction ───');
  const intent = await extractIntent(input.user_query, recipientCtx, input.user_profile);

  logger.info(
    {
      filters: summarizeFilters(intent),
      semantic_query: intent.semantic_query,
    },
    '[RecEng] Stage 1 result — filters extracted',
  );

  // ── Stage 2: Filtered search ─────────────────────────────────────────────────
  const fitPreference = input.user_profile.fitPreference ?? null;
  const brand = input.brand ?? null;

  logger.info(
    {
      query: intent.semantic_query,
      filters: summarizeFilters(intent),
      brand: brand ?? 'none',
      fitPreference: fitPreference ?? 'none',
    },
    '[RecEng] ─── Stage 2: Filtered vector search — query: "' + intent.semantic_query + '"',
  );

  const { rows: rawRows, searchMode } = await runFilteredSearch(intent, excludeIds, excludeHandleIds, limit, brand, fitPreference);

  logger.info(
    { recall_count: rawRows.length, search_mode: searchMode },
    '[RecEng] Stage 2 recall complete',
  );

  if (rawRows.length === 0) {
    logger.info('[RecEng] Stage 2 returned 0 rows — returning empty result');
    return buildEmptyResult(intent, recipientCtx, genderFilterUsed, profileUsed);
  }

  // ── Stage 2: Scoring ─────────────────────────────────────────────────────────
  const colorsSuited = input.user_profile.colorsSuited ?? null;
  const scoredAll = rawRows.map((row) =>
    computeScore(row, intent, { rawUserQuery: input.user_query, colorsSuited }),
  );
  scoredAll.sort((a, b) => b.final_score - a.final_score);

  // Deduplicate by config id when present (one SKU per style/config); else fall back to handleId.
  const seenKeys = new Set<string>();
  const scored = scoredAll.filter((s) => {
    const key = dedupeKeyFromProduct(s.componentTags, s.handleId);
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  logger.info(
    {
      top_results: scored.slice(0, 8).map((s) => ({
        id: s.id,
        name: s.name.slice(0, 50),
        similarity: s.similarity.toFixed(3),
        tag_bonus: s.tag_match_bonus.toFixed(2),
        final_score: s.final_score.toFixed(3),
      })),
    },
    '[RecEng] Stage 2 scoring — top results',
  );

  // Filter by threshold BEFORE reranking so the reranker only sees quality candidates
  let candidateSet = scored.filter((s) => s.final_score > SCORE_THRESHOLD);
  let usedFallback = false;

  if (candidateSet.length === 0) {
    logger.info(
      { threshold: SCORE_THRESHOLD, best_score: scored[0]?.final_score?.toFixed(3) ?? 'n/a' },
      '[RecEng] No results above primary threshold — trying fallback threshold',
    );
    const fallback = scored.filter((s) => s.final_score > FALLBACK_THRESHOLD).slice(0, 1);
    if (fallback.length > 0) {
      candidateSet = fallback;
      usedFallback = true;
      logger.info(
        { fallback_score: fallback[0]!.final_score.toFixed(3), fallback_name: fallback[0]!.name },
        '[RecEng] Using single fallback result',
      );
    } else {
      logger.info(
        { best_score: scored[0]?.final_score?.toFixed(3) ?? 'n/a' },
        '[RecEng] No results above fallback threshold either — returning empty',
      );
      return buildEmptyResult(intent, recipientCtx, genderFilterUsed, profileUsed);
    }
  }

  // ── Stage 2b: Rerank quality candidates ──────────────────────────────────────
  const rerankQuery = (intent.semantic_query || input.user_query).trim();
  const intentContext = buildRerankContext(intent, recipientCtx);

  const reranked = usedFallback
    ? candidateSet
    : (await openaiRerankByQuery(
        rerankQuery,
        candidateSet,
        buildProductSummary,
        undefined,
        intentContext,
      )) ?? candidateSet;

  const finalSet = reranked.slice(0, limit);

  // ── Stage 3: Format output ───────────────────────────────────────────────────
  const results: RecommendedProduct[] = finalSet.map((s) => ({
    id: s.id,
    handleId: s.handleId,
    name: s.name,
    brand: s.brand,
    type: s.generalTag,
    subCategory: String(s.componentTags.subCategory ?? ''),
    colors: s.colors,
    imageUrl: s.imageUrl,
    productLink: s.productLink,
    skuId: skuIdFromComponentTags(s.componentTags),
    configId: configIdFromComponentTags(s.componentTags),
    dedupeKey: dedupeKeyFromProduct(s.componentTags, s.handleId),
    relevance_score: Math.round(s.final_score * 1000) / 1000,
    match_reason: s.match_reason,
  }));

  const result: RecommendationResult = {
    query_understood_as: intent.semantic_query,
    shopping_context: {
      shopping_for: recipientCtx.shopping_for,
      recipient: recipientCtx.recipient_relationship ?? null,
      gender_filter_used: genderFilterUsed,
      profile_used: profileUsed,
    },
    filters_applied: {
      legacyCategory: intent.legacyCategory,
      subCategory: intent.subCategory,
      type: intent.type,
      gender: intent.gender,
      ageGroup: intent.ageGroup,
      colors: intent.colors,
      colorPalette: intent.colorPalette,
      occasion: intent.occasion,
      tags_must_include: intent.tags_must_include,
      tags_must_exclude: intent.tags_must_exclude,
      search_mode: searchMode,
    },
    results,
    result_count: results.length,
  };

  const uniqueDedupeKeys = new Set(results.map((r) => r.dedupeKey).filter(Boolean));

  logger.info(
    {
      ms: Date.now() - tStart,
      result_count: results.length,
      unique_dedupe_key_count: uniqueDedupeKeys.size,
      search_mode: searchMode,
      gender_filter: genderFilterUsed,
      profile_used: profileUsed,
      /** Dedupe is by `dedupeKey` (`cfg:configId` or fallback `hid:handleId`), not by handle alone. */
      recommended_items: results.map((r) => ({
        id: r.id,
        name: r.name.length > 100 ? `${r.name.slice(0, 100)}…` : r.name,
        configId: r.configId || null,
        skuId: r.skuId || null,
        dedupeKey: r.dedupeKey,
        relevance_score: r.relevance_score,
      })),
      top_result: results[0]
        ? {
            name: results[0].name,
            score: results[0].relevance_score,
            configId: results[0].configId || null,
            skuId: results[0].skuId || null,
            dedupeKey: results[0].dedupeKey,
          }
        : null,
    },
    '[RecEng] ═══ Recommendation engine complete ═══',
  );

  return result;
}

function buildEmptyResult(
  intent: ExtractedIntent,
  recipientCtx: RecipientContext,
  genderFilterUsed: string | null,
  profileUsed: boolean,
): RecommendationResult {
  return {
    query_understood_as: intent.semantic_query,
    shopping_context: {
      shopping_for: recipientCtx.shopping_for,
      recipient: recipientCtx.recipient_relationship ?? null,
      gender_filter_used: genderFilterUsed,
      profile_used: profileUsed,
    },
    filters_applied: {
      legacyCategory: intent.legacyCategory,
      subCategory: intent.subCategory,
      type: intent.type,
      gender: intent.gender,
      ageGroup: intent.ageGroup,
      colors: intent.colors,
      colorPalette: intent.colorPalette,
      occasion: intent.occasion,
      tags_must_include: intent.tags_must_include,
      tags_must_exclude: intent.tags_must_exclude,
    },
    results: [],
    result_count: 0,
  };
}
