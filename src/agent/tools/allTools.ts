import { z } from 'zod';
import { Tool } from '../../lib/ai/core/tools';
import { MessageInput } from '../../lib/chat/types';
import { beautyAdvisor } from './beautyAdvisor';
import { searchCatalog } from './catalog';
import { analyzeColorSeason } from './colorAnalysis';
import { recallUserPreferences, saveUserPreference } from './memory';
import { getOutfitSuggestion } from './styling';
import { thisOrThat } from './thisOrThat';
import { vibeCheck } from './vibeCheck';

function cleanArgs(args: any): any {
  const result: any = {};
  for (const key in args) {
    if (args[key] !== undefined) {
      result[key] = args[key];
    }
  }
  return result;
}

export function getTools(userId: string, userImages: any[], messageInput: MessageInput): Tool[] {
  const sourceImageUrl = messageInput.MediaUrl0;

  return [
    new Tool({
      name: 'search_catalog',
      description:
        "Search Broadway's product catalog using semantic vector similarity. Call when the user wants products, recommendations, or browsing. Pass a rich natural-language query plus category, colors, occasions, style, and colorSeason when known.",
      schema: z.object({
        query: z.string().describe("The search query (e.g., 'blue dress', 'denim jacket')"),
        category: z
          .string()
          .optional()
          .describe(
            'CLOTHING_FASHION | BEAUTY_PERSONAL_CARE | JEWELLERY_ACCESSORIES | FOOTWEAR | BAGS_LUGGAGE',
          ),
        colors: z.array(z.string()).optional().describe('filter by color'),
        occasions: z.array(z.string()).optional().describe('filter by occasion'),
        style: z.string().optional().describe('Athleisure | Minimal | Streetwear | etc'),
        colorSeason: z.string().optional().describe("User's color season for filtering colors"),
        limit: z.number().optional().describe('Number of products to return (max 12)'),
      }),
      func: (args) => searchCatalog(cleanArgs(args)),
    }),
    new Tool({
      name: 'analyze_color_season',
      description:
        "Analyze user's seasonal color palette from a selfie or physical description. Call when user uploads a photo of themselves or asks about their color season.",
      schema: z.object({
        imageBase64: z.string().optional().describe('Base64 encoded image data'),
        mimeType: z.string().optional().describe('MIME type of the image'),
        skinTone: z.string().optional().describe("Description of user's skin tone if no image"),
        hairColor: z.string().optional().describe("Description of user's hair color if no image"),
        eyeColor: z.string().optional().describe("Description of user's eye color if no image"),
      }),
      func: async (args) => {
        const input: any = cleanArgs(args);
        if (!input.imageBase64 && userImages.length > 0) {
          input.imageBase64 = userImages[0].source.data;
          input.mimeType = userImages[0].source.media_type;
        }
        return analyzeColorSeason({ ...input, userId, sourceImageUrl });
      },
    }),
    new Tool({
      name: 'save_user_preference',
      description:
        'Silently save something the user mentioned about their style, preferences, dislikes, or lifestyle. Call this whenever user reveals any preference without interrupting the conversation.',
      schema: z.object({
        preference: z.string().describe('The style or lifestyle preference mentioned'),
      }),
      func: (args) => saveUserPreference({ ...cleanArgs(args), userId }),
    }),
    new Tool({
      name: 'recall_user_preferences',
      description:
        'Recall what you know about this user - their color season, style preferences, past interactions.',
      schema: z.object({
        context: z.string().optional().describe('Optional context to search for specific memories'),
      }),
      func: (args) => recallUserPreferences({ ...cleanArgs(args), userId }),
    }),
    new Tool({
      name: 'vibe_check',
      description:
        'Score and analyze an outfit the user has shared. Call when user sends an outfit photo or asks for outfit feedback.',
      schema: z.object({
        description: z.string().optional().describe('Description of the outfit if no image'),
        tonality: z.string().optional().describe('savage | friendly | hype_bff'),
      }),
      func: async (args) => {
        const input: any = cleanArgs(args);
        if (userImages.length > 0) {
          input.imageBase64 = userImages[0].source.data;
          input.mimeType = userImages[0].source.media_type;
        }
        return vibeCheck({ ...input, userId, sourceImageUrl });
      },
    }),
    new Tool({
      name: 'get_outfit_suggestion',
      description:
        'Build a complete outfit recommendation for a specific occasion. Call when user asks what to wear for an event, needs a full look, or asks for outfit help.',
      schema: z.object({
        occasion: z.string().describe('The occasion for the outfit'),
        colorSeason: z.string().optional().describe("User's color season"),
        style: z.string().optional().describe('Requested style'),
        existingPieces: z.array(z.string()).optional().describe('Items user already has'),
      }),
      func: (args) => getOutfitSuggestion({ ...cleanArgs(args), userId }),
    }),
    new Tool({
      name: 'this_or_that',
      description:
        'Compare two items and recommend which suits the user better based on their profile. Call when user shares two options and wants help deciding.',
      schema: z.object({
        productIdA: z.string().optional().describe('Product ID of option A'),
        productIdB: z.string().optional().describe('Product ID of option B'),
        context: z.string().optional().describe('Optional context for the decision'),
      }),
      func: async (args) => {
        const input: any = cleanArgs(args);
        if (userImages.length >= 1) {
          input.imageABase64 = userImages[0].source.data;
          input.mimeType = userImages[0].source.media_type;
        }
        if (userImages.length >= 2) {
          input.imageBBase64 = userImages[1].source.data;
        }
        return thisOrThat({ ...input, userId });
      },
    }),
    new Tool({
      name: 'beauty_advisor',
      description:
        'Recommend beauty, skincare, or makeup products. Call when user asks about skincare routines, makeup, or beauty products.',
      schema: z.object({
        category: z.enum(['skincare', 'makeup', 'haircare']).optional(),
        concern: z.string().optional().describe("Beauty concern (e.g., 'acne', 'dryness')"),
        skinType: z.string().optional().describe("User's skin type"),
        occasion: z.string().optional().describe('The event context'),
        colorSeason: z.string().optional().describe("User's color season for makeup"),
      }),
      func: (args) => beautyAdvisor(cleanArgs(args)),
    }),
  ];
}
