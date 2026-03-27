import z from 'zod';
import { ChatOpenAI } from '../../lib/ai/openai/chat_models';
import { StructuredOutputRunnable } from '../../lib/ai/core/structured_output_runnable';
import { SystemMessage, UserMessage } from '../../lib/ai/core/messages';
import { GraphState } from '../state';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

export const UserProfileSchema = z.object({
  style_preference: z.string().optional(),
  color_preference: z.string().optional(),
  budget_range: z.string().optional(),
  behavioral_traits: z.array(z.string()).optional(),
  activity_pattern: z.string().optional(),
});

export type UserProfileData = z.infer<typeof UserProfileSchema>;

const model = new ChatOpenAI({
  model: 'gpt-4o-mini',
  temperature: 0,
});

const profileRunnable = new StructuredOutputRunnable(model, UserProfileSchema);

/**
 * Node: Extract user profile signals silently in the background.
 */
export async function extractProfile(state: GraphState): Promise<Partial<GraphState>> {
  const { user, conversationHistoryTextOnly, traceBuffer } = state;

  const historyText = conversationHistoryTextOnly
    .map((m) => `${m.role}: ${m.content[0].type === 'text' ? m.content[0].text : ''}`)
    .join('\n');

  const systemPrompt = new SystemMessage(`
You are a profile analysis AI. Extract user style preferences, color preferences, budget, and behavioral traits from the conversation.
Focus on signals, not full summaries.

HISTORY:
${historyText}

STRICT JSON OUTPUT ONLY.
`);

  try {
    const profileData = await profileRunnable.run(
      systemPrompt,
      [new UserMessage('Extract signals.')],
      traceBuffer,
      'extractProfile'
    );

    // Upsert into Postgres
    await prisma.userProfile.upsert({
      where: { userId: user.id },
      update: {
        stylePreference: profileData.style_preference,
        colorPreference: profileData.color_preference,
        budgetRange: profileData.budget_range,
        behavioralTraits: profileData.behavioral_traits,
        activityPattern: profileData.activity_pattern,
      },
      create: {
        userId: user.id,
        stylePreference: profileData.style_preference,
        colorPreference: profileData.color_preference,
        budgetRange: profileData.budget_range,
        behavioralTraits: profileData.behavioral_traits || [],
        activityPattern: profileData.activity_pattern,
      },
    });

    logger.debug({ userId: user.id }, 'User profile updated successfully.');

    // --- SESSION SUMMARIZATION ---
    // Extract a concise summary of the current interaction
    const summarizerModel = new ChatOpenAI({ model: 'gpt-4o-mini', temperature: 0 });
    const summaryPrompt = new SystemMessage(`
      Summarize the following fashion styling conversation into 2-3 key bullet points.
      Focus on what the user was looking for and what was recommended.
      
      HISTORY:
      ${historyText}
    `);

    const summaryResult = await summarizerModel.run(
      summaryPrompt,
      [new UserMessage('Summarize.')],
      traceBuffer,
      'extractProfile',
    );
    const summaryText = summaryResult.assistant.content[0].type === 'text' ? summaryResult.assistant.content[0].text : '';

    if (summaryText) {
      await prisma.conversationSummary.create({
        data: {
          conversationId: state.conversationId,
          summary: summaryText,
        }
      });
      logger.debug({ conversationId: state.conversationId }, 'Conversation summary saved.');
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
    logger.error({ err: errMsg, userId: user.id }, 'Failed to extract profile or summary.');
  }

  return {};
}
