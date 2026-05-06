import type { ExtractedIntent, RawProductRow, ScoredRow } from './types';

function getField(componentTags: Record<string, unknown>, key: string): string {
  return String(componentTags[key] ?? '').toLowerCase();
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'your',
  'this',
  'that',
  'some',
  'any',
  'you',
  'are',
  'was',
  'has',
  'have',
  'but',
  'not',
]);

function tokenizeForTitleMatch(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** True when catalog name overlaps the shopper query enough to call out a title match. */
export function productTitleMatchesSearch(name: string, ...queries: (string | undefined | null)[]): boolean {
  const n = (name ?? '').trim();
  if (!n) return false;
  const titleTok = new Set(tokenizeForTitleMatch(n));
  if (titleTok.size === 0) return false;
  const lowerName = n.toLowerCase();

  for (const raw of queries) {
    const q = (raw ?? '').trim();
    if (q.length < 2) continue;
    const lowerQ = q.toLowerCase();

    if (lowerName.length >= 4 && lowerQ.includes(lowerName)) return true;
    if (lowerQ.length >= 4 && lowerName.includes(lowerQ)) return true;

    const qTok = tokenizeForTitleMatch(q);
    let overlap = 0;
    for (const t of qTok) {
      if (titleTok.has(t)) overlap++;
    }
    if (overlap >= 2) return true;
  }
  return false;
}

/**
 * Compute final_score = (0.7 * vector_similarity) + (0.3 * tag_match_bonus)
 * tag_match_bonus = soft filter hits / total soft filters set (0–1)
 * Soft filters: occasion, colorPalette, ageGroup, colorsSuited (never hard filters)
 */
export function computeScore(
  row: RawProductRow,
  intent: ExtractedIntent,
  opts?: { rawUserQuery?: string; colorsSuited?: string[] | null },
): ScoredRow {
  const vectorSim = Math.max(0, Math.min(1, row.similarity));
  const allTags = getField(row.componentTags, 'allTags');

  const softChecks: Array<{ label: string; matched: boolean }> = [];

  if (intent.occasion) {
    const matched = allTags.includes(intent.occasion.toLowerCase());
    softChecks.push({ label: `occasion:${intent.occasion}`, matched });
  }

  if (intent.colorPalette) {
    const cp = getField(row.componentTags, 'colorPalette');
    const needle = intent.colorPalette.toLowerCase();
    const matched = cp.includes(needle) || needle.includes(cp);
    softChecks.push({ label: `palette:${intent.colorPalette}`, matched });
  }

  if (intent.ageGroup) {
    const ag = getField(row.componentTags, 'ageGroup');
    const matched = ag.includes(intent.ageGroup.toLowerCase()) || ag === 'n/a';
    softChecks.push({ label: `ageGroup:${intent.ageGroup}`, matched });
  }

  // Boost when product colors overlap with user's color-analysis suited colors
  if (opts?.colorsSuited && opts.colorsSuited.length > 0) {
    const productColors = row.colors.map((c) => c.toLowerCase());
    const suited = opts.colorsSuited.map((c) => c.toLowerCase());
    const matched = productColors.some((pc) => suited.some((sc) => pc.includes(sc) || sc.includes(pc)));
    softChecks.push({ label: 'suited_colors', matched });
  }

  const matchedSoft = softChecks.filter((c) => c.matched).length;
  const tag_match_bonus = softChecks.length > 0 ? matchedSoft / softChecks.length : 1.0;
  const final_score = 0.7 * vectorSim + 0.3 * tag_match_bonus;

  const titleMatches = productTitleMatchesSearch(row.name, intent.semantic_query, opts?.rawUserQuery);

  // Build human-readable match reason
  const reasonParts: string[] = [];
  if (titleMatches) {
    const snippet = `${row.name.slice(0, 80)}${row.name.length > 80 ? '…' : ''}`;
    reasonParts.push(`product title "${snippet}" matches your search`);
  }
  if (intent.legacyCategory) reasonParts.push(intent.legacyCategory.replace(/_/g, ' ').toLowerCase());
  if (intent.subCategory) reasonParts.push(intent.subCategory);
  if (intent.type) reasonParts.push(intent.type);
  if (intent.gender) reasonParts.push(`${intent.gender.toLowerCase()} products`);
  if (intent.colors?.length) reasonParts.push(`${intent.colors.join('/')} color`);
  for (const c of softChecks.filter((c) => c.matched)) reasonParts.push(c.label);

  const match_reason =
    reasonParts.length > 0
      ? `Matched: ${reasonParts.join(', ')}`
      : `Semantic similarity ${(vectorSim * 100).toFixed(0)}%`;

  return { ...row, final_score, tag_match_bonus, match_reason };
}
