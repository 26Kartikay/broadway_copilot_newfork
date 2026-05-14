import { logger } from '../../utils/logger';
import { broadwayApiConfig } from './config';
import type { BroadwayApiProduct } from './types';

export interface RecentSkuResponse {
  success: boolean;
  data: {
    success: boolean;
    data: any[];
  };
}

/**
 * Fetches recent SKUs from Broadway API with strict field validation.
 * Captures products from the last N hours to populate the automation queue.
 */
export async function fetchRecentSkus(lookbackHours: number): Promise<BroadwayApiProduct[]> {
  const fields = broadwayApiConfig.recentSkusFields || 'id,name,barcode,description,primary_image_url,brand,category';
  const url = new URL(`${broadwayApiConfig.baseUrl}${broadwayApiConfig.recentSkusEndpoint}`);
  
  // Broadway API expects these params for the recent-limited endpoint
  url.searchParams.set('fields', fields);
  url.searchParams.set('hours', String(lookbackHours));
  url.searchParams.set('limit', '500');
  url.searchParams.set('offset', '0');

  logger.info({ url: url.toString(), lookbackHours }, '[RecentSkuFetcher] Fetching recent products');

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        ...(broadwayApiConfig.apiKey ? { 'Authorization': `Bearer ${broadwayApiConfig.apiKey}` } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Broadway API HTTP ${response.status}`);
    }

    const json = (await response.json()) as RecentSkuResponse;
    const items = json.data?.data || [];

    if (!Array.isArray(items)) {
      logger.error({ json }, '[RecentSkuFetcher] Unexpected API response shape');
      return [];
    }

    const validated: BroadwayApiProduct[] = [];
    let skipped = 0;

    for (const item of items) {
      // MANDATORY FIELDS CHECK (Strict Gatekeeper)
      const hasId = item.id != null;
      const hasBarcode = !!item.barcode;
      const hasName = !!item.name;
      const hasBrand = !!item.brand;
      const hasCategory = !!item.category;
      const hasImage = !!item.primary_image_url;

      if (hasId && hasBarcode && hasName && hasBrand && hasCategory && hasImage) {
        validated.push({
          id: Number(item.id),
          barcode: String(item.barcode),
          name: String(item.name),
          brand: String(item.brand),
          category: String(item.category),
          description: item.description ? String(item.description) : '',
          imageUrl: String(item.primary_image_url),
          productLink: `https://broadwaylive.in/products/${item.barcode}`, // Fallback deep link
        });
      } else {
        skipped++;
        logger.debug({ 
          skuId: item.id, 
          missing: { 
            barcode: !hasBarcode, 
            name: !hasName, 
            brand: !hasBrand, 
            category: !hasCategory, 
            image: !hasImage 
          } 
        }, '[RecentSkuFetcher] Skipping product due to missing mandatory fields');
      }
    }

    logger.info({ 
      fetched: items.length, 
      validated: validated.length, 
      skipped 
    }, '[RecentSkuFetcher] Fetch complete');

    return validated;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[RecentSkuFetcher] Fatal error');
    throw err;
  }
}
