import type { MessageInput, QuickReplyButton } from '../lib/chat/types';
import { WELCOME_IMAGE_URL } from '../utils/constants';

const GREETING_REGEX = /\b(hi|hello|hey|heya|yo|sup)\b/i;
const MENU_REGEX = /\b(help|menu|options?|what can you do\??)\b/i;

/**
 * Same triggers as legacy routeGeneral + handleGeneral: show welcome image + list picker.
 */
export function isMainMenuTrigger(input: MessageInput): boolean {
  const bp = input.ButtonPayload;
  if (bp === 'main_menu' || bp === 'refresh_conversation_starters') {
    return true;
  }
  const body = (input.Body || input.ButtonText || '').trim();
  if (!body) {
    return false;
  }
  if (bp) {
    return false;
  }
  return GREETING_REGEX.test(body) || MENU_REGEX.test(body);
}

export type HttpReplyPayload =
  | { reply_type: 'text'; reply_text: string }
  | { reply_type: 'quick_reply'; reply_text: string; buttons: QuickReplyButton[] }
  | { reply_type: 'list_picker'; reply_text: string; buttons: QuickReplyButton[] }
  | { reply_type: 'image'; media_url: string; reply_text?: string }
  | {
      reply_type: 'product_card';
      products: Array<{
        name: string;
        brand: string;
        imageUrl: string;
        description?: string;
        colors?: string[];
        reason?: string;
        productLink?: string;
      }>;
      reply_text?: string;
    }
  | {
      reply_type: 'color_analysis_card';
      palette_name: string;
      description: string;
      top_colors: Array<{ name: string; hex: string }>;
      two_color_combos: Array<Array<{ name: string; hex: string }>>;
      user_image_url: string | null;
    }
  | {
      reply_type: 'vibe_check_card';
      comment: string;
      fit: { score: number; explanation: string };
      hair_and_skin: { score: number; explanation: string };
      accessories: { score: number; explanation: string };
      vibe_check_result: number;
      recommendations: string[];
      user_image_url: string | null;
    };

const MAIN_SERVICE_BUTTONS: QuickReplyButton[] = [
  { text: 'Vibe check', id: 'vibe_check' },
  { text: 'Color analysis', id: 'color_analysis' },
  { text: 'Style Studio', id: 'style_studio' },
  { text: 'Fashion Charades', id: 'fashion_quiz' },
  { text: 'This or That', id: 'this_or_that' },
  { text: 'Skin Lab', id: 'skin_lab' },
];

export function buildMainMenuReplies(profileName?: string): HttpReplyPayload[] {
  const name = profileName?.trim() || 'there';
  return [
    { reply_type: 'image', media_url: WELCOME_IMAGE_URL },
    {
      reply_type: 'list_picker',
      reply_text: `✨ Welcome, ${name}! Let's explore some Broadway magic.\n\nWhat would you like to do today?`,
      buttons: MAIN_SERVICE_BUTTONS,
    },
  ];
}
