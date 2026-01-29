import { prisma } from '../../lib/prisma';
import { GraphState, Replies } from '../state';
import { logger } from '../../utils/logger';
import { getPaletteData, isValidPalette } from '../../data/seasonalPalettes';
import { InternalServerError } from '../../utils/errors';

export async function handleSaveColorAnalysis(state: GraphState): Promise<GraphState> {
  const userId = state.user.id;
  const userResponse = state.input.ButtonPayload;
  const paletteNameToSave = state.seasonalPaletteToSave;

  let replyText: string;

  if (userResponse === 'save_color_analysis_yes' && paletteNameToSave) {
    if (!isValidPalette(paletteNameToSave)) {
      logger.error({ userId, paletteNameToSave }, 'Invalid palette name found in state during save confirmation');
      throw new InternalServerError(`Invalid palette name: ${paletteNameToSave}`);
    }

    const paletteData = getPaletteData(paletteNameToSave);

    await prisma.$transaction([
      prisma.colorAnalysis.create({
        data: {
          userId,
          palette_name: paletteNameToSave,
          colors_suited: paletteData.topColors,
          colors_to_wear: {
            two_color_combos: paletteData.twoColorCombos,
            three_color_combos: paletteData.threeColorCombos,
          },
          colors_to_avoid: null,
        },
      }),
      prisma.user.update({
        where: { id: state.user.id },
        data: { lastColorAnalysisAt: new Date() },
      }),
    ]);

    replyText = "I've saved your color palette to your profile.";
    logger.debug({ userId, paletteNameToSave }, 'User confirmed to save color analysis result.');

  } else {
    replyText = "No problem. I won't save your color palette.";
    logger.debug({ userId }, 'User declined to save color analysis result.');
  }

  const followUpReplies: Replies = [
    {
        reply_type: 'text',
        reply_text: replyText,
    },
    {
        reply_type: 'quick_reply',
        reply_text: "Did you know I can also help you figure out what your best colors are to wear for a specific occasion? Or maybe you'd like to get a vibe check on your outfit?",
        buttons: [
            { text: 'Help with an occasion', id: 'styling_occasion' },
            { text: 'Vibe check my outfit', id: 'vibe_check' },
        ],
    },
  ];

  return {
    ...state,
    assistantReply: followUpReplies,
    seasonalPaletteToSave: undefined,
    pendingAction: undefined,
  };
}
