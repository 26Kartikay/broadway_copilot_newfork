import * as fs from 'fs';
import * as path from 'path';
import type { ProductCategory } from '@prisma/client';
import { ProductCategory as ProductCategoryEnum } from '@prisma/client';
import {
  BULK_CATALOG_METADATA_KEY,
  inferLegacyCategoryFromVerticalDisplay,
  normalizeExtractedTagsWithTaxonomy,
  type CatalogTaxonomyIndex,
} from './catalogTaxonomy';
import { normalizeCsvImageUrl } from './visionImageUrl';
import type { ExtractedTags } from './types';

/**
 * Keys are logical roles; JSON values are the CSV column headers (must match export exactly).
 * Description-bulk row: id, barcode, name, description, primary_image_url, brand — e.g. `"skuId": "id"`, `"imageUrl": "primary_image_url"`.
 */
export interface BulkCatalogColumnMap {
  barcode?: string;
  /** Product title; if omitted, name is derived from skuId, description, or barcode. */
  name?: string;
  /** External SKU id from your sheet (stored in componentTags.csvSkuId). */
  skuId?: string;
  brand?: string;
  imageUrl?: string;
  productLink?: string;
  description?: string;
  legacyCategory?: string;
  subCategory?: string;
  productType?: string;
  gender?: string;
  ageGroup?: string;
  colors?: string;
  occasions?: string;
  style?: string;
  fit?: string;
  allTags?: string;
  shortDescription?: string;
  /** Free-text hint mapped through mapCategory() → ProductCategory enum */
  categoryHint?: string;
}

export interface BulkCatalogDefaults {
  brand?: string;
  category?: string;
  generalTag?: string;
}

export interface BulkCatalogMappingFile {
  columnMap: BulkCatalogColumnMap;
  defaults?: BulkCatalogDefaults;
  /**
   * Path to catalog taxonomy JSON (allowed values tree). Resolved relative to this mapping file’s directory.
   * When set, CSV tag cells are normalized to canonical taxonomy spelling and vertical names map to legacyCategory.
   */
  taxonomyPath?: string;
  /**
   * True when taxonomy lives in the same JSON file as `_bulkCatalog` (see `catalogTaxonomy.json`).
   */
  taxonomyInline?: boolean;
}

export function loadBulkCatalogMapping(filePath: string): BulkCatalogMappingFile {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Mapping file not found: ${resolved}`);
  }
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8')) as Record<string, unknown>;

  if (raw.columnMap && typeof raw.columnMap === 'object') {
    return raw as unknown as BulkCatalogMappingFile;
  }

  const embedded = raw[BULK_CATALOG_METADATA_KEY];
  if (
    embedded &&
    typeof embedded === 'object' &&
    !Array.isArray(embedded) &&
    'columnMap' in embedded &&
    (embedded as Record<string, unknown>).columnMap &&
    typeof (embedded as Record<string, unknown>).columnMap === 'object'
  ) {
    const bc = embedded as Record<string, unknown>;
    const taxonomyPath =
      typeof bc.taxonomyPath === 'string' && bc.taxonomyPath.trim() ? bc.taxonomyPath.trim() : undefined;
    const out: BulkCatalogMappingFile = {
      columnMap: bc.columnMap as BulkCatalogColumnMap,
      taxonomyInline: !taxonomyPath,
    };
    if (bc.defaults && typeof bc.defaults === 'object') {
      out.defaults = bc.defaults as BulkCatalogDefaults;
    }
    if (taxonomyPath) {
      out.taxonomyPath = taxonomyPath;
    }
    return out;
  }

  throw new Error(
    'Mapping JSON must have top-level { columnMap: { ... } } or { "_bulkCatalog": { columnMap, defaults? } } (see files/catalogTaxonomy.json).',
  );
}

function cell(row: Record<string, unknown>, header: string | undefined): string {
  if (!header?.trim()) return '';
  const v = row[header.trim()];
  if (v == null) return '';
  return String(v).trim();
}

export function splitCommaList(s: string): string[] {
  if (!s.trim()) return [];
  return s
    .split(/[,;|]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Same behaviour as scripts/importProducts mapCategory */
export function mapProductCategory(raw?: string | null): ProductCategory {
  if (!raw?.trim()) return ProductCategoryEnum.CLOTHING_FASHION;
  const compact = raw
    .trim()
    .toUpperCase()
    .replace(/\s*&\s*/g, '_')
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_');
  if ((Object.values(ProductCategoryEnum) as string[]).includes(compact)) {
    return compact as ProductCategory;
  }
  const lower = raw.toLowerCase();
  if (lower.includes('footwear') || lower.includes('shoe') || lower.includes('sneaker')) {
    return ProductCategoryEnum.FOOTWEAR;
  }
  if (lower.includes('bag') || lower.includes('luggage')) {
    return ProductCategoryEnum.BAGS_LUGGAGE;
  }
  if (lower.includes('jewel') || lower.includes('accessor')) {
    return ProductCategoryEnum.JEWELLERY_ACCESSORIES;
  }
  if (
    lower.includes('beauty') ||
    lower.includes('skincare') ||
    lower.includes('makeup') ||
    lower.includes('grooming')
  ) {
    return ProductCategoryEnum.BEAUTY_PERSONAL_CARE;
  }
  if (lower.includes('health') || lower.includes('wellness') || lower.includes('supplement')) {
    return ProductCategoryEnum.HEALTH_WELLNESS;
  }
  return ProductCategoryEnum.CLOTHING_FASHION;
}

export function rowToExtractedTags(
  row: Record<string, unknown>,
  mapping: BulkCatalogMappingFile,
  taxonomy?: CatalogTaxonomyIndex,
): ExtractedTags {
  const m = mapping.columnMap;
  const colorsRaw = cell(row, m.colors);
  const occRaw = cell(row, m.occasions);
  const raw: ExtractedTags = {
    legacyCategory: cell(row, m.legacyCategory) || null,
    subCategory: cell(row, m.subCategory) || null,
    productType: cell(row, m.productType) || null,
    gender: cell(row, m.gender) || null,
    ageGroup: cell(row, m.ageGroup) || null,
    colors: splitCommaList(colorsRaw),
    occasions: splitCommaList(occRaw),
    style: cell(row, m.style) || null,
    fit: cell(row, m.fit) || null,
    allTags: cell(row, m.allTags),
    shortDescription: cell(row, m.shortDescription) || null,
    formattedDescription: null,
  };
  return taxonomy ? normalizeExtractedTagsWithTaxonomy(raw, taxonomy) : raw;
}

export interface SeedRowProductInput {
  barcode: string;
  name: string;
  brand: string;
  category: ProductCategory;
  generalTag: string;
  imageUrl: string;
  productLink: string;
  searchDoc: string;
  componentTags: Record<string, unknown>;
  legacyCategory: string | null;
  subCategory: string | null;
  productType: string | null;
  allTags: string;
  colors: string[];
  occasions: string[];
  style: string | null;
  fit: string | null;
}

export function rowToSeedProductInput(
  row: Record<string, unknown>,
  mapping: BulkCatalogMappingFile,
  applyTags: boolean,
  taxonomy?: CatalogTaxonomyIndex,
): SeedRowProductInput | null {
  const m = mapping.columnMap;
  const defaults = mapping.defaults ?? {};
  const barcode = cell(row, m.barcode);
  if (!barcode) return null;

  const skuId = cell(row, m.skuId);
  const description = cell(row, m.description);
  const nameFromCsv = cell(row, m.name);
  const name =
    nameFromCsv ||
    (skuId ? `SKU ${skuId}` : '') ||
    (description ? description.replace(/\s+/g, ' ').trim().slice(0, 120) : '') ||
    `Product ${barcode}`;

  const brand = cell(row, m.brand) || defaults.brand || 'Unknown';
  const categoryHintRaw = cell(row, m.categoryHint);
  const categoryHintNorm = taxonomy?.normalize(categoryHintRaw) ?? categoryHintRaw.trim();

  let category = mapProductCategory(defaults.category || 'CLOTHING_FASHION');
  if (categoryHintRaw.trim()) {
    const fromVertical = inferLegacyCategoryFromVerticalDisplay(categoryHintNorm);
    if (fromVertical) {
      category = mapProductCategory(fromVertical);
    } else {
      category = mapProductCategory(categoryHintNorm || categoryHintRaw);
    }
  }

  const generalTag = defaults.generalTag || 'Product';
  const imageUrl = normalizeCsvImageUrl(cell(row, m.imageUrl));
  const productLink = cell(row, m.productLink);

  const tags = rowToExtractedTags(row, mapping, taxonomy);

  const componentTags: Record<string, unknown> = {
    ...(applyTags
      ? {
          gender: tags.gender,
          ageGroup: tags.ageGroup,
          shortDescription: tags.shortDescription,
        }
      : {}),
    csvDescription: description || undefined,
    ...(skuId ? { csvSkuId: skuId } : {}),
  };

  const parts: string[] = [];
  parts.push(name);
  parts.push(`Brand: ${brand}`);
  if (skuId) parts.push(`SKU: ${skuId}`);
  if (applyTags && tags.legacyCategory) {
    parts.push(`Category: ${tags.legacyCategory}`);
  }
  if (description) parts.push(description.slice(0, 500));
  const searchDoc = parts.join('. ') || name;

  return {
    barcode,
    name,
    brand,
    category,
    generalTag,
    imageUrl,
    productLink,
    searchDoc,
    componentTags,
    legacyCategory: applyTags ? tags.legacyCategory : null,
    subCategory: applyTags ? tags.subCategory : null,
    productType: applyTags ? tags.productType : null,
    allTags: applyTags ? tags.allTags : '',
    colors: applyTags ? tags.colors : [],
    occasions: applyTags ? tags.occasions : [],
    style: applyTags ? tags.style : null,
    fit: applyTags ? tags.fit : null,
  };
}
