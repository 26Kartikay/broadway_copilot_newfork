import type { User } from '@prisma/client';
import type { AgentResult } from './agent';
import type { QuickReplyButton } from '../lib/chat/types';
import type { HttpReplyPayload } from './httpReplies';
import { formatColorCombos, shuffleArray } from '../data/colorAnalysisHelpers';
import {
  getPaletteData,
  isValidPalette,
  resolveSeasonalPalette,
  type ColorWithHex,
} from '../data/seasonalPalettes';
import { isGuestUser } from '../utils/user';

function hasInteractiveReplies(replies: HttpReplyPayload[]): boolean {
  return replies.some(
    (r) => r.reply_type === 'quick_reply' || r.reply_type === 'list_picker',
  );
}

function buildColorAnalysisCardPayload(color: Record<string, unknown>): HttpReplyPayload | null {
  if (color.error) return null;

  if (
    typeof color.palette_name === 'string' &&
    isValidPalette(color.palette_name) &&
    Array.isArray(color.top_colors) &&
    (color.top_colors as unknown[]).length > 0
  ) {
    return {
      reply_type: 'color_analysis_card',
      palette_name: color.palette_name,
      description: String(color.description ?? ''),
      top_colors: color.top_colors as ColorWithHex[],
      two_color_combos: (color.two_color_combos as ColorWithHex[][]) ?? [],
      user_image_url:
        typeof color.user_image_url === 'string' ? color.user_image_url : null,
    };
  }

  const raw = String(color.season ?? color.palette_name ?? '');
  const canonical = resolveSeasonalPalette(raw);
  if (!canonical) return null;
  const paletteData = getPaletteData(canonical);
  return {
    reply_type: 'color_analysis_card',
    palette_name: canonical,
    description: paletteData.description,
    top_colors: shuffleArray([...paletteData.topColors]),
    two_color_combos: shuffleArray(
      formatColorCombos(paletteData.twoColorCombos, paletteData.topColors),
    ),
    user_image_url: typeof color.user_image_url === 'string' ? color.user_image_url : null,
  };
}

function buildVibeCheckCardPayload(vc: Record<string, unknown>): HttpReplyPayload | null {
  if (vc.error) return null;

  const fit =
    typeof vc.fit === 'object' && vc.fit !== null
      ? {
          score: Number((vc.fit as { score?: number }).score ?? 0),
          explanation: String((vc.fit as { explanation?: string }).explanation ?? ''),
        }
      : {
          score: Number(vc.fit_silhouette_score ?? 0),
          explanation: String(vc.fit_silhouette_explanation ?? ''),
        };

  const hair_and_skin =
    typeof vc.hair_and_skin === 'object' && vc.hair_and_skin !== null
      ? {
          score: Number((vc.hair_and_skin as { score?: number }).score ?? 0),
          explanation: String(
            (vc.hair_and_skin as { explanation?: string }).explanation ?? '',
          ),
        }
      : {
          score: Number(vc.color_harmony_score ?? 0),
          explanation: String(vc.color_harmony_explanation ?? ''),
        };

  const accessories =
    typeof vc.accessories === 'object' && vc.accessories !== null
      ? {
          score: Number((vc.accessories as { score?: number }).score ?? 0),
          explanation: String((vc.accessories as { explanation?: string }).explanation ?? ''),
        }
      : {
          score: Number(vc.styling_details_score ?? 0),
          explanation: String(vc.styling_details_explanation ?? ''),
        };

  if (vc.comment == null && !fit.explanation && !hair_and_skin.explanation) {
    return null;
  }

  const recommendations = Array.isArray(vc.recommendations)
    ? (vc.recommendations as unknown[]).map(String)
    : [];

  const vibeCheckResult =
    typeof vc.vibe_check_result === 'number'
      ? vc.vibe_check_result
      : (fit.score + hair_and_skin.score + accessories.score) / 3;

  return {
    reply_type: 'vibe_check_card',
    comment: String(vc.comment ?? ''),
    fit,
    hair_and_skin,
    accessories,
    vibe_check_result: Number(vibeCheckResult),
    recommendations,
    user_image_url: typeof vc.user_image_url === 'string' ? vc.user_image_url : null,
  };
}

export function formatReplies(
  result: AgentResult,
  options?: { user?: User | null },
): HttpReplyPayload[] {
  const replies: HttpReplyPayload[] = [];
  const user = options?.user;

  if (result.text?.trim()) {
    replies.push({
      reply_type: 'text',
      reply_text: result.text.trim(),
    });
  }

  if (result.products && result.products.length > 0) {
    replies.push({
      reply_type: 'product_card',
      products: result.products.map((p: any) => ({
        name: p.name,
        brand: p.brand ?? '',
        imageUrl: p.imageUrl ?? p.image_url,
        description: p.generalTag ?? p.description,
        colors: p.colors,
        reason: p.reason,
        productLink: p.productLink ?? p.product_link,
      })),
      reply_text: 'Here are some pieces I found for you:',
    });

    replies.push({
      reply_type: 'quick_reply',
      reply_text: 'What would you like to do next?',
      buttons: [
        { id: 'show_more', text: 'Show me more' },
        { id: 'outfit_ideas', text: 'Outfit ideas' },
        { id: 'main_menu', text: 'Main menu' },
      ],
    });
  }

  const color = result.colorAnalysis as Record<string, unknown> | null;
  if (color) {
    const card = buildColorAnalysisCardPayload(color);
    if (card && card.reply_type === 'color_analysis_card') {
      replies.push(card);

      if (isGuestUser(user)) {
        const paletteLabel = card.palette_name;
        replies.push({
          reply_type: 'quick_reply',
          reply_text: `Now that we know you're a ${paletteLabel}, would you like to see some products from your palette?`,
          buttons: [
            { text: 'Yes, please!', id: 'product_recommendation_yes' },
            { text: 'No, thanks', id: 'product_recommendation_no' },
          ],
        });
      } else {
        replies.push({
          reply_type: 'quick_reply',
          reply_text: 'Do you want to save this color analysis result?',
          buttons: [
            { text: 'Yes', id: 'save_color_analysis_yes' },
            { text: 'No', id: 'save_color_analysis_no' },
          ],
        });
      }
    }
  }

  const vc = result.vibeCheck as Record<string, unknown> | null;
  if (vc) {
    const vibeCard = buildVibeCheckCardPayload(vc);
    if (vibeCard && vibeCard.reply_type === 'vibe_check_card') {
      replies.push(vibeCard);
      replies.push({
        reply_type: 'quick_reply',
        reply_text:
          'Based on that feedback, shall I recommend some products to complete the look?',
        buttons: [
          { text: 'Yes, please!', id: 'product_recommendation_yes' },
          { text: 'No, thanks', id: 'product_recommendation_no' },
        ],
      });
    }
  }

  if (replies.length === 0) {
    replies.push({
      reply_type: 'text',
      reply_text:
        "I'm here when you're ready — tell me what you're shopping for or tap a shortcut below.",
    });
  }

  if (!hasInteractiveReplies(replies)) {
    replies.push({
      reply_type: 'quick_reply',
      reply_text: 'Pick a shortcut or keep typing ✨',
      buttons: [
        { id: 'main_menu', text: 'Main menu' },
        { id: 'style_studio', text: 'Style Studio' },
        { id: 'skin_lab', text: 'Skin Lab' },
      ],
    });
  }

  return replies;
}
