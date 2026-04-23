import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger';
import { ANTHROPIC_INTENT_MODEL } from './anthropicModels';

export type Intent =
  | 'product_search'
  | 'color_analysis'
  | 'outfit'
  | 'vibe_check'
  | 'beauty'
  | 'this_or_that'
  | 'memory'
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
  };
  isFollowUp: boolean;
  searchMeta: SearchMeta;
  rollingContextSummary?: string | undefined;
}

let haiku: Anthropic | null = null;
function getHaiku(): Anthropic {
  if (!haiku) haiku = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return haiku;
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
- chitchat: Pure casual chat with NO shopping/fashion signal

RULES:
- Any clothing item, accessory, or occasion mentioned → product_search (NOT chitchat)
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
    "budget_signal": "under 2000"
  },
  "isFollowUp": false,
  "searchMeta": {
    "isDislikeMore": false,
    "isNeutralMore": false,
    "isForSelf": true,
    "recipientGender": null,
    "isEscapeSignal": false
  },
  "rollingContextSummary": "one sentence summary of last few turns or empty string"
}`;

const VALID_INTENTS: Intent[] = [
  'product_search', 'color_analysis', 'outfit', 'vibe_check',
  'beauty', 'this_or_that', 'memory', 'chitchat',
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
    const res = await getHaiku().messages.create({
      model: ANTHROPIC_INTENT_MODEL,
      max_tokens: 320,
      system: INTENT_SYSTEM,
      messages: [{ role: 'user', content: `${contextSection}\nCurrent user message: "${message}"` }],
    });

    const raw = res.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in Haiku response');

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
    logger.warn({ err, message: message.slice(0, 80) }, 'Haiku intent classification failed, using regex fallback');
    return regexClassify(message, hasImages, rollingContext);
  }
}
