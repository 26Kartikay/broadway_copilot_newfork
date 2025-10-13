import { z } from 'zod';
import { getTextLLM } from '../../lib/ai';
import { SystemMessage } from '../../lib/ai/core/messages';
import type { GraphState, Replies } from '../state';

// Output schema for LLM structured response
export const FactLLMOutputSchema = z.object({
  fact_text: z.string().describe('A fun, single-sentence fact for WhatsApp users.'),
});

export async function dailyFact(state: GraphState): Promise<Partial<GraphState>> {
  const systemPromptText = 'Provide a fun color fact suitable for a WhatsApp daily tip.';
  const systemPrompt = new SystemMessage(systemPromptText);

  // Use the trace buffer from the state or fallback to empty
  const traceBuffer = state.traceBuffer ?? { nodeRuns: [], llmTraces: [] };

  // Invoke LLM to get structured fact output
  const response = await getTextLLM()
    .withStructuredOutput(FactLLMOutputSchema)
    .run(systemPrompt, [], traceBuffer, 'dailyFact');

  const fact = response.fact_text;

  const replies: Replies = [
    {
      reply_type: 'text',
      reply_text: fact,
    },
  ];

  // Return partial state with assistant replies and clear pending status
  return {
    assistantReply: replies,
    pending: null,
  };
}
