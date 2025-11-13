import { z } from 'zod';
import { getTextLLM } from '../../lib/ai';
import { agentExecutor } from '../../lib/ai/agents/executor';
import { SystemMessage } from '../../lib/ai/core/messages';
import { WELCOME_IMAGE_URL } from '../../utils/constants';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { GraphState, Replies } from '../state';
import { fetchRelevantMemories } from '../tools';
import { sendListPicker } from '../../lib/twilio';
import { TWILIO_LIST_PICKER_SID } from '../../utils/constants';



const LLMOutputSchema = z.object({
  message1_text: z.string().describe('The first text message response to the user.'),
  message2_text: z.string().nullable().describe('The second text message response to the user.'),
});

function formatLLMOutput(text: string): string {
  if (!text) return '';
  const lines = text.split('\n');
  const spacedLines = lines.map(line => line.trim()).join('\n\n');
  return spacedLines.trim();
}

export async function handleGeneral(state: GraphState): Promise<GraphState> {
  const { user, generalIntent, input, conversationHistoryTextOnly, traceBuffer } = state;
  const userId = user.id;
  const messageId = input.MessageSid;

  try {
    // ------------------------------------------
    // Greeting Intent — Now uses List Picker
    // ------------------------------------------
    if (generalIntent === 'greeting') {
      const greetingText = `✨ Welcome, ${user.profileName || 'there'}! Let's explore some Broadway magic.`;
      const replies: Replies = [{ reply_type: 'image', media_url: WELCOME_IMAGE_URL }];

      logger.debug({ userId, messageId }, 'Greeting image sent, preparing list picker.');

      try {
        await sendListPicker(
  user.whatsappId,
  TWILIO_LIST_PICKER_SID,  
  { user_name: user.profileName ?? '' }
);
      } catch (err) {
        logger.error({ err, userId }, 'Failed to send Twilio List Picker greeting menu.');
        // fallback to plain text
        replies.push({ reply_type: 'text', reply_text: greetingText });
      }

      return { ...state, assistantReply: replies };
    }

    // ------------------------------------------
    // Menu Intent (kept same, but can reuse List Picker if preferred)
    // ------------------------------------------
    if (generalIntent === 'menu') {
      const menuText = 'Please choose one of the following options:';
      const buttons = [
        { text: 'Vibe check', id: 'vibe_check' },
        { text: 'Color analysis', id: 'color_analysis' },
        { text: 'Style Studio', id: 'style_studio' },
        { text: 'This or That', id: 'this_or_that' },
        { text: 'Skin Lab', id: 'skin_lab' },
      ];
      const replies: Replies = [{ reply_type: 'quick_reply', reply_text: menuText, buttons }];
      logger.debug({ userId, messageId }, 'Menu handled with static response');
      return { ...state, assistantReply: replies };
    }

    // ------------------------------------------
    // Tonality Intent (unchanged)
    // ------------------------------------------
    if (generalIntent === 'tonality') {
      const tonalityText = 'Choose your vibe! *✨💬*';
      const buttons = [
        { text: 'Hype BFF 🔥', id: 'hype_bff' },
        { text: 'Friendly 🙂', id: 'friendly' },
        { text: 'Savage 😈', id: 'savage' },
      ];
      const replies: Replies = [{ reply_type: 'quick_reply', reply_text: tonalityText, buttons }];
      logger.debug({ userId, messageId }, 'Tonality handled with static response');
      return { ...state, assistantReply: replies };
    }

    // ------------------------------------------
    // Chat Intent (unchanged)
    // ------------------------------------------
    if (generalIntent === 'chat') {
      let systemPromptText = await loadPrompt('handlers/general/handle_chat.txt');
      systemPromptText += "\nPlease respond concisely, avoiding verbosity.";

      const tools = [fetchRelevantMemories(userId)];
      const systemPrompt = new SystemMessage(systemPromptText);

      const finalResponse = await agentExecutor(
        getTextLLM(),
        systemPrompt,
        conversationHistoryTextOnly,
        { tools, outputSchema: LLMOutputSchema, nodeName: 'handleGeneral' },
        traceBuffer,
      );

      const formattedMessage1 = formatLLMOutput(finalResponse.message1_text);
      const formattedMessage2 = finalResponse.message2_text ? formatLLMOutput(finalResponse.message2_text) : null;

      const replies: Replies = [{ reply_type: 'text', reply_text: formattedMessage1 }];
      if (formattedMessage2) replies.push({ reply_type: 'text', reply_text: formattedMessage2 });

      logger.debug({ userId, messageId }, 'Chat handled with formatted output');
      return { ...state, assistantReply: replies };
    }

    // ------------------------------------------
    // Unhandled intents
    // ------------------------------------------
    throw new InternalServerError(`Unhandled general intent: ${generalIntent}`);

  } catch (err: unknown) {
    throw new InternalServerError('Failed to handle general intent', { cause: err });
  }
}
