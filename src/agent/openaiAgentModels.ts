/**
 * Model routing for the Broadway AI agent (OpenAI Chat Completions API).
 *
 * Catalog embeddings stay OpenAI (`text-embedding-3-small` in catalog tooling).
 *
 * Env:
 * - OPENAI_API_KEY (required for chat, intent, vision)
 * - OPENAI_CHAT_MODEL — main agent with tools (default gpt-4o-mini)
 * - OPENAI_INTENT_MODEL — intent classification + RecEng JSON passes (default gpt-4o-mini)
 * - OPENAI_VISION_MODEL — image understanding (default gpt-4o)
 * - AGENT_MAX_COMPLETION_TOKENS — cap reply length (default 1024)
 */

export const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-4o-mini';

export const OPENAI_INTENT_MODEL = process.env.OPENAI_INTENT_MODEL?.trim() || 'gpt-4o-mini';

export const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL?.trim() || 'gpt-4o';

/** Max completion tokens for the main chat agent. */
export const AGENT_MAX_COMPLETION_TOKENS = Math.min(
  4096,
  Math.max(256, Number(process.env.AGENT_MAX_COMPLETION_TOKENS) || 1024),
);
