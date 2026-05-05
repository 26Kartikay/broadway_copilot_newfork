import brandsJson from './brands.json';

/** One row in `brands.json` */
export interface BrandRecord {
  name: string;
  category: string;
  subCategory: string;
  description: string;
}

export interface BrandPublicView {
  name: string;
  category: string;
  subCategory: string;
  description: string;
}

const raw = brandsJson as unknown as BrandRecord[];
const brands: BrandRecord[] = raw.filter((b) => {
  if (!b || typeof b.name !== 'string') return false;
  if (typeof b.category !== 'string' || typeof b.subCategory !== 'string') return false;
  if (typeof b.description !== 'string') return false;
  return b.name.trim() && b.description.trim();
});

function norm(s: string): string {
  return s.toLowerCase().trim();
}

function tokens(s: string): string[] {
  return norm(s)
    .split(/[\s/,&|]+/)
    .map((t) => t.replace(/[^\w-]/g, ''))
    .filter((t) => t.length > 1);
}

function rowText(b: BrandRecord): string {
  return norm([b.name, b.category, b.subCategory, b.description].join(' '));
}

function toPublic(b: BrandRecord): BrandPublicView {
  return {
    name: b.name,
    category: b.category,
    subCategory: b.subCategory,
    description: b.description,
  };
}

function sortByName(a: BrandRecord, b: BrandRecord): number {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
}

function scoreQuery(b: BrandRecord, query: string): number {
  const q = norm(query);
  if (!q) return 0;
  let score = 0;
  if (norm(b.name) === q) score += 100;
  else if (norm(b.name).includes(q)) score += 60;
  const hay = rowText(b);
  if (hay.includes(q)) score += 25;
  for (const t of tokens(query)) {
    if (t.length < 2) continue;
    if (hay.includes(t)) score += 8;
  }
  return score;
}

export interface LookupBrandsInput {
  query?: string;
  category?: string;
  limit?: number;
}

/**
 * Returns Broadway brand facts from the static catalog.
 * - `query`: free-text match against name/category/subCategory/description
 * - `category`: filter to brands whose category contains this string (case-insensitive)
 * - `limit`: max results (default 8, max 24)
 */
export function lookupBrands(input: LookupBrandsInput): {
  brands: BrandPublicView[];
  guidance: string;
} {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 24);
  const query = (input.query ?? '').trim();
  const categoryFilter = (input.category ?? '').trim().toLowerCase();

  let pool = categoryFilter
    ? brands.filter((b) => norm(b.category).includes(categoryFilter) || norm(b.subCategory).includes(categoryFilter))
    : [...brands];

  if (query) {
    const scored = pool
      .map((b) => ({ b, s: scoreQuery(b, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || sortByName(a.b, b.b));
    pool = scored.map((x) => x.b);

    if (pool.length === 0) {
      const globalScored = brands
        .map((b) => ({ b, s: scoreQuery(b, query) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || sortByName(a.b, b.b));
      pool = globalScored.map((x) => x.b);
    }
    if (pool.length === 0) {
      pool = [...brands].sort(sortByName);
    }
  } else {
    pool = pool.sort(sortByName);
  }

  return {
    brands: pool.slice(0, limit).map(toPublic),
    guidance:
      'Use only the name, category, subCategory, and description returned here. Do not invent sales, revenue, market share, inventory, or any internal or confidential metrics. If asked for numbers or private company data, say you do not have that information.',
  };
}

/**
 * Returns all brand names whose category or subCategory matches the given style/category string.
 * Used to discover which brands cover a requested category before filtering the product catalog.
 */
export function getBrandNamesByCategory(categoryOrStyle: string): string[] {
  const q = norm(categoryOrStyle);
  return brands
    .filter((b) => norm(b.category).includes(q) || norm(b.subCategory).includes(q))
    .map((b) => b.name);
}

/** Returns a single brand record by exact name match (case-insensitive). */
export function getBrandByName(name: string): BrandPublicView | null {
  const q = norm(name);
  const found = brands.find((b) => norm(b.name) === q);
  return found ? toPublic(found) : null;
}
