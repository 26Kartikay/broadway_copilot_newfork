/**
 * Model routing for the Broadway AI agent:
 * - Haiku: intent classification + rolling context summarization (fast, cheap)
 * - Sonnet: main chat responses + vision tasks (quality)
 *
 * Catalog embeddings remain OpenAI (text-embedding-3-small in catalog.ts).
 *
 * Env:
 * - ANTHROPIC_API_KEY (required)
 * - OPENAI_API_KEY (required for catalog vector search embeddings)
 * - ANTHROPIC_CHAT_MODEL (override main chat model)
 * - ANTHROPIC_INTENT_MODEL (override intent classifier model)
 * - AGENT_MAX_COMPLETION_TOKENS (default 1024; cap reply length)
 */

export const ANTHROPIC_CHAT_MODEL =
  process.env.ANTHROPIC_CHAT_MODEL?.trim() || 'claude-sonnet-4-6';

export const ANTHROPIC_INTENT_MODEL =
  process.env.ANTHROPIC_INTENT_MODEL?.trim() || 'claude-haiku-4-5-20251001';

export const ANTHROPIC_VISION_MODEL =
  process.env.ANTHROPIC_VISION_MODEL?.trim() || 'claude-sonnet-4-6';

/** Max completion tokens for the main chat agent. */
export const AGENT_MAX_COMPLETION_TOKENS = Math.min(
  4096,
  Math.max(256, Number(process.env.AGENT_MAX_COMPLETION_TOKENS) || 1024),
);
