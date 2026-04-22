/**
 * Model routing for the HTTP agent:
 * - Groq (Llama): conversational chat + tool calling (fast, concise).
 * - OpenAI: vision / structured JSON for color analysis, vibe check, this-or-that.
 *
 * Catalog embeddings remain OpenAI (`catalog.ts`).
 *
 * Env:
 * - GROQ_AGENT_MODEL (default llama-3.3-70b-versatile)
 * - OPENAI_VISION_MODEL (default gpt-4o)
 * - AGENT_MAX_COMPLETION_TOKENS (default 400; cap Llama reply length)
 */

export const GROQ_AGENT_MODEL =
  process.env.GROQ_AGENT_MODEL?.trim() || 'llama-3.3-70b-versatile';

export const OPENAI_VISION_MODEL =
  process.env.OPENAI_VISION_MODEL?.trim() || 'gpt-4o';

/** Max completion tokens for the Groq agent (user-facing text); keep low for short replies. */
export const AGENT_MAX_COMPLETION_TOKENS = Math.min(
  4096,
  Math.max(64, Number(process.env.AGENT_MAX_COMPLETION_TOKENS) || 400),
);
