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
  rollingContextSummary?: string | undefined;
}

let haiku: Anthropic | null = null;

function getHaiku(): Anthropic {
  if (!haiku) haiku = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return haiku;
}

const INTENT_SYSTEM = `You are an intent classifier for Broadway, a fashion shopping app in India.
Classify the user message into exactly one intent and extract entities. Return ONLY valid JSON.

Intents:
- product_search: User wants to find/buy/browse/recommend any product, item, or gift
- color_analysis: User wants color season, undertone, or palette analysis
- outfit: User wants outfit suggestions or a complete styled look
- vibe_check: User wants an outfit rated or feedback on how they look
- beauty: User asks about skincare, makeup, haircare, or beauty products
- this_or_that: User wants to compare two items and pick one
- memory: User explicitly wants to save or recall preferences only
- chitchat: Pure casual chat with NO shopping/fashion signal whatsoever

IMPORTANT RULES:
- If the message names ANY clothing item, accessory, or occasion → product_search (not chitchat)
- If any shopping intent exists alongside chitchat → product_search
- isFollowUp: true if the message clearly continues a prior shopping/styling conversation
  (e.g. "show more", "in red", "cheaper", "yes", "what about", "something else")

Return JSON only — no markdown, no explanation:
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
  "rollingContextSummary": "one sentence summary of the last few turns, or empty string"
}`;

const VALID_INTENTS: Intent[] = [
  'product_search', 'color_analysis', 'outfit', 'vibe_check',
  'beauty', 'this_or_that', 'memory', 'chitchat',
];

// --- Regex fallback (used when Haiku fails) ---

const FOLLOWUP_PATTERNS = [
  /^(show me more|more like (this|that|these)|any other|what else|another)/i,
  /^(yes|yeah|ok|okay|sure|sounds good|perfect|great)\b/i,
  /\b(something else|other options|other ideas|what about|how about|instead|different one)\b/i,
  /^(in (red|blue|black|white|green|pink|\w+))\b/i,
  /\b(cheaper|more expensive|under \d+|budget|price|affordable|splurge)\b/i,
];

function rollingContextSuggestsShopping(ctx: string): boolean {
  const t = ctx.toLowerCase();
  if (t.includes('product') || t.includes('catalog') || t.includes('broadwaylive')) return true;
  return /\b(dress|shirt|top|jeans|pants|shoes|bag|jacket|skirt|blazer|outfit|look|palette|season)\b/.test(t);
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

  if (hasImages && /rate|vibe|how do i look/.test(text)) {
    intent = 'vibe_check';
  } else if (hasImages && /analyze|color season|undertone/.test(text)) {
    intent = 'color_analysis';
  } else if (hasImages && /which one|pick one|compare/.test(text)) {
    intent = 'this_or_that';
  } else if (/skincare|makeup|beauty/.test(text)) {
    intent = 'beauty';
  } else if (/wear|outfit|style me/.test(text)) {
    intent = 'outfit';
  } else if (/search|show me|find|looking for|recommend|suggest|shop|buy|purchase|gift|browse|catalog|help me (pick|find)|ideas for|options for|\b(picks?|pieces?|items?)\b/.test(text)) {
    intent = 'product_search';
  } else if (/remember|save|preference/.test(text)) {
    intent = 'memory';
  } else {
    const clothes = ['dress', 'shirt', 'top', 'jeans', 'pants', 'shoes', 'bag', 'jacket'];
    if (clothes.some((c) => text.includes(c))) intent = 'product_search';
  }

  if (isFollowUp && intent === 'chitchat' && rollingContext && rollingContextSuggestsShopping(rollingContext)) {
    intent = 'product_search';
  }

  return { intent, entities, isFollowUp };
}

export async function classifyIntent(
  message: string,
  hasImages: boolean,
  rollingContext?: string,
): Promise<IntentResult> {
  // Vision intents can be determined immediately without LLM call
  if (hasImages) {
    const text = message.toLowerCase();
    if (/rate|vibe|how do i look/.test(text)) return { intent: 'vibe_check', entities: {}, isFollowUp: false };
    if (/analyze|color season|undertone/.test(text)) return { intent: 'color_analysis', entities: {}, isFollowUp: false };
    if (/which one|pick one|compare/.test(text)) return { intent: 'this_or_that', entities: {}, isFollowUp: false };
    // Image without clear intent — default to vibe_check
    return { intent: 'vibe_check', entities: {}, isFollowUp: false };
  }

  const contextSection = rollingContext?.trim()
    ? `\nRecent conversation context (last 6 turns):\n${rollingContext}\n`
    : '';

  const prompt = `${contextSection}\nCurrent user message: "${message}"`;

  try {
    const res = await getHaiku().messages.create({
      model: ANTHROPIC_INTENT_MODEL,
      max_tokens: 256,
      system: INTENT_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = res.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in Haiku response');

    const parsed = JSON.parse(match[0]) as {
      intent?: string;
      entities?: Record<string, unknown>;
      isFollowUp?: boolean;
      rollingContextSummary?: string;
    };

    const intent: Intent = VALID_INTENTS.includes(parsed.intent as Intent)
      ? (parsed.intent as Intent)
      : 'product_search';

    const entities: IntentResult['entities'] = {};
    const e = parsed.entities ?? {};
    if (typeof e.occasion === 'string' && e.occasion) entities.occasion = e.occasion;
    if (typeof e.style === 'string' && e.style) entities.style = e.style;
    if (Array.isArray(e.colors) && e.colors.length) entities.colors = e.colors.map(String);
    if (typeof e.category === 'string' && e.category) entities.category = e.category;
    if (typeof e.budget_signal === 'string' && e.budget_signal) entities.budget_signal = e.budget_signal;

    return {
      intent,
      entities,
      isFollowUp: Boolean(parsed.isFollowUp),
      rollingContextSummary: typeof parsed.rollingContextSummary === 'string'
        ? parsed.rollingContextSummary
        : undefined,
    };
  } catch (err) {
    logger.warn({ err, message: message.slice(0, 80) }, 'Haiku intent classification failed, using regex fallback');
    return regexClassify(message, hasImages, rollingContext);
  }
}
