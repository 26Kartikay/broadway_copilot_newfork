export interface UserProfile {
  gender?: string | null;        // 'MALE' | 'FEMALE' | 'OTHER'
  ageGroup?: string | null;      // 'ADULT' | 'TEEN' | 'SENIOR'
  preferences?: string[];
  colorSeason?: string | null;
  fitPreference?: string | null; // e.g. 'Slim' | 'Regular' | 'Oversized'
  colorsSuited?: string[] | null; // from ColorAnalysis.colors_suited
}

// ── Stage 0 output ──────────────────────────────────────────────────────────

export interface RecipientContext {
  shopping_for: 'self' | 'other' | 'unknown';
  recipient_gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
  recipient_age_group: 'ADULT' | 'TEEN' | 'SENIOR' | null;
  recipient_relationship: string | null;
  gift_context: boolean;
  confidence: 'high' | 'medium' | 'low';
}

// ── Stage 1 output ──────────────────────────────────────────────────────────

export interface ExtractedIntent {
  /** Matches ProductCategory enum: CLOTHING_FASHION | BEAUTY_PERSONAL_CARE | HEALTH_WELLNESS | JEWELLERY_ACCESSORIES | FOOTWEAR | BAGS_LUGGAGE */
  legacyCategory: string | null;
  /** e.g. "Foundations", "Ethnic Wear", "Mascaras" */
  subCategory: string | null;
  /** e.g. "Eyeliners", "Matte Liquid Foundation" — maps to generalTag column */
  type: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
  ageGroup: 'ADULT' | 'TEEN' | 'SENIOR' | null;
  colors: string[] | null;
  colorPalette: string | null;
  occasion: string | null;
  tags_must_include: string[];
  tags_must_exclude: string[];
  /** Clean version of the query, stripped of recipient context, used for embedding */
  semantic_query: string;
}

// ── Stage 2 internals ───────────────────────────────────────────────────────

export interface RawProductRow {
  id: string;
  handleId: string;
  name: string;
  brand: string;
  generalTag: string;
  colors: string[];
  imageUrl: string;
  productLink: string;
  componentTags: Record<string, unknown>;
  similarity: number;
}

export interface ScoredRow extends RawProductRow {
  final_score: number;
  tag_match_bonus: number;
  match_reason: string;
}

// ── Stage 3 output ──────────────────────────────────────────────────────────

export interface RecommendedProduct {
  id: string;
  handleId: string;
  name: string;
  brand: string;
  type: string;
  subCategory: string;
  colors: string[];
  imageUrl: string;
  productLink: string;
  /** One row per config; this is the SKU id for the chosen variant (`componentTags.csvSkuId`). */
  skuId: string;
  /** Style/config key for dedupe (`componentTags.csvConfigId`). */
  configId: string;
  /** Actual dedupe group: `cfg:*` when config present, else `hid:*`. */
  dedupeKey: string;
  relevance_score: number;
  match_reason: string;
}

export interface ShoppingContext {
  shopping_for: 'self' | 'other' | 'unknown';
  recipient: string | null;
  gender_filter_used: string | null;
  profile_used: boolean;
}

export interface RecommendationResult {
  query_understood_as: string;
  shopping_context: ShoppingContext;
  filters_applied: Record<string, unknown>;
  results: RecommendedProduct[];
  result_count: number;
}

// ── Engine input ────────────────────────────────────────────────────────────

export interface RecommendationEngineInput {
  user_query: string;
  user_profile: UserProfile;
  /** Explicit brand name — set only when the user names a specific brand. Applied as a hard SQL filter. */
  brand?: string | null;
  exclude_product_ids?: string[];
  exclude_handle_ids?: string[];
  limit?: number;
}
