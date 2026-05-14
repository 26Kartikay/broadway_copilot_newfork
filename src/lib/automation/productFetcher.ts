import { logger } from '../../utils/logger';
import { broadwayApiConfig } from './config';
import type { BroadwayApiProduct } from './types';

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (broadwayApiConfig.apiKey) headers['Authorization'] = `Bearer ${broadwayApiConfig.apiKey}`;
  return headers;
}

/** Walk nested { data: { data: { ... product }}} envelopes until a product-like object appears. */
function unwrapProductPayload(root: Record<string, unknown>): Record<string, unknown> | null {
  if (root['success'] === false) return null;

  let node: unknown = root;
  for (let depth = 0; depth < 8; depth++) {
    if (!node || typeof node !== 'object') return null;
    const o = node as Record<string, unknown>;
    // APIs often return barcode as JSON number; accept string | number.
    const hasSku =
      typeof o['barcode'] === 'string' ||
      typeof o['barcode'] === 'number' ||
      typeof o['name'] === 'string' ||
      typeof o['id'] === 'number';
    if (hasSku && (o['barcode'] != null || o['name'] != null)) {
      return o;
    }
    const inner = o['data'];
    if (inner && typeof inner === 'object') {
      node = inner;
      continue;
    }
    return null;
  }
  return null;
}

function normalizeProduct(raw: Record<string, unknown>): BroadwayApiProduct {
  const category: string | undefined =
    typeof raw['category'] === 'string' ? raw['category'] : undefined;
  const description: string | undefined =
    typeof raw['description'] === 'string' ? raw['description'] : undefined;
  const imageUrl: string | undefined =
    typeof raw['imageUrl'] === 'string'
      ? raw['imageUrl']
      : typeof raw['image_url'] === 'string'
        ? raw['image_url']
        : typeof raw['primary_image_url'] === 'string'
          ? raw['primary_image_url']
          : undefined;
  const productLink: string | undefined =
    typeof raw['productLink'] === 'string'
      ? raw['productLink']
      : typeof raw['product_link'] === 'string'
        ? raw['product_link']
        : undefined;

  return {
    id: typeof raw['id'] === 'number' ? raw['id'] : Number(raw['id'] ?? 0),
    barcode: String(raw['barcode'] ?? raw['sku'] ?? ''),
    name: String(raw['name'] ?? raw['article_name'] ?? ''),
    brand: String(raw['brand'] ?? raw['brand_name'] ?? ''),
    category,
    description,
    imageUrl,
    productLink,
  };
}

export async function fetchProductByBarcode(
  barcode: string,
  timeoutMs = 30000,
): Promise<BroadwayApiProduct> {
  const segment = broadwayApiConfig.skuDetailSegment.replace(/^\/+|\/+$/g, '');
  const url = `${broadwayApiConfig.baseUrl}/product_service/v1/skus/${segment}/${encodeURIComponent(barcode)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      headers: getHeaders(),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (res.status === 404) {
      throw new Error(`Broadway SKU not in catalog (404) for barcode ${barcode}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Broadway API HTTP ${res.status} for barcode ${barcode}${body ? ` — ${body.slice(0, 240)}` : ''}`,
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    const product = unwrapProductPayload(data);
    if (!product) {
      throw new Error(
        `Broadway API response had no usable product payload for barcode ${barcode} (check JSON shape / success flag)`,
      );
    }
    return normalizeProduct(product);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Broadway API timeout for barcode ${barcode}`);
    }
    logger.error(
      { err: err instanceof Error ? err.message : String(err), barcode },
      '[Automation] Failed to fetch product from Broadway API',
    );
    throw err instanceof Error ? err : new Error(String(err));
  }
}
