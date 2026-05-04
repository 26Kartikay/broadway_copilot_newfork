import { logger } from '../../utils/logger';
import { getOpenAI } from '../../agent/openaiClient';
import { OPENAI_INTENT_MODEL } from '../../agent/openaiAgentModels';
import type { RecipientContext, UserProfile } from './types';

const SYSTEM = `You are a shopping context classifier. Your job is to determine who a user is shopping for based on their query. Look for relationship words, pronouns, and gifting signals.
- If the query mentions anyone other than the user themselves, set shopping_for to "other".
- If it is clearly for the user, set shopping_for to "self".
- If genuinely ambiguous with no signals either way, set shopping_for to "unknown".
- Infer recipient gender ONLY from explicit relationship words or pronouns in the query. Never assume from the user's profile.
- Output ONLY valid JSON — no explanation, no markdown, no extra text.

JSON schema:
{
  "shopping_for": "self" | "other" | "unknown",
  "recipient_gender": "MALE" | "FEMALE" | "OTHER" | null,
  "recipient_age_group": "ADULT" | "TEEN" | "SENIOR" | null,
  "recipient_relationship": string | null,
  "gift_context": boolean,
  "confidence": "high" | "medium" | "low"
}

Relationship → recipient_gender mapping:
- girlfriend, gf, wife, mother, mom, mum, sister, aunt, grandma, grandmother, daughter, niece, bestie (female context) → "FEMALE"
- boyfriend, bf, husband, father, dad, brother, uncle, grandpa, grandfather, son, nephew → "MALE"
- friend, colleague, boss, partner (ambiguous), them → null
- "for her" / "she" / "her style" → "FEMALE"
- "for him" / "he" / "his style" → "MALE"

Age group mapping:
- "teenage", "teen", "young girl/boy", "teenage daughter/son" → "TEEN"
- "senior", "elderly", "grandma", "grandpa", "grandmother", "grandfather" → "SENIOR"
- default for adults → "ADULT", or null if not mentioned

Gift signals (set gift_context: true):
- "gift for", "present for", "buying for", "for her birthday", "recommend for my", "suggest for", "shopping for", "something for my"

Self signals (shopping_for = "self"):
- "for me", "I want", "I need", "my skin", "my style", "recommend me", "suggest me", "for myself"
- Or when no recipient signals at all and query is a direct product ask → "self" with high confidence

Unknown signals:
- Bare product queries with no context clues (e.g. just "red dress") → "unknown"`;

const FALLBACK: RecipientContext = {
  shopping_for: 'unknown',
  recipient_gender: null,
  recipient_age_group: null,
  recipient_relationship: null,
  gift_context: false,
  confidence: 'low',
};

export async function detectRecipient(
  query: string,
  userProfile: UserProfile,
): Promise<RecipientContext> {
  try {
    const userContent = `User query: "${query}"\nUser profile gender (for reference only, do NOT use for recipient inference): ${userProfile.gender ?? 'unknown'}`;

    const res = await getOpenAI().chat.completions.create({
      model: OPENAI_INTENT_MODEL,
      max_tokens: 256,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userContent },
      ],
    });

    const text = res.choices[0]?.message?.content?.trim() ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Stage 0 response');

    const parsed = JSON.parse(jsonMatch[0]) as RecipientContext;

    // Validate required fields
    if (!['self', 'other', 'unknown'].includes(parsed.shopping_for)) {
      parsed.shopping_for = 'unknown';
    }

    logger.info(
      {
        query: query.slice(0, 100),
        shopping_for: parsed.shopping_for,
        recipient_gender: parsed.recipient_gender,
        recipient_relationship: parsed.recipient_relationship,
        gift_context: parsed.gift_context,
        confidence: parsed.confidence,
      },
      '[RecEng Stage0] Recipient detection complete',
    );

    return parsed;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), query: query.slice(0, 100) },
      '[RecEng Stage0] Recipient detection failed — using fallback',
    );
    return FALLBACK;
  }
}
