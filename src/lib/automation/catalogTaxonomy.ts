import * as fs from 'fs';
import * as path from 'path';
import type { ExtractedTags } from './types';

/**
 * When present at the root of `catalogTaxonomy.json`, holds CSV `columnMap` / `defaults` so one file
 * is both the allowed-values tree and the bulk-sync mapping. Stripped before building the taxonomy index.
 */
export const BULK_CATALOG_METADATA_KEY = '_bulkCatalog';

/** Remove bulk-sync metadata so only vertical → attribute → values remain. */
export function stripBulkCatalogMetadataForTaxonomy(root: unknown): unknown {
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return root;
  const o = root as Record<string, unknown>;
  if (!(BULK_CATALOG_METADATA_KEY in o)) return root;
  const { [BULK_CATALOG_METADATA_KEY]: _, ...rest } = o;
  return rest;
}

/** Maps top-level taxonomy keys (e.g. "Clothing & Fashion") → Product.legacyCategory enum strings. */
const VERTICAL_DISPLAY_TO_LEGACY: Record<string, string> = {
  'clothing & fashion': 'CLOTHING_FASHION',
  'beauty & personal care': 'BEAUTY_PERSONAL_CARE',
  'health & wellness': 'HEALTH_WELLNESS',
  'jewellery & accessories': 'JEWELLERY_ACCESSORIES',
  'footwear': 'FOOTWEAR',
  'bags & luggage': 'BAGS_LUGGAGE',
};

/**
 * Collect every human-readable tag string from the taxonomy tree (array leaves, object keys,
 * nested objects like Color Shade). Used to canonicalize CSV cells (case/spacing).
 */
function collectCanonicalStrings(node: unknown, out: Map<string, string>): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    const c = node.trim();
    if (c) {
      const low = c.toLowerCase();
      if (!out.has(low)) out.set(low, c);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const x of node) collectCanonicalStrings(x, out);
    return;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const kk = k.trim();
      if (kk) {
        const low = kk.toLowerCase();
        if (!out.has(low)) out.set(low, kk);
      }
      collectCanonicalStrings(v, out);
    }
  }
}

export class CatalogTaxonomyIndex {
  constructor(private readonly canonicalByLower: Map<string, string>) {}

  /** Return canonical taxonomy spelling if known; otherwise return original trimmed value. */
  normalize(value: string): string {
    const t = value.trim();
    if (!t) return '';
    return this.canonicalByLower.get(t.toLowerCase()) ?? t;
  }

  normalizeList(values: string[]): string[] {
    return values.map((v) => this.normalize(v)).filter(Boolean);
  }
}

export function loadCatalogTaxonomyJson(filePath: string): CatalogTaxonomyIndex {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Catalog taxonomy file not found: ${resolved}`);
  }
  const root = JSON.parse(fs.readFileSync(resolved, 'utf8')) as unknown;
  const tree = stripBulkCatalogMetadataForTaxonomy(root);
  const m = new Map<string, string>();
  collectCanonicalStrings(tree, m);
  return new CatalogTaxonomyIndex(m);
}

export function inferLegacyCategoryFromVerticalDisplay(verticalDisplay: string): string | null {
  const key = verticalDisplay.trim().toLowerCase();
  return VERTICAL_DISPLAY_TO_LEGACY[key] ?? null;
}

export function normalizeExtractedTagsWithTaxonomy(
  tags: ExtractedTags,
  taxonomy: CatalogTaxonomyIndex,
): ExtractedTags {
  let legacy = tags.legacyCategory ? taxonomy.normalize(tags.legacyCategory) : null;
  const mapped = legacy ? inferLegacyCategoryFromVerticalDisplay(legacy) : null;
  if (mapped) legacy = mapped;

  const allTagsNorm = tags.allTags.trim()
    ? tags.allTags
        .split(/[,;|]/)
        .map((x) => taxonomy.normalize(x.trim()))
        .filter(Boolean)
        .join(', ')
    : '';

  return {
    legacyCategory: legacy,
    subCategory: tags.subCategory ? taxonomy.normalize(tags.subCategory) : null,
    productType: tags.productType ? taxonomy.normalize(tags.productType) : null,
    gender: tags.gender ? taxonomy.normalize(tags.gender) : null,
    ageGroup: tags.ageGroup ? taxonomy.normalize(tags.ageGroup) : null,
    colors: taxonomy.normalizeList(tags.colors),
    occasions: taxonomy.normalizeList(tags.occasions),
    style: tags.style ? taxonomy.normalize(tags.style) : null,
    fit: tags.fit ? taxonomy.normalize(tags.fit) : null,
    allTags: allTagsNorm,
    shortDescription: tags.shortDescription,
    formattedDescription: tags.formattedDescription,
  };
}

export function resolveTaxonomyFilePath(mappingFilePath: string, taxonomyPath: string): string {
  const p = taxonomyPath.trim();
  if (!p) throw new Error('taxonomyPath is empty');
  if (path.isAbsolute(p)) return p;
  return path.resolve(path.dirname(path.resolve(mappingFilePath)), p);
}
