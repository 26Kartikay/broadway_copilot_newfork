import { z } from 'zod';
import { getVisionLLM } from '../../lib/ai';
import { agentExecutor } from '../../lib/ai/agents/executor';
import { SystemMessage, UserMessage } from '../../lib/ai/core/messages';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { GraphState, Replies } from '../state';

import { createCanvas, loadImage } from 'canvas';
import { loadPrompt } from '../../utils/prompts';

import { redis } from '../../lib/redis';

import { getMainMenuReply } from './common';

const REDIS_PREFIX = 'thisOrThat';

const LLMOutputSchema = z.object({
  winner: z.string(),
  result_text: z.string(),
  reasoning: z.string(),
  metrics: z.object({
    style: z.number().min(0).max(10),
    color: z.number().min(0).max(10),
    fit: z.number().min(0).max(10),
  }),
  suggestions: z.array(z.string()),
  followup: z.string().nullable(),
});

function formatText(text?: string) {
  if (!text) return '';
  return text
    .split('\n')
    .map((l) => l.trim())
    .join('\n\n')
    .trim();
}

function extractImageIdFromInput(input: any): string | null {
  if (input?.MediaUrl0) return input.MediaUrl0;
  if (Array.isArray(input?.media) && input.media.length > 0)
    return input.media[0].url || input.media[0].MediaUrl || null;
  if (input?.Media && typeof input.Media === 'object')
    return input.Media.url || input.Media.MediaUrl || null;
  if (typeof input?.Body === 'string' && input.Body.includes('http')) {
    const match = input.Body.match(/https?:\/\/\S+/);
    return match ? match[0] : null;
  }
  return null;
}

/**
 * Load an image from a URL.
 * Supports both direct URLs and data URLs.
 */
async function loadImageFromUrl(url: string) {
  // If it's a data URL, load it directly
  if (url.startsWith('data:')) {
    return loadImage(url);
  }

  // Fetch the image and load it
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch image: ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return loadImage(buf);
}

async function combineImagesSideBySide(url1: string, url2: string): Promise<string> {
  const img1 = await loadImageFromUrl(url1);
  const img2 = await loadImageFromUrl(url2);

  const canvasWidth = img1.width + img2.width;
  const canvasHeight = Math.max(img1.height, img2.height);

  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(img1, 0, 0);
  ctx.drawImage(img2, img1.width, 0);

  return canvas.toDataURL('image/png');
}

async function saveFirstImageUrl(userId: string, imageUrl: string, ttlSeconds: number = 3600) {
  await redis.hSet(`${REDIS_PREFIX}:${userId}`, {
    firstImageUrl: imageUrl,
    pending: 'SECOND_IMAGE',
  });
  await redis.expire(`${REDIS_PREFIX}:${userId}`, ttlSeconds);
}

async function saveSecondImageUrl(userId: string, imageUrl: string) {
  await redis.hSet(`${REDIS_PREFIX}:${userId}`, {
    secondImageUrl: imageUrl,
    // Setting state to COMBINE_AND_ANALYZE here to trigger the next step
    pending: 'COMBINE_AND_ANALYZE',
  });
}

async function getImageState(userId: string) {
  const state = await redis.hGetAll(`${REDIS_PREFIX}:${userId}`);
  return state;
}

async function clearImageState(userId: string) {
  await redis.del(`${REDIS_PREFIX}:${userId}`);
}

export async function handleThisOrThat(state: GraphState): Promise<GraphState> {
  const { user, input } = state;
  const userId = user.id;
  const messageId = input.MessageSid;

  try {
    const imageId = extractImageIdFromInput(input);
    let redisState = await getImageState(userId);
    let currentStep = redisState.pending; // Use 'let' because we might change it

    // --- 1. START FLOW / RECEIVE FIRST IMAGE (currentStep is falsy or 'NONE') ---
    if (!currentStep || currentStep === 'NONE') {
      if (imageId) {
        // User sent the first image immediately. Save it and ask for the second.
        await saveFirstImageUrl(userId, imageId);
        const assistantReply: Replies = [
          {
            reply_type: 'text',
            reply_text: 'Great! Now upload a photo of your second outfit for the showdown.',
          },
        ];
        return { ...state, assistantReply };
      } else {
        // User started with text, or sent a non-image message. Ask for the first image.
        const assistantReply: Replies = [
          {
            reply_type: 'text',
            reply_text: "Let's play *This or That*! Please upload a photo of your first outfit.",
          },
        ];
        return { ...state, assistantReply };
      }
    }

    // --- 2. RECEIVE SECOND IMAGE (currentStep is 'SECOND_IMAGE') ---
    if (currentStep === 'SECOND_IMAGE') {
      if (!imageId) {
        logger.warn({ userId }, 'No second image found in message, prompting again');
        const assistantReply: Replies = [
          {
            reply_type: 'text',
            reply_text: 'Please upload your second outfit photo to continue.',
          },
        ];
        return { ...state, assistantReply };
      }

      // Found the second image. Save it and update the state.
      await saveSecondImageUrl(userId, imageId);

      // Update the local state variables to correctly fall through to the next block.
      redisState = await getImageState(userId);
      currentStep = redisState.pending; // Should now be 'COMBINE_AND_ANALYZE'

      // IMPORTANT FIX: DO NOT return here. Fall through to the analysis block.
    }

    // --- 3. COMBINE AND ANALYZE (currentStep is 'COMBINE_AND_ANALYZE') ---
    // This block is either entered on the next turn, or immediately after the SECOND_IMAGE step.
    if (currentStep === 'COMBINE_AND_ANALYZE') {
      // Use the latest redisState which should contain both URLs
      const { firstImageUrl, secondImageUrl } = redisState;

      if (!firstImageUrl || !secondImageUrl) {
        // This is a safety check in case data was lost between the second image upload
        // and the start of analysis.
        logger.warn({ userId }, 'Missing one or both images during analysis, restarting flow');
        await clearImageState(userId);
        const assistantReply: Replies = [
          {
            reply_type: 'text',
            reply_text:
              "I lost track of one of your outfit photos. Let's start over. Please upload your first outfit photo.",
          },
        ];
        return { ...state, assistantReply };
      }

      logger.info({ userId, messageId }, 'Starting This or That analysis with combined images');

      const combinedImageDataUrl = await combineImagesSideBySide(firstImageUrl!, secondImageUrl!);

      const systemPromptText = await loadPrompt(
        'handlers/this_or_that/this_or_that_image_analysis.txt',
      );
      const systemPrompt = new SystemMessage(systemPromptText);
      const userCombinedImageMessage = new UserMessage([
        { type: 'image_url', image_url: { url: combinedImageDataUrl } },
      ]);

      const { output: finalResponse } = await agentExecutor(
        getVisionLLM(),
        systemPrompt,
        [userCombinedImageMessage],
        {
          tools: [],
          outputSchema: LLMOutputSchema,
          nodeName: 'handleThisOrThat',
        },
        state.traceBuffer,
      );

      // Map model winner (often 'left'/'right') to user-facing '1st'/'2nd'
      const w = (finalResponse.winner || '').toLowerCase().trim();
      const winnerLabel = ['left', 'first', '1', 'one'].includes(w)
        ? '1st outfit'
        : ['right', 'second', '2', 'two'].includes(w)
          ? '2nd outfit'
          : '2nd outfit';

      const reasonRaw = finalResponse.result_text || finalResponse.reasoning || '';
      // Format reason text with paragraph breaks
      const reasonFormatted = formatText(reasonRaw).slice(0, 280);

      const m = finalResponse.metrics;
      const scoresText = m
        ? `\n\nScores:\n• Style: ${m.style}/10\n• Color: ${m.color}/10\n• Fit: ${m.fit}/10`
        : '';

      const reasonText = reasonFormatted ? `\n\nReason:\n${reasonFormatted}` : '';

      // Compose final multi-line answer, tidier aligned
      const concise = `${winnerLabel} wins!${scoresText}${reasonText}`;

      logger.info(
        { winner: finalResponse.winner, mappedWinner: winnerLabel, length: concise.length },
        'ThisOrThat result composed',
      );

      const resultReplies: Replies = [{ reply_type: 'text', reply_text: concise }];

      await clearImageState(userId);

      const menuReply = getMainMenuReply();

      return { ...state, assistantReply: [...resultReplies, ...menuReply] };
    }

    // --- 4. UNEXPECTED STATE FALLBACK ---
    // This should only be hit if a new, invalid state exists in Redis.
    logger.error({ userId, currentStep }, 'Unexpected flow state in handleThisOrThat');
    await clearImageState(userId);
    const assistantReply: Replies = [
      {
        reply_type: 'text',
        reply_text:
          'There was an error in the comparison process. Please start the This or That flow again.',
      },
    ];
    return { ...state, assistantReply };
  } catch (err) {
    logger.error(
      { userId, messageId, error: err instanceof Error ? err.message : String(err) },
      'Failed handling This or That outfit comparison',
    );
    throw new InternalServerError('Failed to handle This or That outfit comparison', {
      cause: err,
    });
  }
}
