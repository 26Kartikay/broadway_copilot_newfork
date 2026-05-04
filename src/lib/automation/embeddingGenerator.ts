import OpenAI from 'openai';
import { logger } from '../../utils/logger';
import type { BroadwayApiProduct, ExtractedTags } from './types';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIM = 1536;

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

export function buildSearchDoc(product: BroadwayApiProduct, tags: ExtractedTags): string {
  if (tags.formattedDescription?.trim()) {
    return tags.formattedDescription.trim().slice(0, 8000);
  }

  const parts: string[] = [];

  if (product.name) parts.push(product.name);
  if (product.brand) parts.push(`Brand: ${product.brand}`);
  if (tags.legacyCategory) parts.push(`Category: ${tags.legacyCategory}`);
  if (tags.subCategory) parts.push(`Subcategory: ${tags.subCategory}`);
  if (tags.productType) parts.push(`Type: ${tags.productType}`);
  if (tags.gender) parts.push(`Gender: ${tags.gender}`);
  if (tags.ageGroup) parts.push(`Age Group: ${tags.ageGroup}`);
  if (tags.colors.length) parts.push(`Colors: ${tags.colors.join(', ')}`);
  if (tags.occasions.length) parts.push(`Occasions: ${tags.occasions.join(', ')}`);
  if (tags.style) parts.push(`Style: ${tags.style}`);
  if (tags.fit) parts.push(`Fit: ${tags.fit}`);
  if (tags.allTags) parts.push(`Tags: ${tags.allTags}`);
  if (tags.shortDescription) parts.push(tags.shortDescription);
  if (product.description) parts.push(product.description.slice(0, 300));

  return parts.join('. ') || product.name || `Product ${product.barcode}`;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const res = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000),
  });
  const first = res.data[0];
  if (!first) throw new Error('Empty embedding response');
  return first.embedding;
}

export async function generateEmbeddingWithRetry(text: string, maxRetries = 3): Promise<number[]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await generateEmbedding(text);
    } catch (err) {
      lastErr = err;
      logger.warn(
        { attempt, maxRetries, err: err instanceof Error ? err.message : String(err) },
        '[Automation] Embedding attempt failed, retrying',
      );
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
  throw lastErr;
}
