import { z } from 'zod';
import { logger } from '../../utils/logger';

import { getTextLLM, getVisionLLM } from '../../lib/ai';
import { SystemMessage } from '../../lib/ai/core/messages';
import { prisma } from '../../lib/prisma';
import { queueWardrobeIndex } from '../../lib/tasks';
import type { QuickReplyButton } from '../../lib/twilio/types';
import { numImagesInMessage } from '../../utils/context';
import { loadPrompt } from '../../utils/prompts';

import { PendingType, Prisma } from '@prisma/client';
import { InternalServerError } from '../../utils/errors';
import { GraphState, Replies } from '../state';

import { execFile } from 'child_process';
import util from 'util';
import fs from 'fs/promises';

const execFileAsync = util.promisify(execFile);

const ScoringCategorySchema = z.object({
  score: z.number().min(0).max(10).describe('Score as a fractional number between 0 and 10.'),
  explanation: z.string().describe('A short explanation for this score.'),
});

const LLMOutputSchema = z.object({
  comment: z.string().describe("Overall comment or reason summarizing the outfit's vibe."),
  fit_silhouette: ScoringCategorySchema.describe('Assessment of fit & silhouette.'),
  color_harmony: ScoringCategorySchema.describe('Assessment of color coordination.'),
  styling_details: ScoringCategorySchema.describe(
    'Assessment of accessories, layers, and details.',
  ),
  context_confidence: ScoringCategorySchema.describe('How confident the outfit fits the occasion.'),
  overall_score: z.number().min(0).max(10).describe('Overall fractional score for the outfit.'),
  recommendations: z.array(z.string()).describe('Actionable style suggestions.'),
  prompt: z.string().describe('The original input prompt or context.'),
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

async function generateVibeCheckImage(data: object): Promise<string | null> {
  const inputJsonPath = '/tmp/vibe_image_input.json';
  const outputImagePath = '/tmp/vibe_output.png';

  try {
    await fs.writeFile(inputJsonPath, JSON.stringify(data));
    await execFileAsync('python3', ['src/image_generator/generate_image.py', inputJsonPath, outputImagePath]);

    // You must move/upload generated image to public URL for WhatsApp
    // For now, returning local path as placeholder:
  return 'http://localhost:8081/vibe_output.png';
  } catch (error) {
    logger.error({ error }, 'Failed to generate vibe check image');
    return null;
  }
}

export async function vibeCheck(state: GraphState): Promise<GraphState> {
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
      const systemPromptText = await loadPrompt('handlers/analysis/no_image_request.txt');
      const systemPrompt = new SystemMessage(
        systemPromptText.replace('{analysis_type}', 'vibe check'),
      );
      const response = await getTextLLM()
        .withStructuredOutput(NoImageLLMOutputSchema)
        .run(systemPrompt, state.conversationHistoryTextOnly, state.traceBuffer, 'vibeCheck');
      const replies: Replies = [{ reply_type: 'text', reply_text: response.reply_text }];
      return {
        ...state,
        assistantReply: replies,
        pending: PendingType.VIBE_CHECK_IMAGE,
      };
    }

    const tonalityInstructionsMap = {
      friendly:
        'Kind, encouraging, and genuinely uplifting, like a perfect stranger rooting for you from the sidelines. Warm, reassuring, and full of sincere cheer, offering motivation and compliments without overfamiliarity. Uses words like you’ve got this, amazing, keep going, unstoppable, so proud. Always positive and heartfelt, blending encouragement with thoughtful insight, making every message feel like a boost of confidence from someone who truly wants to see you succeed.',
      savage:
        'Imagine a brutally honest fashion critic with a diamond tongue — impossible to impress, effortlessly cool, and always ready with a perfectly timed eye roll. This tone is sharp, witty, and unapologetically high-standard, the kind that scans a room and finds flaws with surgical precision. Savage doesn’t do flattery — it does *truth with taste*. It delivers criticism like it’s couture: cutting, elegant, and laced with humor that stings in the best way. Think of someone who can say *“bold choice”* and make you rethink your entire life. The voice is judgmental in the most entertaining way — dry humor, clever comebacks, and that subtle “I’ve seen better” attitude. Every word carries main-character confidence and a sense of *effortless superiority* — the tone that never chases validation because it *is* the standard. Savage uses language like *“be serious,” “try again,” “that’s cute, I guess,” “we’re not doing that,” “ambitious, but no,”* and *“I’ll allow it.”* It thrives on sharp observations, stylish sarcasm, and a flair for dramatic understatement. Always entertaining, never cruel — the kind of voice that roasts you, teaches you, and somehow makes you want its approval. The vibe? Impeccably poised, devastatingly witty, and dangerously honest — *the main character who doesn’t clap, they critique.* 💅🖤',
      hype_bff:
        'The ultimate ride-or-die bestie energy — loud, dramatic, and overflowing with chaotic love. This tone is like your best friend who believes you’re the main character in every scene and refuses to let you forget it. Every word bursts with excitement, sparkle, and full-body enthusiasm — think constant screaming, gasping, and keyboard smashing levels of hype. The Hype BFF showers you in validation and glittery praise, hyping even the tiniest win like it’s a world record. They use words and reactions like omggg, yesss queen, stop it right now, I’m crying, so proud, unreal, ate that, you’re literally iconic, cannot even handle this energy, and slayyy beyond belief. The tone is playful, supportive, and explosively encouraging — a mix of chaotic best friend energy, fangirl excitement, and heartfelt affirmation. They’re your emotional Red Bull — constantly cheering, squealing, and manifesting your success like it’s their full-time job. Every message sparkles with love, warmth, and hype so contagious it makes the reader feel unstoppable, adored, and ready to conquer absolutely everything. ✨💖🔥 Main character energy only, bestie. Let’s gooo!',
    };

    const systemPromptTextRaw = await loadPrompt('handlers/analysis/vibe_check.txt');
    const tonalityInstructions =
      tonalityInstructionsMap[state.selectedTonality as keyof typeof tonalityInstructionsMap];
    const systemPromptText = systemPromptTextRaw.replace(
      '{tonality_instructions}',
      tonalityInstructions,
    );
    const systemPrompt = new SystemMessage(systemPromptText);

    const result = await getVisionLLM()
      .withStructuredOutput(LLMOutputSchema)
      .run(systemPrompt, state.conversationHistoryWithImages, state.traceBuffer, 'vibeCheck');

    const latestMessage = state.conversationHistoryWithImages.at(-1);
    if (!latestMessage || !latestMessage.meta?.messageId) {
      throw new InternalServerError('Could not find latest message ID for vibe check');
    }
    const latestMessageId = latestMessage.meta.messageId as string;

    const vibeCheckData: Prisma.VibeCheckUncheckedCreateInput = {
      comment: result.comment,
      fit_silhouette_score: result.fit_silhouette.score,
      fit_silhouette_explanation: result.fit_silhouette.explanation,
      color_harmony_score: result.color_harmony.score,
      color_harmony_explanation: result.color_harmony.explanation,
      styling_details_score: result.styling_details.score,
      styling_details_explanation: result.styling_details.explanation,
      context_confidence_score: result.context_confidence.score,
      context_confidence_explanation: result.context_confidence.explanation,
      overall_score: result.overall_score,
      recommendations: result.recommendations,
      prompt: result.prompt,
      tonality: state.selectedTonality,
      userId,
    };

    const [, user] = await prisma.$transaction([
      prisma.vibeCheck.create({ data: vibeCheckData }),
      prisma.user.update({
        where: { id: userId },
        data: { lastVibeCheckAt: new Date() },
      }),
    ]);

    queueWardrobeIndex(userId, latestMessageId);

    // Prepare formatted text reply (same as before)
    const formattedMessage = `
✨ *Vibe Check Results* ✨



${result.comment}



👕 *Fit & Silhouette*: ${result.fit_silhouette.score}/10  
_${result.fit_silhouette.explanation}_



🎨 *Color Harmony*: ${result.color_harmony.score}/10  
_${result.color_harmony.explanation}_



🧢 *Styling Details*: ${result.styling_details.score}/10  
_${result.styling_details.explanation}_



🎯 *Context Confidence*: ${result.context_confidence.score}/10  
_${result.context_confidence.explanation}_



⭐ *Overall Score*: *${result.overall_score.toFixed(1)}/10*



💡 *Recommendations*:  
${result.recommendations.map((rec, i) => `   ${i + 1}. ${rec}`).join('\n')}
    `.trim();

    // Extract user image URL from conversation history for the image generation
    // Extract user image URL safely
let userImageUrl: string | undefined;
for (let i = state.conversationHistoryWithImages.length - 1; i >= 0; i--) {
  const msg = state.conversationHistoryWithImages[i];
  if (msg && msg.role === 'user' && Array.isArray(msg.content)) {
    const imagePart = (msg.content as any[]).find(
      (part) => part.type === 'image_url' && part.image_url?.url,
    );
    if (imagePart) {
      userImageUrl = imagePart.image_url.url;
      break;
    }
  }
}


    if (!userImageUrl) {
      logger.error('No user image found in conversation history for vibe check generation');
    }

    // Data object for image generation
    const imageData = {
      template_url: 'https://res.cloudinary.com/drpb2m2ar/image/upload/v1760509589/Vibe_check_template_uyglqf.png',
      user_image_path: userImageUrl ?? '', 
      comment: result.comment,
      fit_silhouette: result.fit_silhouette,
      color_harmony: result.color_harmony,
      styling_details: result.styling_details,
      context_confidence: result.context_confidence,
      overall_score: result.overall_score,
      recommendations: result.recommendations,
    };

    // Generate image with fallback to text only
    let generatedImageUrl: string | null = null;
    try {
      generatedImageUrl = await generateVibeCheckImage(imageData);
    } catch (error) {
      logger.error({ error }, 'Vibe check image generation failed');
    }

    // Compose replies with image if available, else only text
    const replies: Replies = generatedImageUrl
      ? [
          {
            reply_type: 'image',
            media_url: generatedImageUrl,
            reply_text: 'Your vibe check result image',
          },
          {
            reply_type: 'text',
            reply_text: formattedMessage,
          },
        ]
      : [{ reply_type: 'text', reply_text: formattedMessage }];

    return {
      ...state,
      user,
      assistantReply: replies,
      pending: PendingType.NONE,
    };
  } catch (err: unknown) {
    throw new InternalServerError('Vibe check failed', { cause: err });
  }
}
