import type { Product } from '@prisma/client';
import type { BroadwayApiProduct, ExtractedTags } from './types';

/** Reconstruct taxonomy fields already stored on Product / componentTags (no LLM). */
export function prismaProductToExtractedTags(p: Product): ExtractedTags {
  const ct = (p.componentTags as Record<string, unknown>) || {};
  const colorsFromCt = Array.isArray(ct['colors']) ? (ct['colors'] as string[]) : [];
  const occFromCt = Array.isArray(ct['occasions']) ? (ct['occasions'] as string[]) : [];
  return {
    legacyCategory: p.legacyCategory,
    subCategory: p.subCategory,
    productType: p.productType,
    gender: typeof ct['gender'] === 'string' ? ct['gender'] : null,
    ageGroup: typeof ct['ageGroup'] === 'string' ? ct['ageGroup'] : null,
    colors: p.colors?.length ? p.colors : colorsFromCt,
    occasions: p.occasions?.length ? p.occasions : occFromCt,
    style: p.style,
    fit: p.fit,
    allTags: p.allTags ?? '',
    shortDescription: typeof ct['shortDescription'] === 'string' ? ct['shortDescription'] : null,
    formattedDescription:
      typeof p.llmDescription === 'string' && p.llmDescription.trim()
        ? p.llmDescription
        : typeof ct['formattedDescription'] === 'string'
          ? ct['formattedDescription']
          : null,
  };
}

/** Shape used by tagExtractor + buildSearchDoc (same as Broadway API normalizer output). */
export function prismaProductToBroadwayShape(p: Product): BroadwayApiProduct {
  const ct = (p.componentTags as Record<string, unknown>) || {};
  const desc =
    typeof ct['csvDescription'] === 'string'
      ? ct['csvDescription']
      : typeof ct['description'] === 'string'
        ? ct['description']
        : undefined;
  return {
    id: 0,
    barcode: p.barcode ?? '',
    name: p.name,
    brand: p.brand,
    category: p.legacyCategory ?? undefined,
    description: desc,
    imageUrl: p.imageUrl || undefined,
    productLink: p.productLink || undefined,
  };
}
