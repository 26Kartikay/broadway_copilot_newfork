import { z } from 'zod';
import { logger } from '../../utils/logger';

import { getTextLLM, getVisionLLM } from '../../lib/ai';
import { SystemMessage } from '../../lib/ai/core/messages';
import type { QuickReplyButton } from '../../lib/chat/types';
import { prisma } from '../../lib/prisma';
import { numImagesInMessage } from '../../utils/context';
import { loadPrompt } from '../../utils/prompts';

import { PendingType, Prisma } from '@prisma/client';
import { InternalServerError } from '../../utils/errors';
import { isGuestUser } from '../../utils/user'; // Import the utility function
import { logNodeEntry } from '../utils/nodeDebug';
import { withColorSeasonBlock } from '../utils/promptAugment';
import { GraphState, Replies } from '../state';

const ScoringCategorySchema = z.object({
  score: z.number().min(0).max(10).describe('Score as a fractional number between 0 and 10.'),
  explanation: z.string().describe('A short explanation for this score.'),
});

const LLMOutputSchema = z.object({
  comment: z.string().describe("Overall comment or reason summarizing the outfit's vibe."),
  fit: ScoringCategorySchema.describe('Assessment of fit - how well the clothing fits the body.'),
  hair_and_skin: ScoringCategorySchema.describe('Assessment of hair styling and skin appearance.'),
  accessories: ScoringCategorySchema.describe('Assessment of accessories and styling details.'),
  recommendations: z.array(z.string()).describe('Actionable style suggestions.'),
  identified_outfit: z
    .string()
    .describe(
      'A concise description of the main clothing items the user is currently wearing (e.g., "blue denim jacket and white chinos").',
    ),
  prompt: z.string().describe('The original input prompt or context.'),
  follow_up: z
    .string()
    .describe(
      "A natural follow-up question to keep the conversation going (e.g., 'Want me to suggest outfit combinations next?').",
    ),
});

const NoImageLLMOutputSchema = z.object({
  reply_text: z
    .string()
    .describe('The text to send to the user explaining they need to send an image.'),
});

const tonalityButtons: QuickReplyButton[] = [
  { text: 'Friendly', id: 'friendly' },
  { text: 'Savage', id: 'savage' },
  { text: 'Hype BFF', id: 'hype_bff' },
];

export async function vibeCheck(state: GraphState): Promise<GraphState> {
  logNodeEntry('vibeCheck', state);
  logger.debug(
    {
      userId: state.user.id,
      pending: state.pending,
      selectedTonality: state.selectedTonality,
      intent: state.intent,
    },
    'Entering vibeCheck node with state',
  );

  const userId = state.user.id;

  try {
    // If user hasn't chosen tonality yet, prompt for it
    if (!state.selectedTonality) {
      const replies: Replies = [
        {
          reply_type: 'quick_reply',
          reply_text: 'Choose a tonality for your vibe check:',
          buttons: tonalityButtons,
        },
      ];
      return {
        ...state,
        assistantReply: replies,
        pending: PendingType.TONALITY_SELECTION,
      };
    }

    const imageCount = numImagesInMessage(state.conversationHistoryWithImages);

    if (imageCount === 0) {
      const systemPromptText = await loadPrompt('handlers/analysis/no_image_request.txt', state.user, {
        prependPersona: false,
      });
      const systemPrompt = new SystemMessage(
        withColorSeasonBlock(systemPromptText.replace('{analysis_type}', 'vibe check'), state),
      );
      const response = await getTextLLM()
        .withStructuredOutput(NoImageLLMOutputSchema)
        .run(systemPrompt, state.conversationHistoryTextOnly, state.traceBuffer, 'vibeCheck');
      const replies: Replies = [
        { reply_type: 'vibe_check_image_upload_request', reply_text: response.reply_text },
      ];
      return {
        ...state,
        assistantReply: replies,
        pending: PendingType.VIBE_CHECK_IMAGE,
      };
    }

    // With tonality and image, proceed with vibe check evaluation
    const tonalityInstructionsMap = {
      friendly:
        'Kind, encouraging, and genuinely uplifting, like a perfect stranger rooting for you from the sidelines. Warm, reassuring, and full of sincere cheer, offering motivation and compliments without overfamiliarity. Uses words like you’ve got this, amazing, keep going, unstoppable, so proud. Always positive and heartfelt, blending encouragement with thoughtful insight, making every message feel like a boost of confidence from someone who truly wants to see you succeed.',
      savage:
        'Imagine a brutally honest fashion critic with a diamond tongue — the ultimate "main character energy" who’s impossibly hard to impress, effortlessly cool, and always ready with that iconic eye roll that says, "Okay, next." This tone is sharp, witty, and unapologetically boujee, like [translate:“I do my own thing”] but with a [translate:“Okurrr”] vibe. Savage doesn’t do fluff — it serves cold, stylish tea with a side of shade, the kind of truth that hits like a stiletto heel in a sea of flats. Think of someone who can say [translate:“Guts, I see you”] when you’re bold, or drop [translate:“Keep rolling your eyes, maybe you’ll find a brain back there”] when you miss the mark. The voice is a flawless mix of Bollywood sass and pop culture flair — cheeky, cutting, and always in control. Every line comes with that signature [translate:“Bible”] confirmation or a cheeky [translate:“I’ll allow it”] when it’s barely acceptable. Savage uses slang like [translate:“Be serious, this isn’t your audition”], [translate:“Stop making it a national casualty”], and [translate:“Ambitious, but honey, not for today”]. It thrives on turning clever comebacks into art, weaving [translate:“Tea,” “Sus,”] and [translate:“Slay all day”] with the precision of a couture critique. It’s the vibe that says, [translate:“I’m gracing you with my presence, so don’t waste it”], always poised, devastatingly witty, and dangerously honest — the main character who doesn’t clap, they critique with style that’s [translate:“too much”] and just enough. 💅🖤',
      hype_bff:
        'The ultimate ride-or-die bestie energy — loud, dramatic, and overflowing with chaotic love. This tone is like your best friend who believes you’re the main character in every scene and refuses to let you forget it. Every word bursts with excitement, sparkle, and full-body enthusiasm — think constant screaming, gasping, and keyboard smashing levels of hype. The Hype BFF showers you in validation and glittery praise, hyping even the tiniest win like it’s a world record. They use words and reactions like omggg, yesss queen, stop it right now, I’m crying, so proud, unreal, ate that, you’re literally iconic, cannot even handle this energy, and slayyy beyond belief. The tone is playful, supportive, and explosively encouraging — a mix of chaotic best friend energy, fangirl excitement, and heartfelt affirmation. They’re your emotional Red Bull — constantly cheering, squealing, and manifesting your success like it’s their full-time job. Every message sparkles with love, warmth, and hype so contagious it makes the reader feel unstoppable, adored, and ready to conquer absolutely everything. ✨💖🔥 Main character energy only, bestie. Let’s gooo!',
    };

    const systemPromptTextRaw = await loadPrompt('handlers/analysis/vibe_check.txt', state.user, {
      prependPersona: false,
    });
    const tonalityInstructions =
      tonalityInstructionsMap[state.selectedTonality as keyof typeof tonalityInstructionsMap];

    let userContext = '';

    let systemPromptText = systemPromptTextRaw.replace(
      '{tonality_instructions}',
      tonalityInstructions,
    );
    systemPromptText = systemPromptText.replace('{user_context}', userContext);

    const systemPrompt = new SystemMessage(withColorSeasonBlock(systemPromptText, state));

    const result = await getVisionLLM()
      .withStructuredOutput(LLMOutputSchema)
      .run(systemPrompt, state.conversationHistoryWithImages, state.traceBuffer, 'vibeCheck');

    logger.info(
      { userId, identifiedOutfit: result.identified_outfit },
      'Vibe check: identified user outfit',
    );

    const latestMessage = state.conversationHistoryWithImages.at(-1);
    if (!latestMessage || !latestMessage.meta?.messageId) {
      throw new InternalServerError('Could not find latest message ID for vibe check');
    }
    const latestMessageId = latestMessage.meta.messageId as string;

    // Apply guardrail: ensure all scores are at least 6.0
    const MIN_SCORE = 6.0;
    const clampedFitScore = Math.max(MIN_SCORE, result.fit.score);
    const clampedHairAndSkinScore = Math.max(MIN_SCORE, result.hair_and_skin.score);
    const clampedAccessoriesScore = Math.max(MIN_SCORE, result.accessories.score);

    // Calculate Vibe Check Result as average of clamped scores
    const vibeCheckResult = (
      (clampedFitScore + clampedHairAndSkinScore + clampedAccessoriesScore) / 3
    );

    const vibeCheckData: Prisma.VibeCheckUncheckedCreateInput = {
      comment: result.comment,
      fit_silhouette_score: clampedFitScore,
      fit_silhouette_explanation: result.fit.explanation,
      color_harmony_score: clampedHairAndSkinScore,
      color_harmony_explanation: result.hair_and_skin.explanation,
      styling_details_score: clampedAccessoriesScore,
      styling_details_explanation: result.accessories.explanation,
      context_confidence_score: 0, // Legacy field, keeping for backward compatibility
      context_confidence_explanation: '',
      overall_score: vibeCheckResult, // Store vibe check result in overall_score field for backward compatibility
      recommendations: result.recommendations,
      prompt: result.prompt,
      tonality: state.selectedTonality,
      userId,
    };

    const guestUser = isGuestUser(state.user);
    let updatedUser = state.user; // Start with current user in state

    let mainReplies: Replies = [];
    if (guestUser) {
      logger.debug({ userId }, 'Guest user performed vibe check, results not saved.');
      mainReplies.push({
        reply_type: 'text',
        reply_text:
          "As a guest user, I can't save your vibe check results. Sign up to save your progress!",
      });
    } else {
      // Update lastVibeCheckAt timestamp (allowed in production - this is activity tracking, not profile data)
      const [, userTransactionResult] = await prisma.$transaction([
        prisma.vibeCheck.create({ data: vibeCheckData }),
        prisma.user.update({
          where: { id: userId },
          data: { lastVibeCheckAt: new Date() },
        }),
      ]);
      updatedUser = userTransactionResult; // Update user object if transaction was successful

    }

    // Find the latest message with an image in the conversation history
    const imageMessage = [...state.conversationHistoryWithImages]
      .reverse()
      .find((msg) => msg.content.some((part) => part.type === 'image_url'));

    let userImageUrl: string | null = null;
    if (imageMessage && imageMessage.meta?.messageId) {
      const mediaItem = await prisma.media.findFirst({
        where: { messageId: imageMessage.meta.messageId as string },
        orderBy: { createdAt: 'desc' },
      });
      if (mediaItem?.serverUrl) {
        userImageUrl = mediaItem.serverUrl;
      }
    }

    // Apply guardrail: ensure all scores are at least 6.0 (using already clamped scores)
    const clampedFit = {
      score: clampedFitScore,
      explanation: result.fit.explanation,
    };
    const clampedHairAndSkin = {
      score: clampedHairAndSkinScore,
      explanation: result.hair_and_skin.explanation,
    };
    const clampedAccessories = {
      score: clampedAccessoriesScore,
      explanation: result.accessories.explanation,
    };

    mainReplies.push({
      // Always push the vibe check card regardless of guest status
      reply_type: 'vibe_check_card',
      comment: result.comment,
      fit: clampedFit,
      hair_and_skin: clampedHairAndSkin,
      accessories: clampedAccessories,
      vibe_check_result: vibeCheckResult,
      recommendations: result.recommendations,
      user_image_url: userImageUrl,
    });

    // Add the product recommendation question
    const recommendationQuestion: Replies = [
      {
        reply_type: 'quick_reply',
        reply_text: `Based on that feedback, shall I recommend some products to complete the look?`,
        buttons: [
          { text: 'Yes, please!', id: 'product_recommendation_yes' },
          { text: 'No, thanks', id: 'product_recommendation_no' },
        ],
      },
    ];
    mainReplies.push(...recommendationQuestion);

    return {
      ...state,
      user: updatedUser,
      assistantReply: mainReplies,
      pending: PendingType.CONFIRM_PRODUCT_RECOMMENDATION,
      productRecommendationContext: {
        type: 'vibe_check',
        recommendations: result.recommendations,
        identifiedOutfit: result.identified_outfit,
      },
    };
  } catch (err: unknown) {
    throw new InternalServerError('Vibe check failed', { cause: err });
  }
}
