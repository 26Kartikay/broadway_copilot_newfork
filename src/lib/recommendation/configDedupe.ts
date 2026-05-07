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

/** External SKU from sheet → `componentTags.csvSkuId`. */
export function skuIdFromComponentTags(componentTags: unknown): string {
  const tags =
    componentTags && typeof componentTags === 'object' && !Array.isArray(componentTags)
      ? (componentTags as Record<string, unknown>)
      : {};
  const raw = tags.csvSkuId ?? tags.skuId ?? tags.sku_id;
  if (raw == null) return '';
  return String(raw).trim();
}

/** Style/config group from sheet → `componentTags.csvConfigId`. */
export function configIdFromComponentTags(componentTags: unknown): string {
  const tags =
    componentTags && typeof componentTags === 'object' && !Array.isArray(componentTags)
      ? (componentTags as Record<string, unknown>)
      : {};
  const raw = tags.csvConfigId ?? tags.configId;
  if (raw == null) return '';
  return String(raw).trim();
}

/** Feed row id from `Product.db_id` (CSV column `id`). */
export function dbIdFromProductRow(row: Record<string, unknown>): string {
  const v = row.dbId ?? row.dbid ?? row.db_id;
  if (v == null) return '';
  return String(v).trim();
}
