import * as fs from 'fs';
import * as path from 'path';
import { PendingType, Prisma } from '@prisma/client';
import { getPaletteData, isValidPalette } from '../../data/seasonalPalettes';
import { prisma } from '../../lib/prisma';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { isGuestUser } from '../../utils/user'; // Import the utility function
import { GraphState, Replies } from '../state';
import { getMainMenuReply } from './common';

export async function handleSaveColorAnalysis(state: GraphState): Promise<GraphState> {
  const userId = state.user.id;
  const userResponse = state.input.ButtonPayload;
  const paletteNameToSave = state.seasonalPaletteToSave;

  const guestUser = isGuestUser(state.user);

  let replyText: string;
  const confirmationReplies: Replies = []; // Declare and initialize here

  if (userResponse === 'save_color_analysis_yes' && paletteNameToSave) {
    if (!isValidPalette(paletteNameToSave)) {
      logger.error(
        { userId, paletteNameToSave },
        'Invalid palette name found in state during save confirmation',
      );
      throw new InternalServerError(`Invalid palette name: ${paletteNameToSave}`);
    }

    if (guestUser) {
      replyText = "As a guest user, I can't save your color palette. Sign up to save your results!";
      logger.debug(
        { userId },
        'Guest user tried to save color analysis result, but saving is disabled.',
      );
    } else {
      const paletteData = getPaletteData(paletteNameToSave); // Get paletteData here once

      await prisma.colorAnalysis.create({
        data: {
          userId,
          palette_name: paletteNameToSave,
          colors_suited: JSON.stringify(paletteData.topColors),
          colors_to_wear: {
            two_color_combos: paletteData.twoColorCombos,
            three_color_combos: paletteData.threeColorCombos,
          },
          colors_to_avoid: Prisma.JsonNull,
        },
      });

      // Update lastColorAnalysisAt timestamp (allowed in production - this is activity tracking, not profile data)
      await prisma.user.update({
        where: { id: state.user.id },
        data: { lastColorAnalysisAt: new Date() },
      });

      replyText = "I've saved your color palette to your profile.";
      logger.debug({ userId, paletteNameToSave }, 'User confirmed to save color analysis result.');
    }

    confirmationReplies.push({
      // Push the text reply first
      reply_type: 'text',
      reply_text: replyText,
    });

        // Only provide PDF if not a guest user AND saving was confirmed
        if (!guestUser && userResponse === 'save_color_analysis_yes' && paletteNameToSave) {
          const paletteData = getPaletteData(paletteNameToSave);
          const baseUrl = process.env.SERVER_URL?.replace(/\/$/, '') || '';
    
          // Use unified palette PDF path (no gender-specific paths)
          const finalPdfPath = paletteData.pdfPath;
    
          confirmationReplies.push({
            // Then push the PDF
            reply_type: 'pdf',
            media_url: `${baseUrl}/${finalPdfPath}`,
            reply_text: 'Here is your color palette guide.',
          });
        }  } else {
    replyText = "No problem. I won't save your color palette.";
    logger.debug({ userId }, 'User declined to save color analysis result.');
    confirmationReplies.push({
      // Push the text reply only
      reply_type: 'text',
      reply_text: replyText,
    });
  }

  const paletteName = state.seasonalPaletteToSave; // Re-use paletteName for clarity/consistency
  if (!paletteName || !isValidPalette(paletteName)) {
    // Should not happen, but as a safeguard, just return to the main menu.
    return {
      ...state,
      assistantReply: [
        ...confirmationReplies, // Use the already built replies
        ...getMainMenuReply('Is there anything else I can help with?'),
      ],
      seasonalPaletteToSave: undefined,
      pending: PendingType.NONE,
    };
  }

  const recommendationQuestion: Replies = [
    {
      reply_type: 'quick_reply',
      reply_text: `Now that we know you're a ${paletteName}, would you like to see some products from your palette?`,
      buttons: [
        { text: 'Yes, please!', id: 'product_recommendation_yes' },
        { text: 'No, thanks', id: 'product_recommendation_no' },
      ],
    },
  ];

  return {
    ...state,
    assistantReply: [...confirmationReplies, ...recommendationQuestion], // Use confirmationReplies
    // The `seasonalPaletteToSave` will be persisted by sendReply
    pending: PendingType.CONFIRM_PRODUCT_RECOMMENDATION,
    productRecommendationContext: {
      type: 'color_palette',
      paletteName: paletteName,
    },
  };
}
