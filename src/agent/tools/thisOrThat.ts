import type OpenAI from 'openai';
import { prisma } from '../../lib/prisma';
import { getUserContext } from '../memory/redis';
import { logger } from '../../utils/logger';
import { openaiVisionUserCompletion } from '../openaiVision';

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
    Suited Colors: ${Array.isArray(profile.colorPalette?.suited) ? profile.colorPalette!.suited.join(', ') : 'unknown'}
    Preferences: ${Array.isArray(profile.preferences) ? profile.preferences.join('; ') : 'not captured'}
    Context: ${context || 'General styling advice'}
    
    Item A: ${productA ? `${productA.name} by ${productA.brand}` : 'Provided in image A'}
    Item B: ${productB ? `${productB.name} by ${productB.brand}` : 'Provided in image B'}
    
    Which one should they choose and why? Return JSON:
    {
      "recommendation": "A" | "B",
      "reasoning": "stylist explanation",
      "winnerDescription": "brief description of why this piece is the winner"
    }`;

    const content: OpenAI.Chat.ChatCompletionContentPart[] = [{ type: 'text', text: prompt }];

    if (imageABase64 && imageBBase64 && mimeType) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${imageABase64}` },
      });
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${imageBBase64}` },
      });
    }

    const text = await openaiVisionUserCompletion({ content, max_tokens: 1024 });
    const result = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text);

    return result;

  } catch (err) {
    logger.error({ err, userId }, 'Error in thisOrThat tool');
    return { error: String(err) };
  }
}
