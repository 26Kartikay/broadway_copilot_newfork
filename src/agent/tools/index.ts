import { searchCatalog } from './catalog';
import { analyzeColorSeason } from './colorAnalysis';
import { saveUserPreference, recallUserPreferences } from './memory';
import { vibeCheck } from './vibeCheck';
import { getOutfitSuggestion } from './styling';
import { thisOrThat } from './thisOrThat';
import { beautyAdvisor } from './beautyAdvisor';
import { logger } from '../../utils/logger';

export const ANTHROPIC_TOOLS: any[] = [
  {
    name: "search_catalog",
    description: "Search Broadway's product catalog. Call this whenever user wants to see products, get recommendations, browse items, or needs styling suggestions. Always call this instead of making up products.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query (e.g., 'blue dress', 'denim jacket')" },
        category: { type: "string", description: "CLOTHING_FASHION | BEAUTY_PERSONAL_CARE | JEWELLERY_ACCESSORIES | FOOTWEAR | BAGS_LUGGAGE" },
        colors: { type: "array", items: { type: "string" }, description: "filter by color" },
        occasions: { type: "array", items: { type: "string" }, description: "filter by occasion" },
        style: { type: "string", description: "Athleisure | Minimal | Streetwear | etc" },
        colorSeason: { type: "string", description: "User's color season for filtering colors" },
        limit: { type: "number", description: "Number of products to return (max 12)" }
      }
    }
  },
  {
    name: "analyze_color_season",
    description: "Analyze user's seasonal color palette from a selfie or physical description. Call when user uploads a photo of themselves or asks about their color season.",
    input_schema: {
      type: "object",
      properties: {
        imageBase64: { type: "string", description: "Base64 encoded image data" },
        mimeType: { type: "string", description: "MIME type of the image (e.g., 'image/jpeg')" },
        skinTone: { type: "string", description: "Description of user's skin tone if no image" },
        hairColor: { type: "string", description: "Description of user's hair color if no image" },
        eyeColor: { type: "string", description: "Description of user's eye color if no image" },
        userId: { type: "string", description: "The unique identifier for the user" }
      },
      required: ["userId"]
    }
  },
  {
    name: "save_user_preference",
    description: "Silently save something the user mentioned about their style, preferences, dislikes, or lifestyle. Call this whenever user reveals any preference without interrupting the conversation.",
    input_schema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "The user ID" },
        preference: { type: "string", description: "The style or lifestyle preference mentioned" }
      },
      required: ["userId", "preference"]
    }
  },
  {
    name: "recall_user_preferences",
    description: "Recall what you know about this user - their color season, style preferences, past interactions. Call at the start of sessions or when you need to personalize a response.",
    input_schema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "The user ID" },
        context: { type: "string", description: "Optional context to search for specific memories" }
      },
      required: ["userId"]
    }
  },
  {
    name: "vibe_check",
    description: "Score and analyze an outfit the user has shared. Call when user sends an outfit photo or asks for outfit feedback.",
    input_schema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "The user ID" },
        imageBase64: { type: "string", description: "Base64 encoded image data" },
        mimeType: { type: "string", description: "MIME type of the image" },
        description: { type: "string", description: "Description of the outfit if no image" }
      },
      required: ["userId"]
    }
  },
  {
    name: "get_outfit_suggestion",
    description: "Build a complete outfit recommendation for a specific occasion. Call when user asks what to wear for an event, needs a full look, or asks for outfit help.",
    input_schema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "The user ID" },
        occasion: { type: "string", description: "The occasion for the outfit" },
        colorSeason: { type: "string", description: "User's color season" },
        style: { type: "string", description: "Requested style" },
        existingPieces: { type: "array", items: { type: "string" }, description: "Items user already has" }
      },
      required: ["userId", "occasion"]
    }
  },
  {
    name: "this_or_that",
    description: "Compare two items and recommend which suits the user better based on their profile. Call when user shares two options and wants help deciding.",
    input_schema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "The user ID" },
        imageABase64: { type: "string", description: "Base64 image of option A" },
        imageBBase64: { type: "string", description: "Base64 image of option B" },
        mimeType: { type: "string", description: "MIME type of the images" },
        productIdA: { type: "string", description: "Product ID of option A" },
        productIdB: { type: "string", description: "Product ID of option B" },
        context: { type: "string", description: "Optional context for the decision" }
      },
      required: ["userId"]
    }
  },
  {
    name: "beauty_advisor",
    description: "Recommend beauty, skincare, or makeup products. Call when user asks about skincare routines, makeup, or beauty products.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["skincare", "makeup", "haircare"] },
        concern: { type: "string", description: "Beauty concern (e.g., 'acne', 'dryness')" },
        skinType: { type: "string", description: "User's skin type" },
        occasion: { type: "string", description: "The event context" },
        colorSeason: { type: "string", description: "User's color season for makeup" }
      }
    }
  }
];

export async function executeTool(name: string, input: any, userId: string, userImages: any[] = []) {
  logger.info({ tool: name, userId, imageCount: userImages.length }, 'Executing tool');
  try {
    switch (name) {
      case 'search_catalog':
        return { toolName: name, ...(await searchCatalog(input)) };
      case 'analyze_color_season':
        // Inject latest user image if tool needs it
        if (!input.imageBase64 && userImages.length > 0) {
          input.imageBase64 = userImages[0].source.data;
          input.mimeType = userImages[0].source.media_type;
        }
        return { toolName: name, ...(await analyzeColorSeason({ ...input, userId })) };
      case 'save_user_preference':
        return { toolName: name, ...(await saveUserPreference({ ...input, userId })) };
      case 'recall_user_preferences':
        return { toolName: name, ...(await recallUserPreferences({ ...input, userId })) };
      case 'vibe_check':
        // Inject latest user image if tool needs it
        if (!input.imageBase64 && userImages.length > 0) {
          input.imageBase64 = userImages[0].source.data;
          input.mimeType = userImages[0].source.media_type;
        }
        return { toolName: name, ...(await vibeCheck({ ...input, userId })) };
      case 'get_outfit_suggestion':
        return { toolName: name, ...(await getOutfitSuggestion({ ...input, userId })) };
      case 'this_or_that':
        // Inject user images if tool needs them
        if (!input.imageABase64 && userImages.length >= 1) {
          input.imageABase64 = userImages[0].source.data;
          input.mimeType = userImages[0].source.media_type;
        }
        if (!input.imageBBase64 && userImages.length >= 2) {
          input.imageBBase64 = userImages[1].source.data;
          input.mimeType = userImages[1].source.media_type;
        }
        return { toolName: name, ...(await thisOrThat({ ...input, userId })) };
      case 'beauty_advisor':
        return { toolName: name, ...(await beautyAdvisor(input)) };
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    logger.error({ tool: name, err, userId }, 'Tool execution failed');
    return { toolName: name, error: String(err) };
  }
}
