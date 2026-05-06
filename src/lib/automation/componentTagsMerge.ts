/**
 * Feed / merchant fields stored on componentTags — must survive tag+embed automation
 * and must not be cleared by partial CSV rows or automation JSON.
 */
export const MERCHANT_STICKY_TAG_KEYS = ['csvConfigId', 'csvSkuId', 'csvDescription'] as const;

function asRecord(existing: unknown): Record<string, unknown> {
  return existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...(existing as Record<string, unknown>) }
    : {};
}

/**
 * After automation tagging: merge LLM fields onto existing JSON; never drop sticky merchant keys.
 */
export function mergeAutomationComponentTags(
  existing: unknown,
  automationUpdate: Record<string, unknown>,
): Record<string, unknown> {
  const ex = asRecord(existing);
  const out = { ...ex, ...automationUpdate };
  for (const k of MERCHANT_STICKY_TAG_KEYS) {
    const prev = ex[k];
    if (typeof prev === 'string' && prev.trim() !== '') {
      out[k] = prev;
    }
  }
  return out;
}

/**
 * CSV seed/update: merge incoming row tags onto DB. If a sticky key was already set in DB, keep DB value (immutable).
 */
export function mergeSeedComponentTags(existing: unknown, incoming: Record<string, unknown>): Record<string, unknown> {
  const ex = asRecord(existing);
  const out = { ...ex, ...incoming };
  for (const k of MERCHANT_STICKY_TAG_KEYS) {
    const prev = ex[k];
    if (typeof prev === 'string' && prev.trim() !== '') {
      out[k] = prev;
    }
  }
  return out;
}
