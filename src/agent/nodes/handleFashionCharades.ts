import { PendingType } from '@prisma/client';
import { z } from 'zod';
import { getTextLLM } from '../../lib/ai';
import { SystemMessage } from '../../lib/ai/core/messages';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { GraphState, Replies } from '../state';
import { getMainMenuReply } from './common';

// Charades clue schema
export const CharadesClueSchema = z.object({
  clue: z.string(),
  answer: z.string(),
  category: z.enum(['designer', 'fabric', 'style', 'accessory', 'term']),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  hintsRemaining: z.number().min(0).max(3).optional(),
  lives: z.number().min(0).max(3).optional(),
});

// Charades evaluation schema
export const CharadesEvaluationSchema = z.object({
  evaluation: z.enum(['exact', 'close', 'partial', 'wrong']),
  response: z.string(),
  should_continue: z.boolean(),
  hint_provided: z.boolean(),
});

// Hint generation schema
export const HintGenerationSchema = z.object({
  hint: z.string(),
  hint_level: z.enum(['general', 'specific', 'revealing']),
  game_over: z.boolean(),
});

function gameOver(state: GraphState, message: string): GraphState {
  state.quizQuestions = undefined;
  state.currentQuestionIndex = undefined;
  state.pending = PendingType.NONE;

  const gameOverReply: Replies = [
    {
      reply_type: 'text',
      reply_text: message,
    },
  ];

  const menuReply = getMainMenuReply();

  state.assistantReply = [...gameOverReply, ...menuReply];
  return state;
}

export async function handleFashionCharades(state: GraphState): Promise<GraphState> {
  const { user, pending, input } = state;
  const userId = user.id;

  try {
    const buttonPayload = input.ButtonPayload?.toLowerCase();

    // If user clicked "fashion_quiz" from menu, start a new game
    if (buttonPayload === 'fashion_quiz') {
      logger.debug('User clicked fashion_quiz from menu, starting new game');
      // Clear any existing game state
      state.quizQuestions = undefined;
      state.currentQuestionIndex = undefined;
      return await startNewCharadesRound(state);
    }

    // Check if we have an active charades game
    const hasActiveGame =
      state.quizQuestions && Array.isArray(state.quizQuestions) && state.quizQuestions.length > 0;

    logger.debug(
      {
        hasActiveGame,
        quizQuestions: state.quizQuestions,
        quizQuestionsLength: state.quizQuestions?.length,
      },
      'Checking for active charades game',
    );

    if (!hasActiveGame) {
      // Start new charades game
      logger.debug('No active game found, starting new round');
      return await startNewCharadesRound(state);
    }

    logger.debug('Active game found, handling existing game');

    // Handle hint button click
    if (buttonPayload === 'hint') {
      return await provideHint(state);
    }

    // Handle user guess
    const userGuess = input.Body?.trim();
    if (userGuess) {
      return await evaluateCharadesGuess(state, userGuess);
    }

    // If no input provided, show the current clue again
    return await showCurrentClue(state);
  } catch (err) {
    logger.error({ userId, err }, 'Error in handleFashionCharades');
    throw new InternalServerError('Failed to handle fashion charades', { cause: err });
  }
}

async function startNewCharadesRound(state: GraphState): Promise<GraphState> {
  // Generate a new charades clue
  const systemPromptText = await loadPrompt('handlers/quiz/fashion_charades_generation.txt', user);
  const systemPrompt = new SystemMessage(systemPromptText);

  const response = await getTextLLM()
    .withStructuredOutput(CharadesClueSchema)
    .run(systemPrompt, [], state.traceBuffer, 'handleFashionCharades');

  const clue = response;

  // Store the clue in state (using quizQuestions to store current clue)
  state.quizQuestions = [{ ...clue, hintsRemaining: 3, lives: 3 }]; // Add hint tracking and lives
  state.currentQuestionIndex = 0;

  return await showCurrentClue(state);
}

async function showCurrentClue(state: GraphState): Promise<GraphState> {
  if (
    !state.quizQuestions ||
    !Array.isArray(state.quizQuestions) ||
    state.quizQuestions.length === 0
  ) {
    throw new Error('No active charades clue');
  }

  const clue = state.quizQuestions[0] as z.infer<typeof CharadesClueSchema>;

  // Ensure hintsRemaining and lives are defined
  const hintsRemaining = clue.hintsRemaining ?? 3;
  const lives = clue.lives ?? 3;

  // Create star display based on hints remaining
  const stars = '⭐'.repeat(hintsRemaining);

  const clueText = `🎭 **Fashion Charades!**\n\n${clue.clue}\n\n**Lives: ${lives}**  ${stars}\n\nClick "Hint" to reveal more about this fashion mystery!`;

  const replies: Replies = [
    {
      reply_type: 'quick_reply',
      reply_text: clueText,
      buttons: [{ text: '💡 Hint', id: 'hint' }],
    },
  ];

  // Update state
  state.assistantReply = replies;
  state.pending = PendingType.FASHION_QUIZ_START; // Ready for hint clicks

  return state;
}

async function provideHint(state: GraphState): Promise<GraphState> {
  if (
    !state.quizQuestions ||
    !Array.isArray(state.quizQuestions) ||
    state.quizQuestions.length === 0
  ) {
    throw new Error('No active charades clue for hint');
  }

  const clue = state.quizQuestions[0] as z.infer<typeof CharadesClueSchema>;

  // Ensure hintsRemaining is defined
  const hintsRemaining = clue.hintsRemaining ?? 3;

  logger.debug({ hintsRemaining, clueAnswer: clue.answer }, 'Current hint state');

  if (hintsRemaining <= 0) {
    const gameOverMessage = `😅 **Oh no! All hints used up!**\n\nThe answer was **${clue.answer.toUpperCase()}**!\n\nDon't worry, fashion knowledge takes time! Want to try another round? 🎭`;
    return gameOver(state, gameOverMessage);
  }

  // Generate a hint using AI
  const hintsUsed = 3 - hintsRemaining;
  const hintLevel = hintsUsed === 0 ? 'general' : hintsUsed === 1 ? 'specific' : 'revealing';

  const hintPrompt = `Generate a ${hintLevel} hint for the fashion charades clue: "${clue.clue}"

The correct answer is: ${clue.answer}
Category: ${clue.category}

For ${hintLevel} hints:
- general: Broad category hint (e.g., "Think about fabrics...")
- specific: More detailed hint (e.g., "It's smooth and shiny...")
- revealing: Very specific hint (e.g., "Used in formal evening wear...")

Keep the hint encouraging and fun, but don't reveal the answer directly.`;

  const systemPrompt = new SystemMessage(hintPrompt);

  const hintResponse = await getTextLLM().run(
    systemPrompt,
    [],
    state.traceBuffer,
    'handleFashionCharades',
  );

  // Decrease hints remaining and lives
  const newHintsRemaining = hintsRemaining - 1;
  const newLives = (clue.lives ?? 3) - 1;
  clue.hintsRemaining = newHintsRemaining;
  clue.lives = newLives;

  logger.debug(
    { hintsRemaining: newHintsRemaining, lives: newLives, clueAnswer: clue.answer },
    'Updated hint state',
  );

  // If lives reach 0, immediately reveal the answer
  if (newLives <= 0) {
    const gameOverMessage = `😅 **Oh no! All lives used up!**\n\nThe answer was **${clue.answer.toUpperCase()}**!\n\nDon't worry, fashion knowledge takes time! Want to try another round? 🎭`;
    return gameOver(state, gameOverMessage);
  }

  // Create response with hint and updated displays
  const stars = '⭐'.repeat(Math.max(0, newHintsRemaining));
  const hintButtonText = '💡 Hint';

  const hintText =
    hintResponse.assistant.content[0]?.type === 'text'
      ? hintResponse.assistant.content[0].text
      : "Here's a hint for you!";
  const hintMessage = `💡 **Hint:** ${hintText}\n\n**Lives: ${newLives}**  ${stars}`;

  const replies: Replies = [
    {
      reply_type: 'quick_reply',
      reply_text: hintMessage,
      buttons: [{ text: hintButtonText, id: 'hint' }],
    },
  ];

  state.assistantReply = replies;
  state.pending = PendingType.FASHION_QUIZ_START;

  return state;
}

async function evaluateCharadesGuess(state: GraphState, userGuess: string): Promise<GraphState> {
  if (
    !state.quizQuestions ||
    !Array.isArray(state.quizQuestions) ||
    state.quizQuestions.length === 0
  ) {
    throw new Error('No active charades clue to evaluate');
  }

  const clue = state.quizQuestions[0] as z.infer<typeof CharadesClueSchema>;

  // Evaluate the guess using AI
  const systemPromptText = await loadPrompt('handlers/quiz/fashion_charades_scoring.txt', user);

  const formattedPrompt = systemPromptText
    .replace('{correct_answer}', clue.answer)
    .replace('{user_guess}', userGuess)
    .replace('{clue}', clue.clue)
    .replace('{category}', clue.category);

  const systemPrompt = new SystemMessage(formattedPrompt);

  const evaluation = await getTextLLM()
    .withStructuredOutput(CharadesEvaluationSchema)
    .run(systemPrompt, [], state.traceBuffer, 'handleFashionCharades');

  // If the game is over (correct, wrong but no more tries, etc.), end it.
  if (!evaluation.should_continue) {
    return gameOver(state, evaluation.response);
  }

  // Otherwise, the game continues (e.g., a 'close' guess). Just send the AI's response.
  const replies: Replies = [
    {
      reply_type: 'text',
      reply_text: evaluation.response,
    },
  ];

  state.assistantReply = replies;
  state.pending = PendingType.FASHION_QUIZ_START; // Keep the game going

  return state;
}
