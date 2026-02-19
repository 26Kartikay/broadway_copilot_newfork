import { z } from 'zod';
import { getTextLLM } from '../../lib/ai';
import { SystemMessage } from '../../lib/ai/core/messages';
import { logger } from '../../utils/logger';
import { loadPrompt } from '../../utils/prompts';
import { GraphState, Replies } from '../state';

const FollowUpOutputSchema = z.object({
  follow_up_text: z
    .string()
    .nullable()
    .describe(
      'A contextually relevant follow-up question that builds on what was just discussed. Should be null if no follow-up is needed (e.g., user just said goodbye).',
    ),
  should_skip: z
    .boolean()
    .describe(
      'Set to true if no follow-up is needed (e.g., user ended conversation, already has pending action, etc.)',
    ),
});

/**
 * Generates a smart follow-up question based on the previous node's response and conversation context.
 * This node analyzes:
 * - The last assistant reply (what was just said)
 * - Recent conversation history (last 3-4 messages)
 * - Current intent/context
 * - Whether a follow-up is appropriate
 */
export async function generateFollowUp(state: GraphState): Promise<GraphState> {
  const { user, assistantReply, conversationHistoryTextOnly, intent, generalIntent, pending, traceBuffer } = state;
  const userId = user.id;

  logger.debug(
    { userId, intent, generalIntent, hasReply: !!assistantReply, replyCount: assistantReply?.length || 0 },
    'generateFollowUp node called',
  );

  try {
    // Skip follow-up generation if:
    // 1. No assistant reply exists yet
    // 2. User has a pending action (waiting for input)
    // 3. Last reply already contains a quick_reply or list_picker (already has buttons)
    // 4. Greeting/menu intents (they already have structured responses)
    if (!assistantReply || assistantReply.length === 0) {
      logger.debug({ userId }, 'Skipping follow-up: no assistant reply');
      return state;
    }

    if (pending && pending !== 'NONE') {
      logger.debug({ userId, pending }, 'Skipping follow-up: user has pending action');
      return state;
    }

    const hasInteractiveReply = assistantReply.some(
      (r) => r.reply_type === 'quick_reply' || r.reply_type === 'list_picker',
    );
    if (hasInteractiveReply) {
      logger.debug({ userId }, 'Skipping follow-up: reply already has interactive elements');
      return state;
    }

    if (generalIntent === 'greeting' || generalIntent === 'menu') {
      logger.debug({ userId }, 'Skipping follow-up: greeting/menu intent');
      return state;
    }

    // Check if a follow-up already exists (from message2_text in other nodes)
    // Count text replies - if there are 2+ text replies, likely already has a follow-up
    const textReplies = assistantReply.filter((r) => r.reply_type === 'text');
    if (textReplies.length >= 2) {
      logger.debug({ userId, textReplyCount: textReplies.length }, 'Skipping follow-up: reply already contains multiple text messages (likely has follow-up)');
      return state;
    }

    // Extract the last assistant reply text for context
    const lastAssistantText = assistantReply
      .map((r) => {
        if ('reply_text' in r && r.reply_text) {
          return r.reply_text;
        }
        // Extract meaningful info from cards
        if (r.reply_type === 'vibe_check_card') {
          return `Vibe check completed with score ${r.overall_score}. Recommendations: ${r.recommendations.join(', ')}`;
        }
        if (r.reply_type === 'color_analysis_card') {
          return `Color analysis: ${r.palette_name} palette`;
        }
        if (r.reply_type === 'product_card' && 'products' in r) {
          return `Recommended products: ${r.products.map((p) => p.name).join(', ')}`;
        }
        return '';
      })
      .filter((text) => text.length > 0)
      .join('\n');

    // Get recent conversation context (last 3-4 messages)
    const recentMessages = conversationHistoryTextOnly.slice(-4);
    const recentContext = recentMessages
      .map((msg) => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        const content =
          typeof msg.content === 'string'
            ? msg.content
            : msg.content.map((c) => (c.type === 'text' ? c.text : '')).join(' ');
        return `${role}: ${content}`;
      })
      .join('\n');

    // Build context summary
    const contextSummary = {
      intent: intent || generalIntent || 'unknown',
      lastAssistantReply: lastAssistantText,
      recentConversation: recentContext,
      userProfile: {
        name: user.profileName || 'User',
        gender: user.confirmedGender || user.inferredGender || 'unknown',
      },
    };

    // Load the follow-up generation prompt
    const systemPromptText = await loadPrompt('handlers/follow_up/generate_followup.txt', state.user);

    // Inject context into the prompt
    let enhancedPrompt = systemPromptText;
    if (user.profileName) {
      enhancedPrompt += `\nThe user's name is ${user.profileName}.`;
    }

    const userGender = user.confirmedGender || user.inferredGender;
    if (userGender) {
      enhancedPrompt += `\nThe user's gender is ${userGender}.`;
    }

    // Add context about what was just discussed
    enhancedPrompt += `\n\n## Current Context:\n`;
    enhancedPrompt += `Intent: ${contextSummary.intent}\n`;
    enhancedPrompt += `Last Assistant Reply: ${contextSummary.lastAssistantReply}\n`;
    enhancedPrompt += `Recent Conversation:\n${contextSummary.recentConversation}\n`;

    const systemPrompt = new SystemMessage(enhancedPrompt);

    // Generate follow-up using LLM
    const llm = getTextLLM();
    const result = await llm
      .withStructuredOutput(FollowUpOutputSchema)
      .run(systemPrompt, [], traceBuffer, 'generateFollowUp');

    logger.debug({ userId, shouldSkip: result.should_skip, hasFollowUp: !!result.follow_up_text }, 'Follow-up generation result');

    // If LLM says to skip, or no follow-up text, return state unchanged
    if (result.should_skip || !result.follow_up_text) {
      return state;
    }

    // Add the follow-up as a text reply
    const updatedReplies: Replies = [...assistantReply, { reply_type: 'text', reply_text: result.follow_up_text }];

    return {
      ...state,
      assistantReply: updatedReplies,
    };
  } catch (err: unknown) {
    logger.warn({ userId, err: (err as Error)?.message }, 'Failed to generate follow-up, continuing without it');
    // Don't fail the entire flow if follow-up generation fails
    return state;
  }
}

