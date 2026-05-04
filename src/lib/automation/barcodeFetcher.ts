import { logger } from '../../utils/logger';
import { broadwayApiConfig } from './config';
import type { BarcodeListItem, BarcodeListResponse } from './types';

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (broadwayApiConfig.apiKey) headers['Authorization'] = `Bearer ${broadwayApiConfig.apiKey}`;
  return headers;
}

async function fetchBarcodePage(page: number, limit: number): Promise<BarcodeListResponse> {
  const url = new URL(
    `${broadwayApiConfig.baseUrl}${broadwayApiConfig.barcodeEndpoint}`,
  );
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), broadwayApiConfig.pageSize * 300 + 5000);

  try {
    const res = await fetch(url.toString(), {
      headers: getHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status} fetching barcode page ${page}`);

    const data = (await res.json()) as Record<string, unknown>;

    const items = (
      Array.isArray(data['items'])
        ? data['items']
        : Array.isArray(data['data'])
          ? data['data']
          : Array.isArray(data['skus'])
            ? data['skus']
            : []
    ) as Record<string, unknown>[];

    const normalizedItems: BarcodeListItem[] = items.map(item => {
      const brand: string | undefined =
        typeof item['brand'] === 'string' ? item['brand'] : undefined;
      const category: string | undefined =
        typeof item['category'] === 'string' ? item['category'] : undefined;
      return {
        id: typeof item['id'] === 'number' ? item['id'] : Number(item['id'] ?? 0),
        barcode: String(item['barcode'] ?? item['sku'] ?? ''),
        name: String(item['name'] ?? item['article_name'] ?? ''),
        brand,
        category,
      };
    });

    const total = typeof data['total'] === 'number' ? data['total'] : normalizedItems.length;
    const pages =
      typeof data['pages'] === 'number'
        ? data['pages']
        : Math.ceil(total / limit);
    const hasNext =
      typeof data['has_next'] === 'boolean'
        ? data['has_next']
        : page < pages;

    return { items: normalizedItems, total, page, pages, has_next: hasNext };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export async function fetchAllBarcodes(
  onProgress?: (fetched: number, total: number) => void,
): Promise<BarcodeListItem[]> {
  const limit = broadwayApiConfig.pageSize;
  const all: BarcodeListItem[] = [];

  logger.info({ limit }, '[Automation] Starting barcode fetch from Broadway API');

  const firstPage = await fetchBarcodePage(1, limit);
  all.push(...firstPage.items);
  onProgress?.(all.length, firstPage.total);

  for (let page = 2; page <= firstPage.pages; page++) {
    try {
      const response = await fetchBarcodePage(page, limit);
      all.push(...response.items);
      onProgress?.(all.length, firstPage.total);

      // Avoid hammering the API
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), page },
        '[Automation] Failed to fetch barcode page — stopping early',
      );
      break;
    }
  }

  logger.info({ fetched: all.length, total: firstPage.total }, '[Automation] Barcode fetch complete');
  return all;
}
