import { z } from 'zod';
import { getTextLLM } from '../../lib/ai';
import { agentExecutor } from '../../lib/ai/agents/executor';
import { SystemMessage } from '../../lib/ai/core/messages';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { GraphState, Replies } from '../state';
import { fetchRelevantMemories } from '../tools';

/**
 * LLM output schema for Skin Lab service.
 * Ensures proper structure for one or two message responses.
 */
const LLMOutputSchema = z.object({
  message1_text: z.string().describe('Primary text message response for Skin Lab.'),
  message2_text: z.string().nullable().describe('Optional follow-up text for Skin Lab.'),
});

/**
 * Helper: Formats text with line breaks and spacing for readability.
 */
function formatLLMOutput(text: string): string {
  if (!text) return '';
  const lines = text.split('\n').map(line => line.trim());
  return lines.join('\n\n').trim();
}

/**
 * Handles the Skin Lab service — AI-powered skincare recommendations, analysis, and routines.
 */
export async function handleSkinLab(state: GraphState): Promise<GraphState> {
  const { user, conversationHistoryTextOnly, traceBuffer, input } = state;
  const userId = user.id;
  const messageId = input.MessageSid;

  try {
    // Load the system prompt for Skin Lab
    const systemPromptText = await loadPrompt('handlers/skin_lab/skin_lab_prompt.txt');

    // Use relevant user memories as supporting context
    const tools = [fetchRelevantMemories(userId)];
    const systemPrompt = new SystemMessage(systemPromptText);

    // Run LLM with structured output
    const { output: finalResponse } = await agentExecutor(
      getTextLLM(),
      systemPrompt,
      conversationHistoryTextOnly,
      { tools, outputSchema: LLMOutputSchema, nodeName: 'handleSkinLab' },
      traceBuffer,
    );

    // Format the LLM messages
    const formattedMessage1 = formatLLMOutput(finalResponse.message1_text);
    const formattedMessage2 = finalResponse.message2_text
      ? formatLLMOutput(finalResponse.message2_text)
      : null;

    // Build WhatsApp replies array
    const replies: Replies = [{ reply_type: 'text', reply_text: formattedMessage1 }];
    if (formattedMessage2) {
      replies.push({ reply_type: 'text', reply_text: formattedMessage2 });
    }

    logger.info(
      { userId, messageId },
      'Skin Lab: Successfully generated AI skincare advice response',
    );

    return { ...state, assistantReply: replies };
  } catch (err: unknown) {
    logger.error(
      { userId, messageId, error: err instanceof Error ? err.message : String(err) },
      'Skin Lab: Failed to generate response',
    );
    throw new InternalServerError('Failed to handle Skin Lab request', { cause: err });
  }
}
