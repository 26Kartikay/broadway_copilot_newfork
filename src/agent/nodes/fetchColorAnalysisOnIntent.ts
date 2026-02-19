import { isValidPalette } from '../../data/seasonalPalettes';
import { logger } from '../../utils/logger';
import { GraphState } from '../state';
import { fetchColorAnalysis } from '../tools';

/**
 * Fetches color analysis for the user when intent is detected.
 * This node is called before product recommendations to ensure
 * color analysis data is available for personalized recommendations.
 * 
 * This node is only called when CONFIRM_PRODUCT_RECOMMENDATION is pending,
 * which means the user has already completed color analysis.
 * 
 * Note: If a user does multiple color analyses, this will always fetch
 * the most recent one (ordered by createdAt desc), so new analyses will
 * automatically be used for product recommendations.
 * 
 * This node only fetches and stores the data - it does NOT create a card.
 */
export async function fetchColorAnalysisOnIntent(state: GraphState): Promise<GraphState> {
  const { user } = state;
  const userId = user.id;

  logger.debug({ userId }, 'fetchColorAnalysisOnIntent: Starting color analysis fetch before product recommendations');

  try {
    // Use the fetchColorAnalysis tool to get the formatted color analysis result
    const colorAnalysisTool = fetchColorAnalysis(userId);
    const colorAnalysisResult = await colorAnalysisTool.func({});

    // Validate that we got a valid result
    if (colorAnalysisResult && typeof colorAnalysisResult === 'object' && 'palette_name' in colorAnalysisResult) {
      const paletteName = (colorAnalysisResult as any).palette_name;
      
      if (paletteName && isValidPalette(paletteName)) {
        logger.debug({ userId, paletteName }, 'fetchColorAnalysisOnIntent: Color analysis fetched successfully');
        // Store the color analysis result in the state for use in product recommendations
        // No card is created - just store the data
        return {
          ...state,
          fetchedColorAnalysis: colorAnalysisResult,
        };
      }
    }

    logger.debug({ userId }, 'fetchColorAnalysisOnIntent: No valid color analysis found');
    return state;
  } catch (err: unknown) {
    logger.warn(
      { userId, err: (err as Error)?.message },
      'Failed to fetch color analysis on intent, continuing without it',
    );
    // Don't fail the flow if color analysis fetch fails
    // Just continue without it
    return state;
  }
}

