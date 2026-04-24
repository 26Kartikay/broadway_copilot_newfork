import brandsJson from './brands.json';

export type BrandClassification = string;

/** One row in `brands.json` — only these three fields. */
export interface BrandRecord {
  name: string;
  description: string;
  /** Merchandising labels only, e.g. top_seller, trending, new, classic — not sales numbers */
  classification: BrandClassification[];
}

const raw = brandsJson as unknown as BrandRecord[];
const brands: BrandRecord[] = raw.filter((b) => {
  if (!b || typeof b.name !== 'string' || typeof b.description !== 'string') return false;
  if (!Array.isArray(b.classification)) return false;
  if (!b.name.trim() || !b.description.trim()) return false;
  return b.classification.every((c) => typeof c === 'string');
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
  return norm([b.name, ...(b.classification ?? []), b.description].join(' '));
}

export type BrandHighlight = 'trending' | 'top_sellers' | 'all';

export interface LookupBrandsInput {
  query?: string;
  highlight?: BrandHighlight;
  limit?: number;
}

export interface BrandPublicView {
  name: string;
  description: string;
  classification: BrandClassification[];
}

function toPublic(b: BrandRecord): BrandPublicView {
  return {
    name: b.name,
    description: b.description,
    classification: [...b.classification],
  };
}

function matchesHighlight(b: BrandRecord, highlight: BrandHighlight): boolean {
  if (highlight === 'all') return true;
  const cls = b.classification.map(norm);
  if (highlight === 'trending') {
    return cls.includes('trending');
  }
  if (highlight === 'top_sellers') {
    return cls.some((c) => c === 'top_seller' || c === 'topseller' || c === 'top-seller');
  }
  return true;
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

/**
 * Returns Broadway brand facts from the static catalog (merchandising copy only).
 */
export function lookupBrands(input: LookupBrandsInput): {
  brands: BrandPublicView[];
  highlight: BrandHighlight;
  guidance: string;
} {
  const highlight = input.highlight ?? 'all';
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 24);
  const query = (input.query ?? '').trim();

  let pool = brands.filter((b) => matchesHighlight(b, highlight));

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
    pool = [...pool].sort(sortByName);
  }

  const slice = pool.slice(0, limit).map(toPublic);

  return {
    brands: slice,
    highlight,
    guidance:
      'Use only the name, description, and classification returned here. Do not invent sales, revenue, market share, inventory, or any internal or confidential metrics. If asked for numbers or private company data, say you do not have that information.',
  };
}
