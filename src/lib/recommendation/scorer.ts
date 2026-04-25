import type { ExtractedIntent, RawProductRow, ScoredRow } from './types';

function getField(componentTags: Record<string, unknown>, key: string): string {
  return String(componentTags[key] ?? '').toLowerCase();
}

/**
 * Compute final_score = (0.7 * vector_similarity) + (0.3 * tag_match_bonus)
 * tag_match_bonus = soft filter hits / total soft filters set (0–1)
 * Soft filters: occasion, colorPalette, ageGroup (never hard filters)
 */
export function computeScore(row: RawProductRow, intent: ExtractedIntent): ScoredRow {
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

  const matchedSoft = softChecks.filter((c) => c.matched).length;
  const tag_match_bonus = softChecks.length > 0 ? matchedSoft / softChecks.length : 1.0;
  const final_score = 0.7 * vectorSim + 0.3 * tag_match_bonus;

  // Build human-readable match reason
  const reasonParts: string[] = [];
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
