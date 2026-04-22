import { AgentResult } from './agent';
import { QuickReplyButton } from '../lib/chat/types';

export function formatReplies(result: AgentResult): any[] {
  const replies: any[] = [];

  // 1. Text reply
  if (result.text) {
    replies.push({
      reply_type: 'text',
      reply_text: result.text
    });
  }

  // 2. Product cards
  if (result.products && result.products.length > 0) {
    replies.push({
      reply_type: 'product_card',
      products: result.products.map(p => ({
        name: p.name,
        brand: p.brand,
        imageUrl: p.imageUrl,
        description: p.generalTag,
        productLink: p.productLink
      })),
      reply_text: "Here are some pieces I found for you:"
    });

    // Add quick replies after products
    replies.push({
      reply_type: 'quick_reply',
      reply_text: "What would you like to do next?",
      buttons: [
        { id: 'show_more', text: 'Show me more' },
        { id: 'outfit_ideas', text: 'Outfit ideas' },
        { id: 'main_menu', text: 'Main menu' }
      ]
    });
  }

  // 3. Color Analysis card
  if (result.colorAnalysis && result.colorAnalysis.analysis) {
    const analysis = result.colorAnalysis.analysis;
    replies.push({
      reply_type: 'color_analysis_card',
      palette_name: analysis.palette_name,
      description: analysis.palette_description,
      top_colors: [], // Placeholder as we don't have hex codes here yet
      two_color_combos: [],
      user_image_url: null
    });

    replies.push({
      reply_type: 'quick_reply',
      reply_text: "Your palette is stunning! Want to shop your colors?",
      buttons: [
        { id: 'shop_palette', text: 'Shop my palette' },
        { id: 'save_analysis', text: 'Save this' },
        { id: 'main_menu', text: 'Main menu' }
      ]
    });
  }

  // 4. Vibe Check card
  if (result.vibeCheck && result.vibeCheck.id) {
    const vc = result.vibeCheck;
    replies.push({
      reply_type: 'vibe_check_card',
      comment: vc.comment,
      fit: { score: vc.fit_silhouette_score, explanation: vc.fit_silhouette_explanation || '' },
      hair_and_skin: { score: vc.color_harmony_score, explanation: vc.color_harmony_explanation || '' },
      accessories: { score: vc.styling_details_score, explanation: vc.styling_details_explanation || '' },
      vibe_check_result: vc.overall_score,
      recommendations: vc.recommendations,
      user_image_url: null
    });

    replies.push({
      reply_type: 'quick_reply',
      reply_text: "That was a great look! How else can I help?",
      buttons: [
        { id: 'shop_similar', text: 'Shop similar' },
        { id: 'styling_tips', text: 'Get styling tips' },
        { id: 'main_menu', text: 'Main menu' }
      ]
    });
  }

  return replies;
}
