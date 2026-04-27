import OpenAI from 'openai';

import { logger } from '../utils/logger';

/** Max products sent to the model per rerank call (latency + context). */
export const OPENAI_RERANK_CANDIDATE_CAP = 32;

const DEFAULT_RERANK_MODEL = 'gpt-4o-mini';

let client: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  const k = process.env.OPENAI_API_KEY?.trim();
  if (!k) return null;
  if (!client) client = new OpenAI({ apiKey: k });
  return client;
}

function rerankEnabled(): boolean {
  return process.env.OPENAI_RERANK_ENABLED?.trim().toLowerCase() !== 'false';
}

const SYSTEM_PROMPT = `You are a fashion expert reranking products for a personal shopping chatbot.
Return ONLY valid JSON: {"order":["id1","id2",...]}.
The "order" array MUST include every product id from the user message exactly once (ids appear after "id="), ranked from most to least relevant.

Ranking priorities (apply in order):
1. CATEGORY & TYPE — product must be the exact kind of item the shopper wants; wrong-type items go last
2. OCCASION — if an occasion is stated, items suited for it rank higher
3. COLOR — exact color match beats approximate; respect palette intent
4. BRAND / STYLE — honour any brand or style preference stated in the query
5. GENDER — respect gender context when provided
6. VARIETY — when scores are close, prefer a diverse selection (different brands/types) over duplicates

Penalise items that are clearly the wrong type, wrong gender, or irrelevant to the occasion even if they have a high similarity score.`;

/**
 * Listwise rerank using OpenAI chat + JSON.
 *
 * @param query Natural-language shopping / search intent
 * @param candidates Pre-filtered, scored candidates; only the first `cap` are reordered
 * @param summarize One-line product description for the ranker
 * @param cap Max candidates to send (default 32)
 * @param intentContext Structured shopping intent string to anchor the ranking decision
 * @returns Reordered list, or `null` to keep caller's order
 */
export async function openaiRerankByQuery<T extends { id: string }>(
  query: string,
  candidates: T[],
  summarize: (row: T) => string,
  cap = OPENAI_RERANK_CANDIDATE_CAP,
  intentContext?: string,
): Promise<T[] | null> {
  if (!rerankEnabled() || candidates.length <= 1) return null;

  const trimmedQuery = query.trim().slice(0, 2000);
  if (!trimmedQuery) return null;

  const openai = getOpenAI();
  if (!openai) return null;

  const pool = candidates.slice(0, Math.min(cap, candidates.length));
  if (pool.length < 2) return null;

  const lines = pool.map((row, i) => `${i + 1}. id=${row.id} | ${summarize(row).slice(0, 280)}`);

  const contextBlock = intentContext?.trim()
    ? `SHOPPING INTENT (extracted from the query):\n${intentContext.trim()}\n\n`
    : '';

  const userContent =
    `${contextBlock}SHOPPER QUERY: "${trimmedQuery}"\n\n` +
    `PRODUCT CANDIDATES (rank all from best to worst match):\n${lines.join('\n')}`;

  try {
    const model = process.env.OPENAI_RERANK_MODEL?.trim() || DEFAULT_RERANK_MODEL;
    const res = await openai.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 512,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    });

    const raw = res.choices[0]?.message?.content?.trim();
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { order?: unknown };
    if (!Array.isArray(parsed.order)) return null;

    const idOrder = parsed.order.map((x) => String(x)).filter(Boolean);
    const poolSet = new Set(pool.map((p) => p.id));
    const byId = new Map(pool.map((p) => [p.id, p]));

    const head: T[] = [];
    const seen = new Set<string>();
    for (const id of idOrder) {
      if (poolSet.has(id) && !seen.has(id)) {
        const row = byId.get(id);
        if (row) {
          head.push(row);
          seen.add(id);
        }
      }
    }
    // Append any ids the model missed (safety net)
    for (const p of pool) {
      if (!seen.has(p.id)) {
        head.push(p);
        seen.add(p.id);
      }
    }

    const tail = candidates.filter((c) => !poolSet.has(c.id));
    const merged = [...head, ...tail];

    logger.info(
      {
        model,
        poolSize: pool.length,
        total: candidates.length,
        topIds: head.slice(0, 5).map((h) => h.id),
        hasContext: !!intentContext,
      },
      'OpenAI listwise rerank applied',
    );
    return merged;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'OpenAI rerank failed; keeping prior order',
    );
    return null;
  }
}
