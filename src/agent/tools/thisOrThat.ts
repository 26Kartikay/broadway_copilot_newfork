import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../lib/prisma';
import { getUserContext } from '../memory/redis';
import { logger } from '../../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const VISION_MODEL = "claude-opus-4-7";

export interface ThisOrThatInput {
  userId: string;
  imageABase64?: string;
  imageBBase64?: string;
  mimeType?: string;
  productIdA?: string;
  productIdB?: string;
  context?: string;
}

export async function thisOrThat(input: ThisOrThatInput) {
  const { userId, imageABase64, imageBBase64, mimeType, productIdA, productIdB, context } = input;

  try {
    const profile = await getUserContext(userId);
    let productA: any;
    let productB: any;

    if (productIdA) {
      productA = await prisma.product.findUnique({ where: { id: productIdA } });
    }
    if (productIdB) {
      productB = await prisma.product.findUnique({ where: { id: productIdB } });
    }

    const prompt = `Compare these two items for the user based on their profile:
    User Name: ${profile.name}
    Color Season: ${profile.colorSeason}
    Suited Colors: ${profile.colorPalette?.suited.join(', ')}
    Preferences: ${profile.preferences.join('; ')}
    Context: ${context || 'General styling advice'}
    
    Item A: ${productA ? `${productA.name} by ${productA.brand}` : 'Provided in image A'}
    Item B: ${productB ? `${productB.name} by ${productB.brand}` : 'Provided in image B'}
    
    Which one should they choose and why? Return JSON:
    {
      "recommendation": "A" | "B",
      "reasoning": "stylist explanation",
      "winnerDescription": "brief description of why this piece is the winner"
    }`;

    let messages: any[] = [];
    let content: any[] = [{ type: "text", text: prompt }];

    if (imageABase64 && imageBBase64 && mimeType) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: mimeType as any, data: imageABase64 }
      });
      content.push({
        type: "image",
        source: { type: "base64", media_type: mimeType as any, data: imageBBase64 }
      });
    }

    const response = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content }]
    });

    const text = (response.content[0] as any).text;
    const result = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text);

    return result;

  } catch (err) {
    logger.error({ err, userId }, 'Error in thisOrThat tool');
    return { error: String(err) };
  }
}
