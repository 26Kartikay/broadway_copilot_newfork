/**
 * A centralized map of model costs per million tokens.
 */
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // Anthropic models
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
  'claude-opus-4-7': { input: 15.0, output: 75.0 },
  // OpenAI models (kept for catalog embeddings context)
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};
