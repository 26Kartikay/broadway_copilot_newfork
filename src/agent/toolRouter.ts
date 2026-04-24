import { Intent } from './intentClassifier';

export function getToolsForIntent(intent: Intent, isFollowUp?: boolean): string[] {
  // If follow-up, always include search_catalog for continuity
  if (isFollowUp && intent === 'product_search') {
    return ['search_catalog'];
  }
  switch (intent) {
    case 'product_search':
      return ['search_catalog'];
    case 'color_analysis':
      return ['analyze_color_season', 'search_catalog'];
    case 'outfit':
      return ['get_outfit_suggestion', 'search_catalog'];
    case 'vibe_check':
      return ['vibe_check', 'search_catalog'];
    case 'beauty':
      return ['beauty_advisor', 'search_catalog'];
    case 'this_or_that':
      return ['this_or_that'];
    case 'memory':
      return ['recall_user_preferences', 'save_user_preference'];
    case 'brand_info':
      return ['lookup_brands', 'search_catalog'];
    case 'chitchat':
      return [];
    default:
      return [];
  }
}
