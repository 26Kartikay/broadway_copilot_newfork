export const automationConfig = {
  enabled: process.env.PRODUCT_AUTOMATION_ENABLED !== 'false',
  concurrency: parseInt(process.env.PRODUCT_AUTOMATION_CONCURRENCY ?? '10', 10),
  batchSize: parseInt(process.env.PRODUCT_AUTOMATION_BATCH_SIZE ?? '100', 10),
  maxPerRun: parseInt(process.env.PRODUCT_AUTOMATION_MAX_PER_RUN ?? '1000', 10),
  timeoutMs: parseInt(process.env.PRODUCT_AUTOMATION_TIMEOUT_MS ?? '30000', 10),
  retryAttempts: parseInt(process.env.PRODUCT_AUTOMATION_RETRY_ATTEMPTS ?? '3', 10),
  skipEmbedded: process.env.PRODUCT_AUTOMATION_SKIP_EMBEDDED !== 'false',
};

export const barcodeConfig = {
  syncEnabled: process.env.BARCODE_SYNC_ENABLED !== 'false',
  batchSize: parseInt(process.env.BARCODE_SYNC_BATCH_SIZE ?? '500', 10),
  maxRetries: parseInt(process.env.BARCODE_SYNC_MAX_RETRIES ?? '3', 10),
  timeoutMs: parseInt(process.env.BARCODE_SYNC_TIMEOUT_MS ?? '30000', 10),
};

export const openAiAutomationConfig = {
  /** Vision + JSON tagging (default gpt-4o-mini). Override with OPENAI_TAG_MODEL. */
  tagModel: process.env.OPENAI_TAG_MODEL ?? 'gpt-4o-mini',
  /**
   * auto (default): send image URL to OpenAI when it looks like jpeg/png/gif/webp; otherwise fetch+JPEG first.
   * On “unsupported image”, retry once with server-fetched JPEG (fixes AVIF / CDN quirks).
   * always_fetch: always fetch and send JPEG base64 (slowest; use if CDN blocks OpenAI’s fetch).
   */
  visionImageMode: (process.env.OPENAI_VISION_IMAGE_MODE ?? 'auto') as 'auto' | 'always_fetch',
};

export const broadwayApiConfig = {
  baseUrl: (process.env.BROADWAY_LIVE_API_BASE ?? 'https://api.broadwaylive.in').replace(/\/$/, ''),
  /** Optional; omit from requests when empty (sku-details-limited is often public). */
  apiKey: process.env.BROADWAY_LIVE_API_KEY ?? '',
  barcodeEndpoint: process.env.BROADWAY_LIVE_BARCODE_ENDPOINT ?? '/product_service/v1/skus/list',
  recentSkusEndpoint: process.env.BROADWAY_LIVE_RECENT_SKUS_ENDPOINT ?? '/product_service/v1/skus/sku-variants-recent-limited',
  /** Fields requested for recent SKUs fetch */
  recentSkusFields: 'id,name,barcode,description,primary_image_url,brand,category',
  /** How far back to look in hours (e.g., 3 hours for a 2-hour cron) */
  recentSkusLookbackHours: parseInt(process.env.BROADWAY_LIVE_LOOKBACK_HOURS ?? '3', 10),
  /** Path segment before barcode, e.g. sku-details-limited → .../skus/sku-details-limited/{barcode} */
  skuDetailSegment:
    process.env.BROADWAY_LIVE_SKU_DETAIL_SEGMENT ?? 'sku-details-limited',
  pageSize: parseInt(process.env.BROADWAY_LIVE_PAGE_SIZE ?? '100', 10),
};

export const cronConfig = {
  productTaggerSchedule: process.env.CRON_PRODUCT_TAGGER_SCHEDULE ?? '0 2 * * *',
  recentProductSyncSchedule: process.env.CRON_RECENT_PRODUCT_SYNC_SCHEDULE ?? '0 */2 * * *',
  productTaggerEnabled: process.env.CRON_PRODUCT_TAGGER_ENABLED !== 'false',
  barcodeSyncSchedule: process.env.CRON_BARCODE_SYNC_SCHEDULE ?? '0 1 * * *',
  barcodeSyncEnabled: process.env.CRON_BARCODE_SYNC_ENABLED !== 'false',
  /** Daily job: delete ServiceLog + ApiRequestLog older than LOG_RETENTION_DAYS (default 7). */
  logPurgeSchedule: process.env.CRON_LOG_PURGE_SCHEDULE ?? '15 3 * * *',
  logPurgeEnabled: process.env.CRON_LOG_PURGE_ENABLED !== 'false',
  logRetentionDays: Math.min(
    365,
    Math.max(1, parseInt(process.env.LOG_RETENTION_DAYS ?? '7', 10) || 7),
  ),
};
