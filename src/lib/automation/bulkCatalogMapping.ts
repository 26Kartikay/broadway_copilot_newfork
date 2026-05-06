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

/** CSV header name, or ordered alternates (first column with a non-empty cell wins). */
export type CsvHeaderSpec = string | string[];

/**
 * Keys are logical roles; values are header name(s) — must match the CSV header row (after trim).
 * Typical bulk row: id, barcode, name, description, primary_image_url, brand — e.g. `"skuId": "id"`.
 */
export interface BulkCatalogColumnMap {
  barcode?: CsvHeaderSpec;
  /** Product title; if omitted, name is derived from skuId, description, or barcode. */
  name?: CsvHeaderSpec;
  /** External SKU id from your sheet (stored in componentTags.csvSkuId). */
  skuId?: CsvHeaderSpec;
  /**
   * Style/config group id — multiple SKUs can share one value.
   * Stored as componentTags.csvConfigId for deduping recommendations to one SKU per config.
   */
  configId?: CsvHeaderSpec;
  brand?: CsvHeaderSpec;
  imageUrl?: CsvHeaderSpec;
  productLink?: CsvHeaderSpec;
  description?: CsvHeaderSpec;
  legacyCategory?: CsvHeaderSpec;
  subCategory?: CsvHeaderSpec;
  productType?: CsvHeaderSpec;
  gender?: CsvHeaderSpec;
  ageGroup?: CsvHeaderSpec;
  colors?: CsvHeaderSpec;
  occasions?: CsvHeaderSpec;
  style?: CsvHeaderSpec;
  fit?: CsvHeaderSpec;
  allTags?: CsvHeaderSpec;
  shortDescription?: CsvHeaderSpec;
  /** Free-text hint mapped through mapCategory() → ProductCategory enum */
  categoryHint?: CsvHeaderSpec;
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
   * When true, `Product.brand` comes only from the CSV column(s) in `columnMap.brand` (plus `defaults.brand`);
   * description/title heuristics are not used. Use for feeds like `brand_name` only.
   */
  csvBrandOnly?: boolean;
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
    if (bc.csvBrandOnly === true) {
      out.csvBrandOnly = true;
    }
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

export function barcodeColumnSpecified(spec: CsvHeaderSpec | undefined): boolean {
  if (spec == null) return false;
  if (typeof spec === 'string') return spec.trim().length > 0;
  return spec.some((s) => typeof s === 'string' && s.trim().length > 0);
}

function normalizeHeaderKey(key: string): string {
  return key.replace(/^\uFEFF/, '').trim().toLowerCase();
}

/** Collapse spaces/hyphens/underscores — matches `SKU Id` ↔ `SKU_ID`. */
function normalizeHeaderFlex(key: string): string {
  return normalizeHeaderKey(key).replace(/[\s\-_]+/g, '');
}

/** First matching column (exact header); then case-insensitive; then flexible (SKU_Id vs SKU ID). */
export function cell(row: Record<string, unknown>, header: CsvHeaderSpec | undefined): string {
  if (header == null) return '';
  const keys = Array.isArray(header) ? header : [header];
  const stringKeys = keys.filter((raw): raw is string => typeof raw === 'string' && raw.trim().length > 0);
  for (const raw of stringKeys) {
    const k = raw.replace(/^\uFEFF/, '').trim();
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  const want = new Set(stringKeys.map((raw) => normalizeHeaderKey(raw)));
  if (want.size === 0) return '';
  for (const rk of Object.keys(row)) {
    if (!want.has(normalizeHeaderKey(rk))) continue;
    const v = row[rk];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  const flexWant = new Set(stringKeys.map((raw) => normalizeHeaderFlex(raw)));
  for (const rk of Object.keys(row)) {
    if (!flexWant.has(normalizeHeaderFlex(rk))) continue;
    const v = row[rk];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/**
 * Prefer human-readable copy after embedded HTML/CSS blobs (many PDP exports prepend `.desc-* {`).
 * Used for deriving display name when title/sku columns are blank.
 */
export function sanitizeDescriptionForProductText(raw: string): string {
  let s = (raw ?? '').replace(/\r\n/g, '\n').trim();
  if (!s) return '';
  s = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '\n');

  const kickIdx = s.search(
    /\n(?:This\b|These\b|Introducing\b|Overview\b|Precision-crafted\b|Key\s+Highlights\b|Ingredients\b)/im,
  );
  if (kickIdx >= 0) {
    const cut = s.slice(kickIdx + 1).trim();
    if (cut.length >= 12) return cut;
  }

  const lines = s.split('\n');
  const proseStartIdx = lines.findIndex((line) => {
    const t = line.trim();
    if (t.length < 16) return false;
    if (t.startsWith('.')) return false;
    if (/^[{};\s:*\-]+$/.test(t)) return false;
    if (/^[.#][\w-]+\s*[,\s]*\{/.test(t)) return false;
    return true;
  });
  if (proseStartIdx >= 0) {
    const cut = lines.slice(proseStartIdx).join('\n').trim();
    if (cut.length >= 24) return cut;
  }

  return s.trim();
}

/** Trim stray punctuation from heuristic captures */
function tidyCapturedBrand(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'([{:-]+/, '')
    .replace(/[\s"')\]}:]+$/g, '')
    .trim();
}

/**
 * When CSV brand is empty/missing, derive from typical merchandising patterns
 * ("Rareism Women's ...", "... from RAREISM ...", "... by Vendor ...").
 */
export function inferBrandFromNameAndDescription(name: string, description: string): string {
  const n = sanitizeDescriptionForProductText((name || '').trim()) || (name || '').trim();

  let m = /^\s*([A-Za-z0-9][A-Za-z0-9&.'\-\s]{1,54}?)\s+women'?s\b/i.exec(n);
  if (m?.[1]) return tidyCapturedBrand(m[1]);
  m = /^\s*([A-Za-z0-9][A-Za-z0-9&.'\-\s]{1,54}?)\s+men'?s\b/i.exec(n);
  if (m?.[1]) return tidyCapturedBrand(m[1]);

  const d = sanitizeDescriptionForProductText(description || '') || (description || '');

  m = /\bIntroducing\s+([A-Za-z0-9]{2,32})\b/i.exec(d);
  if (m?.[1]) return tidyCapturedBrand(m[1]);

  m = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+ISO\b/im.exec(d.trim());
  if (m?.[1]) return tidyCapturedBrand(m[1]);

  const fromVerb =
    /\bfrom\s+([A-Za-z0-9][A-Za-z0-9&.'\-\s]{0,52}?)\s+(?:delivers|brings|combines|features|offers|creates|provides|give|present|shows|carries|comes|crafted|stands|embodies)\b/i;
  m = fromVerb.exec(d);
  if (m?.[1]) {
    const cand = tidyCapturedBrand(m[1]);
    if (cand.length >= 2 && !/^(the|this|these|those|your|our|a|an)\b/i.test(cand)) return cand;
  }

  m = /\bfrom\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/.exec(d);
  if (m?.[1]) return tidyCapturedBrand(m[1]);
  m = /\bfrom\s+([A-Z]{2,35})\b/.exec(d);
  if (m?.[1]) return tidyCapturedBrand(m[1]);
  m = /\bfrom\s+([A-Z][a-z]{1,34})\b/.exec(d);
  if (m?.[1]) return tidyCapturedBrand(m[1]);
  m =
    /\bfrom\s+([a-z][a-z]+)\s+(?:delivers|brings|offers|carries|shows)\b/i.exec(d);
  if (m?.[1]) {
    const w = tidyCapturedBrand(m[1]);
    if (w.length >= 2) return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }
  m = /\bby\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,4})\b/.exec(d);
  if (m?.[1]) return tidyCapturedBrand(m[1]);

  return '';
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
  const configId = cell(row, m.configId);
  const descriptionRaw = cell(row, m.description);
  const description = sanitizeDescriptionForProductText(descriptionRaw);
  const nameFromCsvRaw = cell(row, m.name);
  const nameFromCsv = sanitizeDescriptionForProductText(nameFromCsvRaw) || nameFromCsvRaw.trim();
  const name =
    nameFromCsv ||
    (skuId ? `SKU ${skuId}` : '') ||
    (description ? description.replace(/\s+/g, ' ').trim().slice(0, 120) : '') ||
    `Product ${barcode}`;

  const csvBrand = cell(row, m.brand).trim();
  const defaultBrand = (defaults.brand ?? '').trim();
  let brand =
    csvBrand && !/^unknown$/i.test(csvBrand)
      ? csvBrand
      : mapping.csvBrandOnly
        ? ''
        : inferBrandFromNameAndDescription(name, description || descriptionRaw);
  if (!brand?.trim()) {
    brand = defaultBrand && !/^unknown$/i.test(defaultBrand) ? defaultBrand : 'Unknown';
  }
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
    csvDescription: descriptionRaw || undefined,
    ...(skuId ? { csvSkuId: skuId } : {}),
    ...(configId ? { csvConfigId: configId } : {}),
  };

  const parts: string[] = [];
  parts.push(name);
  parts.push(`Brand: ${brand}`);
  if (configId) parts.push(`Config: ${configId}`);
  if (skuId) parts.push(`SKU: ${skuId}`);
  if (applyTags && tags.legacyCategory) {
    parts.push(`Category: ${tags.legacyCategory}`);
  }
  const searchDesc = description || descriptionRaw;
  if (searchDesc) parts.push(searchDesc.slice(0, 500));
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
