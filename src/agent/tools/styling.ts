import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { searchCatalog } from './catalog';

export interface OutfitSuggestionInput {
  occasion: string;
  userId: string;
  colorSeason?: string;
  style?: string;
  existingPieces?: string[];
}

export async function getOutfitSuggestion(input: OutfitSuggestionInput) {
  const { occasion, userId, colorSeason, style, existingPieces } = input;

  try {
    // 1. Fetch user's color analysis in parallel if not provided
    const colorAnalysisPromise = prisma.colorAnalysis.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    // 2. Prepare search promises for parallel execution
    const catalogArgs = (query: string, category: string) => ({
      query,
      category,
      ...(style ? { style } : {}),
      limit: 3,
    });

    const topSearch = searchCatalog(
      catalogArgs(`${occasion} top shirt blouse`, 'CLOTHING_FASHION'),
    );

    const bottomSearch = searchCatalog(
      catalogArgs(`${occasion} bottom trousers skirt pants`, 'CLOTHING_FASHION'),
    );

    const shoeSearch = searchCatalog(catalogArgs(`${occasion} shoes footwear`, 'FOOTWEAR'));

    const accessorySearch = searchCatalog(
      catalogArgs(`${occasion} accessory jewelry bag`, 'JEWELLERY_ACCESSORIES'),
    );

    // Execute all searches + DB fetch in parallel
    const [colorAnalysis, topResult, bottomResult, shoeResult, accessoryResult] = await Promise.all(
      [colorAnalysisPromise, topSearch, bottomSearch, shoeSearch, accessorySearch],
    );

    const outfit = {
      top: topResult.products[0],
      bottom: bottomResult.products[0],
      shoes: shoeResult.products[0],
      accessories: accessoryResult.products.slice(0, 2),
    };

    const allProducts = [
      ...(topResult.products || []),
      ...(bottomResult.products || []),
      ...(shoeResult.products || []),
      ...(accessoryResult.products || []),
    ];

    return {
      outfit,
      reasoning: `I've put together a ${style || 'stylish'} look perfect for ${occasion}. I selected these pieces because they coordinate well and match the ${style || 'vibe'} you're going for.`,
      allProducts,
    };
  } catch (err) {
    logger.error({ err, userId }, 'Error in getOutfitSuggestion tool');
    return { error: String(err) };
  }
}
