import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { anthropicVisionCompletion } from '../anthropicVision';
import { ANTHROPIC_VISION_MODEL } from '../anthropicModels';
import { getUserContext } from '../memory/redis';

export interface ThisOrThatInput {
  userId: string;
  imageABase64?: string;
  imageBBase64?: string;
  mimeType?: string;
  productIdA?: string;
  productIdB?: string;
  context?: string;
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

type SupportedMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
const SUPPORTED = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
function safeMime(raw: string): SupportedMediaType {
  const fixed = raw === 'image/jpg' ? 'image/jpeg' : raw;
  return SUPPORTED.has(fixed) ? (fixed as SupportedMediaType) : 'image/jpeg';
}

export async function thisOrThat(input: ThisOrThatInput) {
  const { userId, imageABase64, imageBBase64, mimeType, productIdA, productIdB, context } = input;

  try {
    const profile = await getUserContext(userId);
    let productA: any;
    let productB: any;
    if (productIdA) productA = await prisma.product.findUnique({ where: { id: productIdA } });
    if (productIdB) productB = await prisma.product.findUnique({ where: { id: productIdB } });

    const profileSummary = `User: ${profile.name} | Color Season: ${profile.colorSeason} | Suited Colors: ${Array.isArray(profile.colorPalette?.suited) ? profile.colorPalette!.suited.join(', ') : 'unknown'} | Preferences: ${Array.isArray(profile.preferences) ? profile.preferences.join('; ') : 'not captured'}`;
    const itemA = productA ? `${productA.name} by ${productA.brand}` : 'Item A (from image)';
    const itemB = productB ? `${productB.name} by ${productB.brand}` : 'Item B (from image)';

    const prompt = `Compare these two fashion items for a customer based on their profile.

Profile: ${profileSummary}
Context: ${context || 'General styling advice'}
Item A: ${itemA}
Item B: ${itemB}

Which one should they choose and why? Consider color season compatibility, personal style, and versatility.

Return JSON only:
{
  "recommendation": "A",
  "reasoning": "stylist explanation",
  "winnerDescription": "brief description of why this piece wins"
}`;

    if (imageABase64 && imageBBase64 && mimeType) {
      const mt = safeMime(mimeType);
      const res = await getClient().messages.create({
        model: ANTHROPIC_VISION_MODEL,
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mt, data: imageABase64 } },
            { type: 'image', source: { type: 'base64', media_type: mt, data: imageBBase64 } },
            { type: 'text', text: prompt },
          ],
        }],
      });
      const text = res.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text);
    }

    const text = await anthropicVisionCompletion({ prompt, maxTokens: 512 });
    return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text);
  } catch (err) {
    logger.error({ err, userId }, 'Error in thisOrThat tool');
    return { error: String(err) };
  }
}
