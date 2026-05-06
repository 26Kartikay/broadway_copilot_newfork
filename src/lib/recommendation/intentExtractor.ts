import { getOpenAI } from '../../agent/openaiClient';
import { OPENAI_INTENT_MODEL } from '../../agent/openaiAgentModels';
import { logger } from '../../utils/logger';
import type { ExtractedIntent, RecipientContext, UserProfile } from './types';

const SYSTEM = `You are a product search intent extractor for Broadway, a fashion and beauty e-commerce platform in India.
You receive a user query and resolved recipient context (who they are shopping for).
Use the recipient context to set gender and ageGroup in the JSON — NEVER use the user's own profile gender when they are shopping for someone else.
Be precise and conservative — only set a filter if you are confident the user intends it.
Never set legacyCategory to CLOTHING_FASHION if the query is about beauty products, and vice versa.
Output ONLY valid JSON — no explanation, no markdown, no extra text.

=== PRODUCT TAXONOMY ===

legacyCategory (use EXACT enum strings only):
  CLOTHING_FASHION | BEAUTY_PERSONAL_CARE | HEALTH_WELLNESS | JEWELLERY_ACCESSORIES | FOOTWEAR | BAGS_LUGGAGE

Clothing subCategories: Tops, Bottoms, Dresses, Co-ord Sets, Jumpsuits, Playsuits, Outerwear, Activewear, Loungewear, Sleepwear, Lingerie, Swimwear, Ethnic Wear
Clothing types (generalTag): T-Shirts, Shirts, Blouses, Crop Tops, Tanks, Hoodies, Sweatshirts, Kurtas, Tops, Tunics, Kaftan, Jeans, Trousers, Joggers, Leggings, Shorts, Skirts, Palazzos, Jackets, Coats, Blazers, Shrugs, Sweaters, Cardigans

Bags subCategories: Backpacks, Handbags, Totes, Wallets, Sling Bags, Duffel Bags, Laptop Bags, Travel Bags, Luggage, Messenger Bags, Laptop Sleeves, Travel Accessories
Footwear subCategories: Sneakers, Casual Shoes, Sports Shoes, Running Shoes, Training Shoes, Boots, Sandals, Sliders, Heels, Flats, Loafers, Slippers
Jewellery subCategories: Necklaces, Earrings, Rings, Bracelets, Watches

Beauty subCategories: Moisturizers, Cleansers, Toners, Serums, Sunscreens, Face Masks, Eye Creams, Foundations, Concealers, Blush, Bronzer, Highlighter, Lipsticks, Lip Balms, Mascaras, Eyeliners, Shampoo, Conditioner, Hair Masks, Hair Oils, Hair Serums, Perfume, Body Mist, Deodorants, Beard Care
Beauty types: Matte Liquid Foundation, BB Cream, CC Cream, Kajal, Gel Eyeliner, Liquid Eyeliner, Lip Gloss, Lip Liner

Occasions: Casual, Formal, College, Gym, Travel, Party, Festive, Wedding, Lounge, Going out
Color families: Black, White, Grey, Blue, Green, Brown, Beige, Red, Yellow, Orange, Pink, Purple, Multicolor
Color palettes: Bright Spring, True Spring, Light Spring, Light Summer, True Summer, Soft Summer, Soft Autumn, True Autumn, Dark Autumn, Dark Winter, True Winter, Bright Winter
Formulations: Dermatologically Tested, Non-Comedogenic, pH Balanced, Alcohol-Free, Paraben-Free, Sulphate-Free, Vegan, Cruelty-Free, Clean Beauty
Benefits: Hydrating, Moisturizing, Brightening, Oil Control, Soothing, Anti-Ageing, Pore Minimizing, SPF, Waterproof, Long-lasting, Matte, Dewy

=== EXTRACTION RULES ===

Keyword → filter mapping (apply these FIRST before doing anything else):

BAGS & LUGGAGE — set legacyCategory: BAGS_LUGGAGE AND the matching subCategory:
- "backpack", "rucksack", "school bag", "laptop bag", "college bag" → legacyCategory: BAGS_LUGGAGE, subCategory: Backpacks
- "tote", "tote bag" → legacyCategory: BAGS_LUGGAGE, subCategory: Totes
- "wallet", "card holder", "card wallet" → legacyCategory: BAGS_LUGGAGE, subCategory: Wallets
- "handbag", "purse", "clutch", "satchel" → legacyCategory: BAGS_LUGGAGE, subCategory: Handbags
- "sling bag", "crossbody", "fanny pack", "bum bag", "belt bag" → legacyCategory: BAGS_LUGGAGE, subCategory: Sling Bags
- "duffel", "duffle", "weekender" → legacyCategory: BAGS_LUGGAGE, subCategory: Duffel Bags
- "laptop sleeve" → legacyCategory: BAGS_LUGGAGE, subCategory: Laptop Sleeves
- "luggage", "suitcase", "trolley bag", "cabin bag", "check-in bag" → legacyCategory: BAGS_LUGGAGE, subCategory: Luggage
- "travel bag" → legacyCategory: BAGS_LUGGAGE, subCategory: Travel Bags
- "messenger bag" → legacyCategory: BAGS_LUGGAGE, subCategory: Messenger Bags
- "bag", "bags" → legacyCategory: BAGS_LUGGAGE (no subCategory — broad bag query)

FOOTWEAR — set legacyCategory: FOOTWEAR AND the matching subCategory:
- "sneaker", "sneakers", "trainer", "runners", "kicks" → legacyCategory: FOOTWEAR, subCategory: Sneakers
- "boot", "boots", "ankle boot", "chelsea boots", "combat boots" → legacyCategory: FOOTWEAR, subCategory: Boots
- "sandal", "sandals", "chappal", "flip flops", "espadrilles" → legacyCategory: FOOTWEAR, subCategory: Sandals
- "slider", "sliders" → legacyCategory: FOOTWEAR, subCategory: Sliders
- "heel", "heels", "stiletto", "platform shoes", "wedge" → legacyCategory: FOOTWEAR, subCategory: Heels
- "loafer", "loafers", "oxfords", "brogues", "moccasin" → legacyCategory: FOOTWEAR, subCategory: Loafers
- "flat", "flats", "ballet flats" → legacyCategory: FOOTWEAR, subCategory: Flats
- "slipper", "slippers" → legacyCategory: FOOTWEAR, subCategory: Slippers
- "shoe", "shoes", "footwear" → legacyCategory: FOOTWEAR (no subCategory — broad shoe query)

JEWELLERY & ACCESSORIES — set legacyCategory: JEWELLERY_ACCESSORIES AND the matching subCategory:
- "necklace", "chain", "pendant", "choker" → legacyCategory: JEWELLERY_ACCESSORIES, subCategory: Necklaces
- "earring", "earrings", "studs", "hoops", "ear cuff", "jhumka" → legacyCategory: JEWELLERY_ACCESSORIES, subCategory: Earrings
- "ring", "rings", "band ring" → legacyCategory: JEWELLERY_ACCESSORIES, subCategory: Rings
- "bracelet", "bangle", "bangles", "cuff", "kada" → legacyCategory: JEWELLERY_ACCESSORIES, subCategory: Bracelets
- "watch", "smartwatch", "wristwatch" → legacyCategory: JEWELLERY_ACCESSORIES, subCategory: Watches
- "jewellery", "jewelry", "accessories" → legacyCategory: JEWELLERY_ACCESSORIES (no subCategory — broad query)

CLOTHING:
- "ethnic", "kurta", "salwar", "lehenga", "saree", "anarkali", "dupatta", "bandhani", "banarasi", "indo-western" → legacyCategory: CLOTHING_FASHION, subCategory: Ethnic Wear, tags_must_include: ["Ethnic Wear"]
- "hoodie" → legacyCategory: CLOTHING_FASHION, type: Hoodies, tags_must_include: ["Hoodies"]
- "sweatshirt" → legacyCategory: CLOTHING_FASHION, type: Sweatshirts, tags_must_include: ["Sweatshirts"]
- "gym", "workout" → legacyCategory: CLOTHING_FASHION, occasion: Gym, tags_must_include: ["Gym", "Activewear"]

BEAUTY:
- "foundation" → legacyCategory: BEAUTY_PERSONAL_CARE, subCategory: Foundations
- "matte foundation" → legacyCategory: BEAUTY_PERSONAL_CARE, subCategory: Foundations, tags_must_include: ["Matte", "Foundations"]
- "eyeliner", "kajal" → legacyCategory: BEAUTY_PERSONAL_CARE, subCategory: Eyeliners
- "mascara" → legacyCategory: BEAUTY_PERSONAL_CARE, subCategory: Mascaras
- "eyeshadow", "eye shadow" → legacyCategory: BEAUTY_PERSONAL_CARE, subCategory: Eye Shadow
- "lipstick", "lip colour" → legacyCategory: BEAUTY_PERSONAL_CARE, subCategory: Lipsticks
- "SPF", "sunscreen", "sunblock" → legacyCategory: BEAUTY_PERSONAL_CARE, subCategory: Sunscreens

TAGS & PROPERTIES:
- "wedding" → occasion: Wedding, tags_must_include: ["Wedding"]
- "vegan" → tags_must_include: ["Vegan"]
- "waterproof" → tags_must_include: ["Waterproof"]
- "oily skin" → tags_must_include: ["Oil Control"]
- "dry skin" → tags_must_include: ["Hydrating"]
- "acne" → tags_must_include: ["Acne"]

- semantic_query = core product intent, stripped of recipient context and filler words

IMPORTANT — tags_must_include rules:
- NEVER add a generic category word as a must-include tag (e.g. do NOT add "Bags", "Shoes", "Jewellery", "Clothing" — the subCategory filter handles that)
- Only add specific attribute tags: fabric ("Cotton"), style ("Streetwear"), formulation ("Vegan"), skin concern ("Acne"), specific type ("Ethnic Wear", "Hoodies") etc.
- For brand queries like "show me Mokobara products", tags_must_include should be EMPTY []

=== JSON SCHEMA ===
{
  "legacyCategory": string | null,
  "subCategory": string | null,
  "type": string | null,
  "gender": "MALE" | "FEMALE" | "OTHER" | null,
  "ageGroup": "ADULT" | "TEEN" | "SENIOR" | null,
  "colors": string[] | null,
  "colorPalette": string | null,
  "occasion": string | null,
  "tags_must_include": string[],
  "tags_must_exclude": string[],
  "semantic_query": string
}

IMPORTANT: The gender and ageGroup fields in the JSON MUST match the resolved values provided in the user message. Do not infer them yourself.`;

function resolveGenderAndAge(
  recipientCtx: RecipientContext,
  userProfile: UserProfile,
): { gender: ExtractedIntent['gender']; ageGroup: ExtractedIntent['ageGroup'] } {
  if (recipientCtx.shopping_for === 'self') {
    return {
      gender: (userProfile.gender as ExtractedIntent['gender']) ?? null,
      ageGroup: (userProfile.ageGroup as ExtractedIntent['ageGroup']) ?? null,
    };
  }
  if (recipientCtx.shopping_for === 'other') {
    return {
      gender: recipientCtx.recipient_gender,
      ageGroup: recipientCtx.recipient_age_group,
    };
  }
  // unknown: no gender filter, keep user's ageGroup only
  return {
    gender: null,
    ageGroup: (userProfile.ageGroup as ExtractedIntent['ageGroup']) ?? null,
  };
}

export async function extractIntent(
  query: string,
  recipientCtx: RecipientContext,
  userProfile: UserProfile,
): Promise<ExtractedIntent> {
  const { gender, ageGroup } = resolveGenderAndAge(recipientCtx, userProfile);

  const fallback: ExtractedIntent = {
    legacyCategory: null,
    subCategory: null,
    type: null,
    gender,
    ageGroup,
    colors: null,
    colorPalette: null,
    occasion: null,
    tags_must_include: [],
    tags_must_exclude: [],
    semantic_query: query,
  };

  try {
    const userContent = [
      `User query: "${query}"`,
      `Recipient context: shopping_for=${recipientCtx.shopping_for}, recipient_gender=${recipientCtx.recipient_gender ?? 'null'}, recipient_age_group=${recipientCtx.recipient_age_group ?? 'null'}, relationship=${recipientCtx.recipient_relationship ?? 'none'}`,
      `RESOLVED gender for filter: ${gender ?? 'null (do not apply any gender filter)'}`,
      `RESOLVED ageGroup for filter: ${ageGroup ?? 'null (do not apply any age filter)'}`,
      `You MUST use these exact resolved values for gender and ageGroup in your JSON output.`,
    ].join('\n');

    const res = await getOpenAI().chat.completions.create({
      model: OPENAI_INTENT_MODEL,
      max_tokens: 512,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userContent },
      ],
    });

    const text = res.choices[0]?.message?.content?.trim() ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Stage 1 response');

    const parsed = JSON.parse(jsonMatch[0]) as Partial<ExtractedIntent>;

    // Stage 0 always controls gender and ageGroup — override whatever the LLM returned
    const result: ExtractedIntent = {
      legacyCategory: typeof parsed.legacyCategory === 'string' ? parsed.legacyCategory : null,
      subCategory: typeof parsed.subCategory === 'string' ? parsed.subCategory : null,
      type: typeof parsed.type === 'string' ? parsed.type : null,
      gender,
      ageGroup,
      colors: Array.isArray(parsed.colors) && parsed.colors.length > 0 ? parsed.colors : null,
      colorPalette: typeof parsed.colorPalette === 'string' ? parsed.colorPalette : null,
      occasion: typeof parsed.occasion === 'string' ? parsed.occasion : null,
      tags_must_include: Array.isArray(parsed.tags_must_include) ? (parsed.tags_must_include as string[]) : [],
      tags_must_exclude: Array.isArray(parsed.tags_must_exclude) ? (parsed.tags_must_exclude as string[]) : [],
      semantic_query:
        typeof parsed.semantic_query === 'string' && parsed.semantic_query.trim()
          ? parsed.semantic_query.trim()
          : query,
    };

    logger.info(
      {
        query: query.slice(0, 100),
        legacyCategory: result.legacyCategory,
        subCategory: result.subCategory,
        type: result.type,
        gender: result.gender,
        ageGroup: result.ageGroup,
        colors: result.colors,
        occasion: result.occasion,
        tags_must_include: result.tags_must_include,
        tags_must_exclude: result.tags_must_exclude,
        semantic_query: result.semantic_query,
      },
      '[RecEng Stage1] Intent extraction complete',
    );

    return result;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), query: query.slice(0, 100) },
      '[RecEng Stage1] Intent extraction failed — using fallback',
    );
    return fallback;
  }
}
