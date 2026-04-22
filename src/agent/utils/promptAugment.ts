import type { GraphState } from '../state';

/** Appends persisted color season so LLMs stay on-palette across turns. */
export function withColorSeasonBlock(systemText: string, state: GraphState): string {
  const cs = state.colorSeason?.trim();
  if (!cs) return systemText;
  return `${systemText}\n\n## User color season (always respect)\nUser's color season: ${cs}. Tailor color and styling advice to this palette when relevant.`;
}

/** Limits follow-up noise in assistant text. */
export function withSingleFollowUpRule(systemText: string): string {
  return `${systemText}\n\n## Response discipline\n- Ask at most ONE follow-up question per response.\n- Prefer answering, using tools, or showing catalog products first; only then ask one short question if truly needed.\n- ONLY recommend products from the catalog data returned by tools in this turn. NEVER mention external brands (e.g. Nike, Adidas, Vans) unless that exact brand appears in tool results.`;
}

/** Catalog-only brand rule when product list is known (post-tool messaging). */
export function withCatalogBrandLock(systemText: string, catalogLines: string): string {
  const base = withSingleFollowUpRule(systemText);
  if (!catalogLines.trim()) return base;
  return `${base}\n\n## Catalog lock\nAllowed product names/brands from our catalog only:\n${catalogLines}\nDo not name any other brands or products.`;
}
