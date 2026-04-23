import { logger } from '../../utils/logger';
import { searchCatalog } from './catalog';

export interface BeautyAdvisorInput {
  skinType?: string;
  concern?: string;
  occasion?: string;
  colorSeason?: string;
  category?: 'skincare' | 'makeup' | 'haircare';
}

export async function beautyAdvisor(input: BeautyAdvisorInput) {
  const { skinType, concern, occasion, colorSeason, category = 'skincare' } = input;

  try {
    const query = `${category} ${concern || ''} ${occasion || ''} ${skinType || ''}`;

    const searchResult = await searchCatalog({
      query,
      category: 'BEAUTY_PERSONAL_CARE',
      limit: 6,
    });

    const products = searchResult.products;

    let tips: string[] = [];
    if (category === 'makeup' && colorSeason) {
      tips.push(`Focus on shades that complement your ${colorSeason} palette.`);
    }

    if (concern) {
      tips.push(`When addressing ${concern}, look for ingredients like niacinamide or vitamin C.`);
    }

    return {
      recommendations: products,
      routine: products.slice(0, 3).map((p, i) => `Step ${i + 1}: ${p.name}`),
      tips: tips.length > 0 ? tips : ['Always use sunscreen as your final skincare step.'],
    };
  } catch (err) {
    logger.error({ err }, 'Error in beautyAdvisor tool');
    return { error: String(err) };
  }
}
