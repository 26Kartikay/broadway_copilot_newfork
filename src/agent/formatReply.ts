import type { User } from '@prisma/client';
import { formatColorCombos, shuffleArray } from '../data/colorAnalysisHelpers';
import {
  getPaletteData,
  isValidPalette,
  resolveSeasonalPalette,
  type ColorWithHex,
} from '../data/seasonalPalettes';
import { isGuestUser } from '../utils/user';
import type { HttpReplyPayload } from './httpReplies';
import { AgentResult } from './orchestrator';
import { sanitizeAssistantProductReply } from './sanitizeAssistantProductReply';


export function buildColorAnalysisCardPayload(
  color: Record<string, unknown>,
): HttpReplyPayload | null {
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
      user_image_url: typeof color.user_image_url === 'string' ? color.user_image_url : null,
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

export function buildVibeCheckCardPayload(vc: Record<string, unknown>): HttpReplyPayload | null {
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
          explanation: String((vc.hair_and_skin as { explanation?: string }).explanation ?? ''),
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
  options?: {
    user?: User | null;
    skipColorSavePrompt?: boolean;
    /** Current HTTP request display name — guest placeholder applies guest UI even if DB is stale. */
    requestProfileName?: string | null | undefined;
  },
): HttpReplyPayload[] {
  const replies: HttpReplyPayload[] = [];
  const user = options?.user;
  const skipColorSavePrompt = Boolean(options?.skipColorSavePrompt);
  const requestProfileName = options?.requestProfileName;

  const hasProducts = Boolean(result.products && result.products.length > 0);
  const rawText = result.text?.trim() ?? '';
  const textForUser = hasProducts ? sanitizeAssistantProductReply(rawText) : rawText;
  if (textForUser) {
    replies.push({
      reply_type: 'text',
      reply_text: textForUser,
    });
  }

  if (result.products && result.products.length > 0) {
    replies.push({
      reply_type: 'product_card',
      products: result.products.map((p: any) => {
        const link = p.productLink ?? p.product_link;
        return {
          name: '',
          brand: p.brand ?? '',
          imageUrl: p.imageUrl ?? p.image_url,
          ...(typeof link === 'string' && link.trim() !== '' ? { productLink: link } : {}),
        };
      }),
      reply_text: '',
    });
  }

  const color = result.colorAnalysis as Record<string, unknown> | null;
  if (color) {
    const card = buildColorAnalysisCardPayload(color);
    if (card && card.reply_type === 'color_analysis_card') {
      if (isGuestUser(user, requestProfileName)) {
        replies.push({
          reply_type: 'text',
          reply_text:
            "Guest mode doesn’t save a color profile to your account — this read is just for now. Here's your card.",
        });
      }
      replies.push(card);

    }
  }

  const vc = result.vibeCheck as Record<string, unknown> | null;
  if (vc) {
    const vibeCard = buildVibeCheckCardPayload(vc);
    if (vibeCard && vibeCard.reply_type === 'vibe_check_card') {
      if (isGuestUser(user, requestProfileName)) {
        replies.push({
          reply_type: 'text',
          reply_text:
            'Guest mode can’t save vibe checks to a profile, but you still get the full score card below.',
        });
      }
      replies.push(vibeCard);
    }
  }

  if (replies.length === 0) {
    replies.push({
      reply_type: 'text',
      reply_text: "I'm here when you're ready — tell me what you're shopping for.",
    });
  }

  return replies;
}
