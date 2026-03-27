import { Writer } from '../../lib/ai/writer';
import { closeAssistantTokenStream, pushAssistantToken } from '../streamingText';
import { GraphState } from '../state';

const writer = new Writer();

/**
 * Writer node: Generates the final conversational response.
 * Streams tokens to {@link pushAssistantToken} so /api/chat/stream can emit SSE tokens in parallel.
 */
export async function generateResponse(state: GraphState): Promise<Partial<GraphState>> {
  const { input, plan, conversationHistoryWithImages, userProfile, traceBuffer } = state;

  if (!plan) {
    throw new Error('No plan found in state');
  }

  // Handler nodes (e.g. handleGeneral) may already set assistantReply; do not replace with writer output.
  if (state.assistantReply && state.assistantReply.length > 0) {
    return {};
  }

  const profileText = JSON.stringify(userProfile || {}, null, 2);
  const messageId = input.MessageSid;

  let fullResponse = '';
  const stream = writer.write(
    input.Body || '',
    plan,
    conversationHistoryWithImages,
    profileText,
    traceBuffer,
    'generateResponse'
  );

  try {
    for await (const chunk of stream) {
      pushAssistantToken(messageId, chunk);
      fullResponse += chunk;
    }
  } finally {
    closeAssistantTokenStream(messageId);
  }

  return {
    assistantReply: [
      {
        reply_type: 'text',
        reply_text: fullResponse,
      },
    ],
  };
}
