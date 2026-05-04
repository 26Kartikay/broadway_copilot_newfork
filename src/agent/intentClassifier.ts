import { logger } from '../utils/logger';
import { getOpenAI } from './openaiClient';
import { OPENAI_INTENT_MODEL } from './openaiAgentModels';

export type Intent =
  | 'product_search'
  | 'color_analysis'
  | 'outfit'
  | 'vibe_check'
  | 'beauty'
  | 'this_or_that'
  | 'memory'
  | 'brand_info'
  | 'chitchat';

export interface SearchMeta {
  /** User expressed dislike ("I don't like these, show me something else entirely"). */
  isDislikeMore: boolean;
  /** User wants more of the same kind ("show me more", "suggest more"). */
  isNeutralMore: boolean;
  /** Shopping for themselves (default true). False when buying for someone else. */
  isForSelf: boolean;
  /** Gender of the recipient when shopping for someone else. */
  recipientGender?: string | undefined;  // 'male' | 'female'
  /** User wants to exit the current flow ("never mind", "cancel", "forget it"). */
  isEscapeSignal: boolean;
}

export interface IntentResult {
  intent: Intent;
  entities: {
    occasion?: string;
    style?: string;
    colors?: string[];
    category?: string;
    budget_signal?: string;
    /** Brand name or topic the user is asking about (for brand_info / logging) */
    brand_hint?: string;
  };
  isFollowUp: boolean;
  searchMeta: SearchMeta;
  rollingContextSummary?: string | undefined;
}

const INTENT_SYSTEM = `You are an intent classifier for Broadway, a fashion shopping app in India.
Classify the user message and return ONLY valid JSON.

Intents:
- product_search: User wants to find/buy/browse/recommend any product or item
- color_analysis: User wants color season, undertone, or palette analysis
- outfit: User wants outfit suggestions or a complete styled look
- vibe_check: User wants an outfit rated or feedback on how they look
- beauty: User asks about skincare, makeup, haircare, or beauty products
- this_or_that: User wants to compare two items and pick one
- memory: User explicitly wants to save/recall preferences ONLY
- brand_info: User asks about Broadway brands, brand stories, which brands are trending/popular/top, or "what/who is brand X" without asking to buy a specific SKU right now
- chitchat: Pure casual chat with NO shopping/fashion signal

RULES:
- Any clothing item, accessory, or occasion mentioned → product_search (NOT chitchat)
- If the user wants to BUY or FIND a product by name (e.g. "Nike sneakers", "show me dresses from X") → product_search, NOT brand_info
- If the user only wants brand background, reputation on Broadway, trending brands list, top sellers among brands → brand_info
- isFollowUp: true when continuing a prior shopping/styling thread

searchMeta fields:
- isDislikeMore: true if user says they don't like current suggestions AND wants different ones
  (e.g. "I don't like these", "not my style", "show me something completely different", "nah these aren't it")
- isNeutralMore: true if user just wants more options without expressing dislike
  (e.g. "show me more", "more options", "suggest more", "what else")
- isForSelf: true by default; false ONLY if user says they're buying for someone else
  (e.g. "for my mom", "for him", "for my friend", "as a gift for", "for my sister")
- recipientGender: "male" or "female" only when isForSelf=false and gender is inferable
  ("for my mom/wife/sister/her" → "female"; "for my dad/husband/brother/him" → "male"; else null)
- isEscapeSignal: true if user wants to exit/cancel the current flow
  (e.g. "never mind", "forget it", "cancel", "go back", "not now", "I changed my mind", "actually no", "skip")

Return JSON only — no markdown:
{
  "intent": "product_search",
  "entities": {
    "occasion": "wedding",
    "style": "minimal",
    "colors": ["red"],
    "category": "CLOTHING_FASHION",
    "budget_signal": "under 2000",
    "brand_hint": null
  },
  "isFollowUp": false,
  "searchMeta": {
    "isDislikeMore": false,
    "isNeutralMore": false,
    "isForSelf": true,
    "recipientGender": null,
    "isEscapeSignal": false
  },
  "rollingContextSummary": "Required: 1–2 short sentences in plain English describing what the user is asking or doing this turn — your understanding only. Do not include intent enum names, the word 'follow-up', or JSON-style labels."
}`;

const VALID_INTENTS: Intent[] = [
  'product_search', 'color_analysis', 'outfit', 'vibe_check',
  'beauty', 'this_or_that', 'memory', 'brand_info', 'chitchat',
];

// ─── Regex fallback ───────────────────────────────────────────────────────────

const FOLLOWUP_PATTERNS = [
  /^(show me more|more like (this|that|these)|any other|what else|another)/i,
  /^(yes|yeah|ok|okay|sure|sounds good|perfect|great)\b/i,
  /\b(something else|other options|other ideas|what about|how about|instead|different one)\b/i,
  /^(in (red|blue|black|white|green|pink|\w+))\b/i,
  /\b(cheaper|more expensive|under \d+|budget|price|affordable|splurge)\b/i,
];

const DISLIKE_PATTERNS = /\b(don't like|not my style|not for me|nah|these aren't|not it|hate these|something (completely )?different|nothing like these)\b/i;
const NEUTRAL_MORE_PATTERNS = /\b(show (me )?more|more (like this|options?|products?)|suggest more|what else|more suggestions?|keep going)\b/i;
const FOR_OTHERS_PATTERNS = /\b(for (my )?(mom|dad|sister|brother|wife|husband|friend|partner|girlfriend|boyfriend|her|him|someone else)|as a gift|gift for)\b/i;
const FEMALE_PATTERNS = /\b(mom|mother|sister|wife|girlfriend|her|aunty|aunt|daughter)\b/i;
const MALE_PATTERNS = /\b(dad|father|brother|husband|boyfriend|him|uncle|son)\b/i;
const ESCAPE_PATTERNS = /\b(never mind|nevermind|forget it|cancel|go back|stop|skip|not now|changed my mind|actually no|exit|quit|not interested|no thanks|take me back|let me out|abort)\b/i;

/** Coarse brand-info signals (Haiku still authoritative when available). */
const BRAND_INFO_PATTERNS =
  /\b(what brands|which brands|brands?\s+(on\s+)?broadway|brands?\s+(do|does)\s+you|trending\s+brands?|popular\s+brands?|top\s*-?\s*sell(?:er|ing)?\s+brands?|best\s+brands?|brand\s+to\s+(try|know|shop)|tell\s+me\s+about\s+.{2,60}\s+brand|about\s+the\s+brand|brand\s+story|who\s+makes\s+)/i;

function rollingContextSuggestsShopping(ctx: string): boolean {
  const t = ctx.toLowerCase();
  if (t.includes('product') || t.includes('catalog') || t.includes('broadwaylive')) return true;
  return /\b(dress|shirt|top|jeans|pants|shoes|bag|jacket|skirt|blazer|outfit|look|palette|season)\b/.test(t);
}

function defaultSearchMeta(): SearchMeta {
  return { isDislikeMore: false, isNeutralMore: false, isForSelf: true, isEscapeSignal: false };
}

function regexClassify(message: string, hasImages: boolean, rollingContext?: string): IntentResult {
  const text = message.toLowerCase();
  const isFollowUp = rollingContext
    ? FOLLOWUP_PATTERNS.some((p) => p.test(message.toLowerCase()))
    : false;

  const entities: IntentResult['entities'] = {};
  if (text.includes('wedding')) entities.occasion = 'wedding';
  if (text.includes('party')) entities.occasion = 'party';
  if (text.includes('minimal')) entities.style = 'minimal';
  if (text.includes('streetwear')) entities.style = 'streetwear';

  let intent: Intent = 'chitchat';
  if (hasImages && /rate|vibe|how do i look/.test(text)) intent = 'vibe_check';
  else if (hasImages && /analyze|color season|undertone/.test(text)) intent = 'color_analysis';
  else if (hasImages && /which one|pick one|compare/.test(text)) intent = 'this_or_that';
  else if (BRAND_INFO_PATTERNS.test(message)) intent = 'brand_info';
  else if (/skincare|makeup|beauty/.test(text)) intent = 'beauty';
  else if (/wear|outfit|style me/.test(text)) intent = 'outfit';
  else if (/search|show me|find|looking for|recommend|suggest|shop|buy|purchase|gift|browse|catalog|help me (pick|find)|ideas for|options for|\b(picks?|pieces?|items?)\b/.test(text)) intent = 'product_search';
  else if (/remember|save|preference/.test(text)) intent = 'memory';
  else {
    const clothes = ['dress', 'shirt', 'top', 'jeans', 'pants', 'shoes', 'bag', 'jacket'];
    if (clothes.some((c) => text.includes(c))) intent = 'product_search';
  }

  if (isFollowUp && intent === 'chitchat' && rollingContext && rollingContextSuggestsShopping(rollingContext)) {
    intent = 'product_search';
  }

  const forOthers = FOR_OTHERS_PATTERNS.test(message);
  let recipientGender: string | undefined;
  if (forOthers) {
    if (FEMALE_PATTERNS.test(message)) recipientGender = 'female';
    else if (MALE_PATTERNS.test(message)) recipientGender = 'male';
  }

  const searchMeta: SearchMeta = {
    isDislikeMore: DISLIKE_PATTERNS.test(message),
    isNeutralMore: NEUTRAL_MORE_PATTERNS.test(message),
    isForSelf: !forOthers,
    recipientGender,
    isEscapeSignal: ESCAPE_PATTERNS.test(message),
  };

  return { intent, entities, isFollowUp, searchMeta };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function classifyIntent(
  message: string,
  hasImages: boolean,
  rollingContext?: string,
): Promise<IntentResult> {
  // Vision intents fast-pathed without LLM call
  if (hasImages) {
    const text = message.toLowerCase();
    let intent: Intent = 'vibe_check';
    if (/analyze|color season|undertone/.test(text)) intent = 'color_analysis';
    else if (/which one|pick one|compare/.test(text)) intent = 'this_or_that';
    return { intent, entities: {}, isFollowUp: false, searchMeta: defaultSearchMeta() };
  }

  // Escape signals are cheap — detect immediately without LLM
  if (ESCAPE_PATTERNS.test(message)) {
    const sm = { ...defaultSearchMeta(), isEscapeSignal: true };
    return { intent: 'chitchat', entities: {}, isFollowUp: false, searchMeta: sm };
  }

  const contextSection = rollingContext?.trim()
    ? `\nRecent conversation context (last 6 turns):\n${rollingContext}\n`
    : '';

  try {
    const res = await getOpenAI().chat.completions.create({
      model: OPENAI_INTENT_MODEL,
      max_tokens: 320,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: INTENT_SYSTEM },
        { role: 'user', content: `${contextSection}\nCurrent user message: "${message}"` },
      ],
    });

    const raw = res.choices[0]?.message?.content ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in intent classifier response');

    const parsed = JSON.parse(match[0]) as {
      intent?: string;
      entities?: Record<string, unknown>;
      isFollowUp?: boolean;
      searchMeta?: Partial<SearchMeta> & { recipientGender?: string | null };
      rollingContextSummary?: string;
    };

    const intent: Intent = VALID_INTENTS.includes(parsed.intent as Intent)
      ? (parsed.intent as Intent)
      : 'product_search';

    const e = parsed.entities ?? {};
    const entities: IntentResult['entities'] = {};
    if (typeof e.occasion === 'string' && e.occasion) entities.occasion = e.occasion;
    if (typeof e.style === 'string' && e.style) entities.style = e.style;
    if (Array.isArray(e.colors) && e.colors.length) entities.colors = e.colors.map(String);
    if (typeof e.category === 'string' && e.category) entities.category = e.category;
    if (typeof e.budget_signal === 'string' && e.budget_signal) entities.budget_signal = e.budget_signal;
    if (typeof e.brand_hint === 'string' && e.brand_hint.trim()) entities.brand_hint = e.brand_hint.trim();

    const sm = parsed.searchMeta ?? {};
    const searchMeta: SearchMeta = {
      isDislikeMore: Boolean(sm.isDislikeMore),
      isNeutralMore: Boolean(sm.isNeutralMore),
      isForSelf: sm.isForSelf !== false,
      recipientGender: sm.recipientGender ?? undefined,
      isEscapeSignal: Boolean(sm.isEscapeSignal),
    };

    return {
      intent,
      entities,
      isFollowUp: Boolean(parsed.isFollowUp),
      searchMeta,
      rollingContextSummary: typeof parsed.rollingContextSummary === 'string'
        ? parsed.rollingContextSummary
        : undefined,
    };
  } catch (err) {
    logger.warn({ err, message: message.slice(0, 80) }, 'Intent classification failed, using regex fallback');
    return regexClassify(message, hasImages, rollingContext);
  }
}

/**
 * Plain-text for `intentv2`: only what was inferred about the user's ask (LLM summary when present).
 */
export function formatIntentV2PlainText(result: IntentResult): string {
  const summary = result.rollingContextSummary?.trim();
  if (summary) return summary;
  return buildInferenceFallback(result);
}

function buildInferenceFallback(result: IntentResult): string {
  const { intent, entities, isFollowUp, searchMeta } = result;
  const bits: string[] = [];

  const goal = describeGoalInPlainLanguage(intent);
  bits.push(goal);

  if (isFollowUp) bits.push('This message continues an earlier thread.');

  const detailParts: string[] = [];
  if (entities.occasion) detailParts.push(`${entities.occasion} occasion`);
  if (entities.style) detailParts.push(`${entities.style} style`);
  if (entities.colors?.length) detailParts.push(`colors ${entities.colors.join(', ')}`);
  if (entities.category) detailParts.push(`category ${entities.category}`);
  if (entities.budget_signal) detailParts.push(`budget ${entities.budget_signal}`);
  if (entities.brand_hint) detailParts.push(`brand angle: ${entities.brand_hint}`);
  if (detailParts.length) bits.push(`They mentioned ${detailParts.join(', ')}.`);

  const sm = searchMeta;
  if (sm.isDislikeMore) bits.push('They want different suggestions than what was shown before.');
  if (sm.isNeutralMore) bits.push('They want more options in a similar direction.');
  if (!sm.isForSelf) {
    bits.push(
      sm.recipientGender
        ? `They are shopping for someone else (likely ${sm.recipientGender}).`
        : 'They are shopping for someone else or for a gift.',
    );
  }
  if (sm.isEscapeSignal) bits.push('They want to stop or leave the current flow.');

  return bits.join(' ');
}

function describeGoalInPlainLanguage(intent: Intent): string {
  switch (intent) {
    case 'product_search':
      return 'They want to find, browse, or get recommendations for products.';
    case 'brand_info':
      return 'They want to know about brands on Broadway, what is trending, or brand background.';
    case 'color_analysis':
      return 'They want color season, undertone, or palette analysis.';
    case 'outfit':
      return 'They want outfit ideas or a full styled look.';
    case 'vibe_check':
      return 'They want feedback on how an outfit or look works on them.';
    case 'beauty':
      return 'They are asking about skincare, makeup, or haircare.';
    case 'this_or_that':
      return 'They want help choosing between two options.';
    case 'memory':
      return 'They want to save or recall preferences.';
    case 'chitchat':
      return 'They are chatting without a specific shopping or styling task.';
    default:
      return 'They have a fashion or shopping-related message.';
  }
}
