"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleGeneral = handleGeneral;
const zod_1 = require("zod");
const ai_1 = require("../../lib/ai");
const executor_1 = require("../../lib/ai/agents/executor");
const messages_1 = require("../../lib/ai/core/messages");
const constants_1 = require("../../utils/constants");
const errors_1 = require("../../utils/errors");
const logger_1 = require("../../utils/logger");
const prompts_1 = require("../../utils/prompts");
const tools_1 = require("../tools");
const LLMOutputSchema = zod_1.z.object({
    message1_text: zod_1.z.string().describe('The first text message response to the user.'),
    message2_text: zod_1.z.string().nullable().describe('The second text message response to the user.'),
});
async function handleGeneral(state) {
    const { user, generalIntent, input, conversationHistoryTextOnly, traceBuffer } = state;
    const userId = user.id;
    const messageId = input.MessageSid;
    try {
        if (generalIntent === 'greeting') {
            const greetingText = `Welcome, ${user.profileName}! How can we assist you today?`;
            const buttons = [
                { text: 'Vibe check', id: 'vibe_check' },
                { text: 'Color analysis', id: 'color_analysis' },
                { text: 'Styling', id: 'styling' },
            ];
            const replies = [
                { reply_type: 'image', media_url: constants_1.WELCOME_IMAGE_URL },
                { reply_type: 'quick_reply', reply_text: greetingText, buttons },
            ];
            logger_1.logger.debug({ userId, messageId }, 'Greeting handled with static response');
            return { ...state, assistantReply: replies };
        }
        if (generalIntent === 'menu') {
            const menuText = 'Please choose one of the following options:';
            const buttons = [
                { text: 'Vibe check', id: 'vibe_check' },
                { text: 'Color analysis', id: 'color_analysis' },
                { text: 'Styling', id: 'styling' },
            ];
            const replies = [{ reply_type: 'quick_reply', reply_text: menuText, buttons }];
            logger_1.logger.debug({ userId, messageId }, 'Menu handled with static response');
            return { ...state, assistantReply: replies };
        }
        if (generalIntent === 'tonality') {
            const tonalityText = 'Choose your vibe! ✨💬';
            const buttons = [
                { text: 'Hype BFF 🔥', id: 'hype_bff' },
                { text: 'Friendly 🙂', id: 'friendly' },
                { text: 'Savage 😈', id: 'savage' },
            ];
            const replies = [{ reply_type: 'quick_reply', reply_text: tonalityText, buttons }];
            logger_1.logger.debug({ userId, messageId }, 'Tonality handled with static response');
            return { ...state, assistantReply: replies };
        }
        if (generalIntent === 'chat') {
            const tools = [(0, tools_1.fetchRelevantMemories)(userId)];
            const systemPromptText = await (0, prompts_1.loadPrompt)('handlers/general/handle_chat.txt');
            const systemPrompt = new messages_1.SystemMessage(systemPromptText);
            const finalResponse = await (0, executor_1.agentExecutor)((0, ai_1.getTextLLM)(), systemPrompt, conversationHistoryTextOnly, { tools, outputSchema: LLMOutputSchema, nodeName: 'handleGeneral' }, traceBuffer);
            const replies = [{ reply_type: 'text', reply_text: finalResponse.message1_text }];
            if (finalResponse.message2_text) {
                replies.push({ reply_type: 'text', reply_text: finalResponse.message2_text });
            }
            logger_1.logger.debug({ userId, messageId }, 'Chat handled');
            return { ...state, assistantReply: replies };
        }
        throw new errors_1.InternalServerError(`Unhandled general intent: ${generalIntent}`);
    }
    catch (err) {
        throw new errors_1.InternalServerError('Failed to handle general intent', {
            cause: err,
        });
    }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ub2Rlcy9oYW5kbGVHZW5lcmFsLnRzIiwic291cmNlcyI6WyIvdXNyL3NyYy9hcHAvc3JjL2FnZW50L25vZGVzL2hhbmRsZUdlbmVyYWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFpQkEsc0NBMEVDO0FBM0ZELDZCQUF3QjtBQUN4QixxQ0FBMEM7QUFDMUMsMkRBQTZEO0FBQzdELHlEQUEyRDtBQUMzRCxxREFBMEQ7QUFDMUQsK0NBQXlEO0FBQ3pELCtDQUE0QztBQUM1QyxpREFBaUQ7QUFFakQsb0NBQWlEO0FBR2pELE1BQU0sZUFBZSxHQUFHLE9BQUMsQ0FBQyxNQUFNLENBQUM7SUFDL0IsYUFBYSxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxRQUFRLENBQUMsOENBQThDLENBQUM7SUFDbEYsYUFBYSxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxRQUFRLENBQUMsK0NBQStDLENBQUM7Q0FDL0YsQ0FBQyxDQUFDO0FBRUksS0FBSyxVQUFVLGFBQWEsQ0FBQyxLQUFpQjtJQUNuRCxNQUFNLEVBQUUsSUFBSSxFQUFFLGFBQWEsRUFBRSxLQUFLLEVBQUUsMkJBQTJCLEVBQUUsV0FBVyxFQUFFLEdBQUcsS0FBSyxDQUFDO0lBQ3ZGLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxFQUFFLENBQUM7SUFDdkIsTUFBTSxTQUFTLEdBQUcsS0FBSyxDQUFDLFVBQVUsQ0FBQztJQUVuQyxJQUFJLENBQUM7UUFDSCxJQUFJLGFBQWEsS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUNqQyxNQUFNLFlBQVksR0FBRyxZQUFZLElBQUksQ0FBQyxXQUFXLGdDQUFnQyxDQUFDO1lBQ2xGLE1BQU0sT0FBTyxHQUFHO2dCQUNkLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxFQUFFLEVBQUUsWUFBWSxFQUFFO2dCQUN4QyxFQUFFLElBQUksRUFBRSxnQkFBZ0IsRUFBRSxFQUFFLEVBQUUsZ0JB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M0YsSUFBSSxhQUFhLENBQUMsYUFBYSxFQUFFLENBQUM7Z0JBQ2hDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxhQUFhLENBQUMsYUFBYSxFQUFFLENBQUMsQ0FBQztZQUNoRixDQUFDO1lBRUQsZUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsRUFBRSxjQUFjLENBQUMsQ0FBQztZQUNwRCxPQUFPLEVBQUUsR0FBRyxLQUFLLEVBQUUsY0FBYyxFQUFFLE9BQU8sRUFBRSxDQUFDO1FBQy9DLENBQUM7UUFFRCxNQUFNLElBQUksNEJBQW1CLENBQUMsNkJBQTZCLGFBQWEsRUFBRSxDQUFDLENBQUM7SUFDOUUsQ0FBQztJQUFDLE9BQU8sR0FBWSxFQUFFLENBQUM7UUFDdEIsTUFBTSxJQUFJLDRCQUFtQixDQUFDLGlDQUFpQyxFQUFFO1lBQy9ELEtBQUssRUFBRSxHQUFHO1NBQ1gsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyB6IH0gZnJvbSAnem9kJztcbmltcG9ydCB7IGdldFRleHRMTE0gfSBmcm9tICcuLi8uLi9saWIvYWknO1xuaW1wb3J0IHsgYWdlbnRFeGVjdXRvciB9IGZyb20gJy4uLy4uL2xpYi9haS9hZ2VudHMvZXhlY3V0b3InO1xuaW1wb3J0IHsgU3lzdGVtTWVzc2FnZSB9IGZyb20gJy4uLy4uL2xpYi9haS9jb3JlL21lc3NhZ2VzJztcbmltcG9ydCB7IFdFTENPTUVfSU1BR0VfVVJMIH0gZnJvbSAnLi4vLi4vdXRpbHMvY29uc3RhbnRzJztcbmltcG9ydCB7IEludGVybmFsU2VydmVyRXJyb3IgfSBmcm9tICcuLi8uLi91dGlscy9lcnJvcnMnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vLi4vdXRpbHMvbG9nZ2VyJztcbmltcG9ydCB7IGxvYWRQcm9tcHQgfSBmcm9tICcuLi8uLi91dGlscy9wcm9tcHRzJztcbmltcG9ydCB7IEdyYXBoU3RhdGUsIFJlcGxpZXMgfSBmcm9tICcuLi9zdGF0ZSc7XG5pbXBvcnQgeyBmZXRjaFJlbGV2YW50TWVtb3JpZXMgfSBmcm9tICcuLi90b29scyc7XG5cbi8vIERlZmluZSB0aGUgb3V0cHV0IHNjaGVtYSBmb3IgY2hhdCByZXNwb25zZXMgbG9jYWxseVxuY29uc3QgTExNT3V0cHV0U2NoZW1hID0gei5vYmplY3Qoe1xuICBtZXNzYWdlMV90ZXh0OiB6LnN0cmluZygpLmRlc2NyaWJlKCdUaGUgZmlyc3QgdGV4dCBtZXNzYWdlIHJlc3BvbnNlIHRvIHRoZSB1c2VyLicpLFxuICBtZXNzYWdlMl90ZXh0OiB6LnN0cmluZygpLm51bGxhYmxlKCkuZGVzY3JpYmUoJ1RoZSBzZWNvbmQgdGV4dCBtZXNzYWdlIHJlc3BvbnNlIHRvIHRoZSB1c2VyLicpLFxufSk7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYW5kbGVHZW5lcmFsKHN0YXRlOiBHcmFwaFN0YXRlKTogUHJvbWlzZTxHcmFwaFN0YXRlPiB7XG4gIGNvbnN0IHsgdXNlciwgZ2VuZXJhbEludGVudCwgaW5wdXQsIGNvbnZlcnNhdGlvbkhpc3RvcnlUZXh0T25seSwgdHJhY2VCdWZmZXIgfSA9IHN0YXRlO1xuICBjb25zdCB1c2VySWQgPSB1c2VyLmlkO1xuICBjb25zdCBtZXNzYWdlSWQgPSBpbnB1dC5NZXNzYWdlU2lkO1xuXG4gIHRyeSB7XG4gICAgaWYgKGdlbmVyYWxJbnRlbnQgPT09ICdncmVldGluZycpIHtcbiAgICAgIGNvbnN0IGdyZWV0aW5nVGV4dCA9IGBXZWxjb21lLCAke3VzZXIucHJvZmlsZU5hbWV9ISBIb3cgY2FuIHdlIGFzc2lzdCB5b3UgdG9kYXk/YDtcbiAgICAgIGNvbnN0IGJ1dHRvbnMgPSBbXG4gICAgICAgIHsgdGV4dDogJ1ZpYmUgY2hlY2snLCBpZDogJ3ZpYmVfY2hlY2snIH0sXG4gICAgICAgIHsgdGV4dDogJ0NvbG9yIGFuYWx5c2lzJywgaWQ6ICdjb2xvcl9hbmFseXNpcycgfSxcbiAgICAgICAgeyB0ZXh0OiAnU3R5bGluZycsIGlkOiAnc3R5bGluZycgfSxcbiAgICAgIF07XG4gICAgICBjb25zdCByZXBsaWVzOiBSZXBsaWVzID0gW1xuICAgICAgICB7IHJlcGx5X3R5cGU6ICdpbWFnZScsIG1lZGlhX3VybDogV0VMQ09NRV9JTUFHRV9VUkwgfSxcbiAgICAgICAgeyByZXBseV90eXBlOiAncXVpY2tfcmVwbHknLCByZXBseV90ZXh0OiBncmVldGluZ1RleHQsIGJ1dHRvbnMgfSxcbiAgICAgIF07XG4gICAgICBsb2dnZXIuZGVidWcoeyB1c2VySWQsIG1lc3NhZ2VJZCB9LCAnR3JlZXRpbmcgaGFuZGxlZCB3aXRoIHN0YXRpYyByZXNwb25zZScpO1xuICAgICAgcmV0dXJuIHsgLi4uc3RhdGUsIGFzc2lzdGFudFJlcGx5OiByZXBsaWVzIH07XG4gICAgfVxuXG4gICAgaWYgKGdlbmVyYWxJbnRlbnQgPT09ICdtZW51Jykge1xuICAgICAgY29uc3QgbWVudVRleHQgPSAnUGxlYXNlIGNob29zZSBvbmUgb2YgdGhlIGZvbGxvd2luZyBvcHRpb25zOic7XG4gICAgICBjb25zdCBidXR0b25zID0gW1xuICAgICAgICB7IHRleHQ6ICdWaWJlIGNoZWNrJywgaWQ6ICd2aWJlX2NoZWNrJyB9LFxuICAgICAgICB7IHRleHQ6ICdDb2xvciBhbmFseXNpcycsIGlkOiAnY29sb3JfYW5hbHlzaXMnIH0sXG4gICAgICAgIHsgdGV4dDogJ1N0eWxpbmcnLCBpZDogJ3N0eWxpbmcnIH0sXG4gICAgICBdO1xuICAgICAgY29uc3QgcmVwbGllczogUmVwbGllcyA9IFt7IHJlcGx5X3R5cGU6ICdxdWlja19yZXBseScsIHJlcGx5X3RleHQ6IG1lbnVUZXh0LCBidXR0b25zIH1dO1xuICAgICAgbG9nZ2VyLmRlYnVnKHsgdXNlcklkLCBtZXNzYWdlSWQgfSwgJ01lbnUgaGFuZGxlZCB3aXRoIHN0YXRpYyByZXNwb25zZScpO1xuICAgICAgcmV0dXJuIHsgLi4uc3RhdGUsIGFzc2lzdGFudFJlcGx5OiByZXBsaWVzIH07XG4gICAgfVxuXG4gICAgaWYgKGdlbmVyYWxJbnRlbnQgPT09ICd0b25hbGl0eScpIHtcbiAgICAgIGNvbnN0IHRvbmFsaXR5VGV4dCA9ICdDaG9vc2UgeW91ciB2aWJlISDinKjwn5KsJztcbiAgICAgIGNvbnN0IGJ1dHRvbnMgPSBbXG4gICAgICAgIHsgdGV4dDogJ0h5cGUgQkZGIPCflKUnLCBpZDogJ2h5cGVfYmZmJyB9LFxuICAgICAgICB7IHRleHQ6ICdGcmllbmRseSDwn5mCJywgaWQ6ICdmcmllbmRseScgfSxcbiAgICAgICAgeyB0ZXh0OiAnU2F2YWdlIPCfmIgnLCBpZDogJ3NhdmFnZScgfSxcbiAgICAgIF07XG4gICAgICBjb25zdCByZXBsaWVzOiBSZXBsaWVzID0gW3sgcmVwbHlfdHlwZTogJ3F1aWNrX3JlcGx5JywgcmVwbHlfdGV4dDogdG9uYWxpdHlUZXh0LCBidXR0b25zIH1dO1xuICAgICAgbG9nZ2VyLmRlYnVnKHsgdXNlcklkLCBtZXNzYWdlSWQgfSwgJ1RvbmFsaXR5IGhhbmRsZWQgd2l0aCBzdGF0aWMgcmVzcG9uc2UnKTtcbiAgICAgIHJldHVybiB7IC4uLnN0YXRlLCBhc3Npc3RhbnRSZXBseTogcmVwbGllcyB9O1xuICAgIH1cblxuICAgIGlmIChnZW5lcmFsSW50ZW50ID09PSAnY2hhdCcpIHtcbiAgICAgIC8vIElubGluZSBjaGF0IGhhbmRsaW5nIGxvZ2ljXG4gICAgICBjb25zdCB0b29scyA9IFtmZXRjaFJlbGV2YW50TWVtb3JpZXModXNlcklkKV07XG4gICAgICBjb25zdCBzeXN0ZW1Qcm9tcHRUZXh0ID0gYXdhaXQgbG9hZFByb21wdCgnaGFuZGxlcnMvZ2VuZXJhbC9oYW5kbGVfY2hhdC50eHQnKTtcbiAgICAgIGNvbnN0IHN5c3RlbVByb21wdCA9IG5ldyBTeXN0ZW1NZXNzYWdlKHN5c3RlbVByb21wdFRleHQpO1xuXG4gICAgICBjb25zdCBmaW5hbFJlc3BvbnNlID0gYXdhaXQgYWdlbnRFeGVjdXRvcihcbiAgICAgICAgZ2V0VGV4dExMTSgpLFxuICAgICAgICBzeXN0ZW1Qcm9tcHQsXG4gICAgICAgIGNvbnZlcnNhdGlvbkhpc3RvcnlUZXh0T25seSxcbiAgICAgICAgeyB0b29scywgb3V0cHV0U2NoZW1hOiBMTE1PdXRwdXRTY2hlbWEsIG5vZGVOYW1lOiAnaGFuZGxlR2VuZXJhbCcgfSxcbiAgICAgICAgdHJhY2VCdWZmZXIsXG4gICAgICApO1xuXG4gICAgICBjb25zdCByZXBsaWVzOiBSZXBsaWVzID0gW3sgcmVwbHlfdHlwZTogJ3RleHQnLCByZXBseV90ZXh0OiBmaW5hbFJlc3BvbnNlLm1lc3NhZ2UxX3RleHQgfV07XG4gICAgICBpZiAoZmluYWxSZXNwb25zZS5tZXNzYWdlMl90ZXh0KSB7XG4gICAgICAgIHJlcGxpZXMucHVzaCh7IHJlcGx5X3R5cGU6ICd0ZXh0JywgcmVwbHlfdGV4dDogZmluYWxSZXNwb25zZS5tZXNzYWdlMl90ZXh0IH0pO1xuICAgICAgfVxuXG4gICAgICBsb2dnZXIuZGVidWcoeyB1c2VySWQsIG1lc3NhZ2VJZCB9LCAnQ2hhdCBoYW5kbGVkJyk7XG4gICAgICByZXR1cm4geyAuLi5zdGF0ZSwgYXNzaXN0YW50UmVwbHk6IHJlcGxpZXMgfTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgSW50ZXJuYWxTZXJ2ZXJFcnJvcihgVW5oYW5kbGVkIGdlbmVyYWwgaW50ZW50OiAke2dlbmVyYWxJbnRlbnR9YCk7XG4gIH0gY2F0Y2ggKGVycjogdW5rbm93bikge1xuICAgIHRocm93IG5ldyBJbnRlcm5hbFNlcnZlckVycm9yKCdGYWlsZWQgdG8gaGFuZGxlIGdlbmVyYWwgaW50ZW50Jywge1xuICAgICAgY2F1c2U6IGVycixcbiAgICB9KTtcbiAgfVxufVxuIl19