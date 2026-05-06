/**
 * Catalog rows are often one DB row per SKU (barcode). Multiple SKUs can share a
 * merchandising config. Recommendations should surface at most one SKU per config.
 */
export function dedupeKeyFromProduct(componentTags: unknown, handleId: string): string {
  const tags =
    componentTags && typeof componentTags === 'object' && !Array.isArray(componentTags)
      ? (componentTags as Record<string, unknown>)
      : {};
  const raw = tags.csvConfigId ?? tags.configId;
  const s = typeof raw === 'string' ? raw.trim() : raw != null ? String(raw).trim() : '';
  if (s) return `cfg:${s}`;
  const h = (handleId ?? '').trim();
  return `hid:${h || '_'}`;
}
