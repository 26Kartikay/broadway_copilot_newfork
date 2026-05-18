import { z } from 'zod';

export const FlowTypeSchema = z.enum(['vibe_check', 'color_analysis', 'ask_ai', 'home']);
export const PlatformSchema = z.enum(['web', 'mobile']);

export const BaseEventSchema = z.object({
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
    char_count: z.number().int().nonnegative(),
    has_image_attachment: z.boolean(),
  }),
});

export const AnalyticsEventSchema = z.discriminatedUnion('eventName', [
  ImageUploadCompletedSchema,
  ImageUploadFailedSchema,
  AiAnalysisRequestedSchema,
  AiAnalysisCompletedSchema,
  AiAnalysisFailedSchema,
  StyleChatInitiatedSchema,
  StyleChatMessageSentSchema,
]);

export type AnalyticsEventInput = z.infer<typeof AnalyticsEventSchema>;
