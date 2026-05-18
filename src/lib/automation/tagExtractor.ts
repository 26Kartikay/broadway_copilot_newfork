import OpenAI from 'openai';
import { logger } from '../../utils/logger';
import { openAiAutomationConfig } from './config';
import type { BroadwayApiProduct, ExtractedTags } from './types';
import {
  fetchImageAsJpegDataUrl,
  isUnsupportedImageApiError,
  normalizeCsvImageUrl,
  shouldPrefetchImageForVision,
} from './visionImageUrl';

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

const SYSTEM = `You are a product taxonomy tagger for Broadway, a fashion and beauty e-commerce platform in India.
You will receive the product name, brand, category hint, and description text, and may also see a product image.
Return a single JSON object (no markdown) with normalized taxonomy tags AND a formattedDescription that follows the exact layout below.

=== formattedDescription (required) — use real newlines between lines; ~50 words in the "Description:" paragraph ===
[Product Name] - [Brand]
[Category label]: [Type/SubCategory]   (use legacyCategory-style label, e.g. CLOTHING_FASHION, and concrete type/subcategory)
Description: [2–4 sentences: features, benefits, use case — synthesize from text + image when available]
Attributes: [comma-separated tags: occasion, style, material or formulation, fit, colors, skin/hair type, benefits, ingredients as relevant]

Use the actual product name and brand from the input on line 1. The Attributes line must reflect tags you infer (align with allTags where possible).

=== TAXONOMY ===

legacyCategory (EXACT string only): CLOTHING_FASHION | BEAUTY_PERSONAL_CARE | HEALTH_WELLNESS | JEWELLERY_ACCESSORIES | FOOTWEAR | BAGS_LUGGAGE

Clothing subCategories: Tops, Bottoms, Dresses, Co-ord Sets, Jumpsuits, Playsuits, Outerwear, Activewear, Loungewear, Sleepwear, Lingerie, Swimwear, Ethnic Wear
Clothing types: T-Shirts, Shirts, Blouses, Crop Tops, Tanks, Hoodies, Sweatshirts, Kurtas, Tops, Tunics, Kaftan, Jeans, Trousers, Joggers, Leggings, Shorts, Skirts, Palazzos, Jackets, Coats, Blazers, Shrugs, Sweaters, Cardigans

Beauty subCategories: Moisturizers, Cleansers, Toners, Serums, Sunscreens, Face Masks, Eye Creams, Foundations, Concealers, Blush, Bronzer, Highlighter, Lipsticks, Lip Balms, Mascaras, Eyeliners, Shampoo, Conditioner, Hair Masks, Hair Oils, Perfume, Body Mist, Deodorants, Beard Care
Beauty types: Matte Liquid Foundation, BB Cream, CC Cream, Kajal, Gel Eyeliner, Liquid Eyeliner, Lip Gloss, Lip Liner

Jewellery subCategories: Necklaces, Earrings, Bracelets, Rings, Anklets, Bangles, Maang Tikka, Nose Rings, Brooches, Chains
Footwear subCategories: Sneakers, Heels, Flats, Sandals, Boots, Loafers, Ethnic Footwear, Sports Shoes
Bags subCategories: Handbags, Tote Bags, Clutches, Backpacks, Sling Bags, Wallets, Travel Bags

Gender: MALE | FEMALE | OTHER (use OTHER for unisex/gender-neutral)
AgeGroup: TEEN | ADULT | SENIOR (default ADULT if not specified)
Occasions: Casual, Formal, College, Gym, Travel, Party, Festive, Wedding, Lounge, Going out
Colors: Black, White, Grey, Blue, Green, Brown, Beige, Red, Yellow, Orange, Pink, Purple, Multicolor
Style (clothing only): Athleisure, Minimal, Streetwear, Boho, Classic, Ethnic, Party, Vintage, Workwear
Fit (clothing only): Oversized, Slim, Regular, Relaxed, Fitted
Formulations (beauty): Dermatologically Tested, Non-Comedogenic, pH Balanced, Alcohol-Free, Paraben-Free, Sulphate-Free, Vegan, Cruelty-Free, Clean Beauty
Benefits (beauty): Hydrating, Moisturizing, Brightening, Oil Control, Soothing, Anti-Ageing, Pore Minimizing, SPF, Waterproof, Long-lasting, Matte, Dewy

=== RULES ===
- Never mix categories (e.g. do not set CLOTHING_FASHION for a foundation)
- allTags = comma-separated string of ALL applicable tags: subCategory, productType, occasions, colors, style, fit, formulations, benefits, brand, gender-hint
- If you cannot determine a field, set it to null (for strings) or [] (for arrays)
- Keep allTags comprehensive — it is used for full-text search
- formattedDescription: required string, follow the 4-line template above (newlines allowed)
- shortDescription: optional; may mirror the "Description:" sentence for backward compatibility

=== JSON KEYS (strict) ===
{
  "legacyCategory": string | null,
  "subCategory": string | null,
  "productType": string | null,
  "gender": "MALE" | "FEMALE" | "OTHER" | null,
  "ageGroup": "ADULT" | "TEEN" | "SENIOR" | null,
  "colors": string[],
  "occasions": string[],
  "style": string | null,
  "fit": string | null,
  "allTags": string,
  "formattedDescription": string,
  "shortDescription": string | null
}`;

const FALLBACK_TAGS: ExtractedTags = {
  legacyCategory: null,
  subCategory: null,
  productType: null,
  gender: null,
  ageGroup: null,
  colors: [],
  occasions: [],
  style: null,
  fit: null,
  allTags: '',
  shortDescription: null,
  formattedDescription: null,
};

function buildUserText(product: BroadwayApiProduct): string {
  return [
    'Analyze this product for Broadway tagging.',
    `Name: ${product.name}`,
    `Brand: ${product.brand}`,
    product.category ? `Category hint: ${product.category}` : null,
    product.description ? `Description: ${product.description.slice(0, 2000)}` : null,
    'Respond with JSON only.',
  ]
    .filter(Boolean)
    .join('\n');
}

function tagsFromParsed(parsed: Partial<ExtractedTags>): ExtractedTags {
  return {
    legacyCategory: typeof parsed.legacyCategory === 'string' ? parsed.legacyCategory : null,
    subCategory: typeof parsed.subCategory === 'string' ? parsed.subCategory : null,
    productType: typeof parsed.productType === 'string' ? parsed.productType : null,
    gender: typeof parsed.gender === 'string' ? parsed.gender : null,
    ageGroup: typeof parsed.ageGroup === 'string' ? parsed.ageGroup : null,
    colors: Array.isArray(parsed.colors) ? (parsed.colors as string[]) : [],
    occasions: Array.isArray(parsed.occasions) ? (parsed.occasions as string[]) : [],
    style: typeof parsed.style === 'string' ? parsed.style : null,
    fit: typeof parsed.fit === 'string' ? parsed.fit : null,
    allTags: typeof parsed.allTags === 'string' ? parsed.allTags : '',
    shortDescription:
      typeof parsed.shortDescription === 'string' && parsed.shortDescription.trim()
        ? parsed.shortDescription.trim()
        : null,
    formattedDescription:
      typeof parsed.formattedDescription === 'string' && parsed.formattedDescription.trim()
        ? parsed.formattedDescription.trim()
        : null,
  };
}

async function callOpenAI(
  product: BroadwayApiProduct,
  includeImage: boolean,
  /** Resolved URL or JPEG data URL; when omitted, uses product image fields. */
  visionImageUrl?: string,
): Promise<ExtractedTags> {
  const text = buildUserText(product);
  const imageUrl =
    normalizeCsvImageUrl(visionImageUrl) ||
    normalizeCsvImageUrl(product.imageUrl) ||
    '';

  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{ type: 'text', text }];

  if (includeImage && imageUrl) {
    userContent.push({
      type: 'image_url',
      image_url: { url: imageUrl, detail: 'low' },
    });
  }

  const res = await getClient().chat.completions.create({
    model: openAiAutomationConfig.tagModel,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userContent },
    ],
  });

  const raw = res.choices[0]?.message?.content?.trim() ?? '';
  if (!raw) throw new Error('Empty tag extraction response');

  const parsed = JSON.parse(raw) as Partial<ExtractedTags>;
  return tagsFromParsed(parsed);
}

async function resolveVisionInput(rawImageUrl: string): Promise<string | undefined> {
  const mode = openAiAutomationConfig.visionImageMode;
  if (shouldPrefetchImageForVision(rawImageUrl, mode)) {
    return (await fetchImageAsJpegDataUrl(rawImageUrl)) ?? rawImageUrl;
  }
  return rawImageUrl;
}

export async function extractTagsFromProduct(product: BroadwayApiProduct): Promise<ExtractedTags> {
  const rawImageUrl = normalizeCsvImageUrl(product.imageUrl);

  try {
    if (rawImageUrl) {
      const visionInput = await resolveVisionInput(rawImageUrl);
      try {
        return await callOpenAI(product, true, visionInput);
      } catch (visionErr) {
        if (isUnsupportedImageApiError(visionErr)) {
          const jpegDataUrl = await fetchImageAsJpegDataUrl(rawImageUrl);
          if (jpegDataUrl && jpegDataUrl !== visionInput) {
            try {
              return await callOpenAI(product, true, jpegDataUrl);
            } catch {
              /* fall through to text-only */
            }
          }
        }
        logger.warn(
          {
            err: visionErr instanceof Error ? visionErr.message : String(visionErr),
            barcode: product.barcode,
          },
          '[Automation] Vision tagging failed, retrying text-only',
        );
        return await callOpenAI(product, false);
      }
    }
    return await callOpenAI(product, false);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), barcode: product.barcode },
      '[Automation] Tag extraction failed — using fallback',
    );
    return FALLBACK_TAGS;
  }
}
