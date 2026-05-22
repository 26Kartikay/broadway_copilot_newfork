import { z } from 'zod';

export const FlowTypeSchema = z.enum(['vibe_check', 'color_analysis', 'ask_ai', 'home']);
export const PlatformSchema = z.enum(['web', 'mobile']);
export const ScoreBandSchema = z.enum(['low', 'mid', 'high']);
export const RecoSourceSchema = z.enum(['vector', 'ilike', 'ilike_relaxed']);

export type FlowType = z.infer<typeof FlowTypeSchema>;
export type ScoreBand = z.infer<typeof ScoreBandSchema>;
export type RecoSource = z.infer<typeof RecoSourceSchema>;

/** Map a 0–1 relevance/similarity score to analytics score_band. */
export function scoreBandFromScore(score: number): ScoreBand {
  if (score > 0.8) return 'high';
  if (score > 0.5) return 'mid';
  return 'low';
}

/** Normalize recommendation-engine / catalog search_mode to reco_source. */
export function recoSourceFromSearchMode(searchMode: string | undefined): RecoSource {
  if (!searchMode) return 'vector';
  if (searchMode.startsWith('vector')) {
    if (searchMode === 'vector_relaxed' || searchMode === 'vector_bare_minimum') return 'ilike_relaxed';
    return 'vector';
  }
  if (searchMode.includes('relaxed') || searchMode === 'ilike_fallback') return 'ilike_relaxed';
  return 'ilike';
}

export const BaseEventSchema = z.object({
  /** Client app user id (ChatRequest.userId / User.appUserId), not the internal Prisma cuid. */
  userId: z.string().optional(),
  sessionId: z.string().uuid(),
  vibeSessionId: z.string().uuid(),
  flowType: FlowTypeSchema,
  platform: PlatformSchema.optional().default('web'),
  timestamp: z.string().datetime().optional(),
});

export const ImageUploadCompletedSchema = BaseEventSchema.extend({
  eventName: z.literal('image_upload_completed'),
  properties: z.object({
    image_count: z.number().int().min(1),
    upload_duration_ms: z.number().int().nonnegative(),
    file_size_kb: z.number().nonnegative(),
  }),
});

export const ImageUploadFailedSchema = BaseEventSchema.extend({
  eventName: z.literal('image_upload_failed'),
  properties: z.object({
    error_type: z.string(),
    retry_count: z.number().int().nonnegative(),
  }),
});

export const AiAnalysisRequestedSchema = BaseEventSchema.extend({
  eventName: z.literal('ai_analysis_requested'),
  properties: z.object({
    model_version: z.string(),
    image_count: z.number().int().min(0),
    user_text_included: z.boolean(),
  }),
});

export const AiAnalysisCompletedSchema = BaseEventSchema.extend({
  eventName: z.literal('ai_analysis_completed'),
  properties: z.object({
    model_version: z.string(),
    latency_ms: z.number().int().nonnegative(),
    score_overall: z.number().min(0).max(100),
    score_drip_fit: z.number().min(0).max(100),
    score_hair_skin: z.number().min(0).max(100),
    score_accessories: z.number().min(0).max(100),
    palette_name: z.string().optional(),
    top_colors: z.array(z.string()).optional(),
  }),
});

export const AiAnalysisFailedSchema = BaseEventSchema.extend({
  eventName: z.literal('ai_analysis_failed'),
  properties: z.object({
    error_code: z.string(),
    retry_attempted: z.boolean(),
    latency_ms: z.number().int().nonnegative(),
  }),
});

export const RecoShelfTriggeredSchema = BaseEventSchema.extend({
  eventName: z.literal('reco_shelf_triggered'),
  properties: z.object({
    product_ids: z.array(z.string()),
    reco_source: RecoSourceSchema,
    score_band: ScoreBandSchema,
    palette_name: z.string().optional(),
  }),
});

export const ProductClickedSchema = BaseEventSchema.extend({
  eventName: z.literal('product_clicked'),
  properties: z.object({
    product_id: z.string(),
    reco_source: RecoSourceSchema,
    palette_name: z.string().optional(),
    score_band: ScoreBandSchema,
    price: z.number().nonnegative().optional(),
    discount_pct: z.number().min(0).max(100).optional(),
  }),
});

export const OrderCompletedSchema = BaseEventSchema.extend({
  eventName: z.literal('order_completed'),
  properties: z.object({
    order_id: z.string(),
    product_ids: z.array(z.string()),
    reco_source: RecoSourceSchema,
    gmv: z.number().nonnegative(),
    hours_since_analysis: z.number().nonnegative().optional(),
  }),
});

export const StyleChatInitiatedSchema = BaseEventSchema.extend({
  eventName: z.literal('style_chat_initiated'),
  properties: z.object({
    entry_flow: FlowTypeSchema,
    has_prior_result: z.boolean(),
  }),
});

export const StyleChatMessageSentSchema = BaseEventSchema.extend({
  eventName: z.literal('style_chat_message_sent'),
  properties: z.object({
    message_index: z.number().int().nonnegative(),
    entry_flow: FlowTypeSchema,
    char_count: z.number().int().nonnegative(),
    has_image_attachment: z.boolean(),
  }),
});

export const StyleChatResponseReceivedSchema = BaseEventSchema.extend({
  eventName: z.literal('style_chat_response_received'),
  properties: z.object({
    latency_ms: z.number().int().nonnegative(),
    response_included_products: z.boolean(),
    product_ids: z.array(z.string()),
  }),
});

export const AnalyticsEventSchema = z.discriminatedUnion('eventName', [
  ImageUploadCompletedSchema,
  ImageUploadFailedSchema,
  AiAnalysisRequestedSchema,
  AiAnalysisCompletedSchema,
  AiAnalysisFailedSchema,
  RecoShelfTriggeredSchema,
  ProductClickedSchema,
  OrderCompletedSchema,
  StyleChatInitiatedSchema,
  StyleChatMessageSentSchema,
  StyleChatResponseReceivedSchema,
]);

export type AnalyticsEventInput = z.infer<typeof AnalyticsEventSchema>;
