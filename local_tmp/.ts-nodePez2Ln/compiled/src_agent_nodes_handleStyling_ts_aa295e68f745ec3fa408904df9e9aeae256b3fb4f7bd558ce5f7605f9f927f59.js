"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStyling = handleStyling;
const zod_1 = require("zod");
const ai_1 = require("../../lib/ai");
const executor_1 = require("../../lib/ai/agents/executor");
const messages_1 = require("../../lib/ai/core/messages");
const errors_1 = require("../../utils/errors");
const logger_1 = require("../../utils/logger");
const prompts_1 = require("../../utils/prompts");
const tools_1 = require("../tools");
const LLMOutputSchema = zod_1.z.object({
    stylingIntent: zod_1.z.enum(['occasion', 'vacation', 'pairing', 'suggest']),
    message1_text: zod_1.z.string(),
    message2_text: zod_1.z.string().nullable(),
});
async function handleStyling(state) {
    const { user, stylingIntent, conversationHistoryTextOnly } = state;
    const userId = user.id;
    const lastMessage = conversationHistoryTextOnly.at(-1);
    if (!stylingIntent) {
        throw new errors_1.InternalServerError('handleStylingNode called without a styling intent.');
    }
    try {
        if (lastMessage?.meta?.buttonPayload) {
            const defaultPromptText = await (0, prompts_1.loadPrompt)('handlers/styling/handle_styling_no_input.txt');
            const systemPromptText = defaultPromptText.replace('{INTENT}', stylingIntent);
            const systemPrompt = new messages_1.SystemMessage(systemPromptText);
            const response = await (0, ai_1.getTextLLM)()
                .withStructuredOutput(LLMOutputSchema)
                .run(systemPrompt, conversationHistoryTextOnly, state.traceBuffer, 'handleStyling');
            const reply_text = response.message1_text;
            logger_1.logger.debug({ userId, reply_text }, 'Returning with default LLM reply');
            const replies = [{ reply_type: 'text', reply_text }];
            return { ...state, assistantReply: replies };
        }
        const tools = [(0, tools_1.searchWardrobe)(userId), (0, tools_1.fetchColorAnalysis)(userId)];
        const systemPromptText = await (0, prompts_1.loadPrompt)(`handlers/styling/handle_${stylingIntent}.txt`);
        const systemPrompt = new messages_1.SystemMessage(systemPromptText);
        const finalResponse = await (0, executor_1.agentExecutor)((0, ai_1.getTextLLM)(), systemPrompt, conversationHistoryTextOnly, {
            tools,
            outputSchema: LLMOutputSchema,
            nodeName: 'handleStyling',
        }, state.traceBuffer);
        const replies = [{ reply_type: 'text', reply_text: finalResponse.message1_text }];
        if (finalResponse.message2_text) {
            replies.push({
                reply_type: 'text',
                reply_text: finalResponse.message2_text,
            });
        }
        logger_1.logger.debug({ userId, replies }, 'Returning styling response');
        return { ...state, assistantReply: replies };
    }
    catch (err) {
        logger_1.logger.error({ userId, err }, 'Error in handleStyling');
        throw new errors_1.InternalServerError('Failed to handle styling request', {
            cause: err,
        });
    }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ub2Rlcy9oYW5kbGVTdHlsaW5nLnRzIiwic291cmNlcyI6WyIvdXNyL3NyYy9hcHAvc3JjL2FnZW50L25vZGVzL2hhbmRsZVN0eWxpbmcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFpQkEsc0NBd0RDO0FBekVELDZCQUF3QjtBQUV4QixxQ0FBMEM7QUFDMUMsMkRBQTZEO0FBQzdELHlEQUEyRDtBQUMzRCwrQ0FBeUQ7QUFDekQsK0NBQTRDO0FBQzVDLGlEQUFpRDtBQUVqRCxvQ0FBOEQ7QUFFOUQsTUFBTSxlQUFlLEdBQUcsT0FBQyxDQUFDLE1BQU0sQ0FBQztJQUMvQixhQUFhLEVBQUUsT0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQyxDQUFDO0lBQ3JFLGFBQWEsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFO0lBQ3pCLGFBQWEsRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxFQUFFO0NBQ3JDLENBQUMsQ0FBQztBQUVJLEtBQUssVUFBVSxhQUFhLENBQUMsS0FBaUI7SUFDbkQsTUFBTSxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsMkJBQTJCLEVBQUUsR0FBRyxLQUFLLENBQUM7SUFDbkUsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLEVBQUUsQ0FBQztJQUN2QixNQUFNLFdBQVcsR0FBRywyQkFBMkIsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUV2RCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDbkIsTUFBTSxJQUFJLDRCQUFtQixDQUFDLG9EQUFvRCxDQUFDLENBQUM7SUFDdEYsQ0FBQztJQUVELElBQUksQ0FBQztRQUNILElBQUksV0FBVyxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsQ0FBQztZQUNyQyxNQUFNLGlCQUFpQixHQUFHLE1BQU0sSUFBQSxvQkFBVSxFQUFDLDhDQUE4QyxDQUFDLENBQUM7WUFDM0YsTUFBTSxnQkFBZ0IsR0FBRyxpQkFBaUIsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLGFBQWEsQ0FBQyxDQUFDO1lBQzlFLE1BQU0sWUFBWSxHQUFHLElBQUksd0JBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1lBQ3pELE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBQSxlQUFVLEdBQUU7aUJBQ2hDLG9CQUFvQixDQUFDLGVBQWUsQ0FBQztpQkFDckMsR0FBRyxDQUFDLFlBQVksRUFBRSwyQkFBMkIsRUFBRSxLQUFLLENBQUMsV0FBVyxFQUFFLGVBQWUsQ0FBQyxDQUFDO1lBQ3RGLE1BQU0sVUFBVSxHQUFHLFFBQVEsQ0FBQyxhQUF1QixDQUFDO1lBQ3BELGVBQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxNQUFNLEVBQUUsVUFBVSxFQUFFLEVBQUUsa0NBQWtDLENBQUMsQ0FBQztZQUN6RSxNQUFNLE9BQU8sR0FBWSxDQUFDLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSxVQUFVLEVBQUUsQ0FBQyxDQUFDO1lBQzlELE9BQU8sRUFBRSxHQUFHLEtBQUssRUFBRSxjQUFjLEVBQUUsT0FBTyxFQUFFLENBQUM7UUFDL0MsQ0FBQztRQUVELE1BQU0sS0FBSyxHQUFHLENBQUMsSUFBQSxzQkFBYyxFQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUEsMEJBQWtCLEVBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztRQUVuRSxNQUFNLGdCQUFnQixHQUFHLE1BQU0sSUFBQSxvQkFBVSxFQUFDLDJCQUEyQixhQUFhLE1BQU0sQ0FBQyxDQUFDO1FBQzFGLE1BQU0sWUFBWSxHQUFHLElBQUksd0JBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBRXpELE1BQU0sYUFBYSxHQUFHLE1BQU0sSUFBQSx3QkFBYSxFQUN2QyxJQUFBLGVBQVUsR0FBRSxFQUNaLFlBQVksRUFDWiwyQkFBMkIsRUFDM0I7WUFDRSxLQUFLO1lBQ0wsWUFBWSxFQUFFLGVBQWU7WUFDN0IsUUFBUSxFQUFFLGVBQWU7U0FDMUIsRUFDRCxLQUFLLENBQUMsV0FBVyxDQUNsQixDQUFDO1FBRUYsTUFBTSxPQUFPLEdBQVksQ0FBQyxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsVUFBVSxFQUFFLGFBQWEsQ0FBQyxhQUFhLEVBQUUsQ0FBQyxDQUFDO1FBQzNGLElBQUksYUFBYSxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQ2hDLE9BQU8sQ0FBQyxJQUFJLENBQUM7Z0JBQ1gsVUFBVSxFQUFFLE1BQU07Z0JBQ2xCLFVBQVUsRUFBRSxhQUFhLENBQUMsYUFBYTthQUN4QyxDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsZUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsRUFBRSw0QkFBNEIsQ0FBQyxDQUFDO1FBQ2hFLE9BQU8sRUFBRSxHQUFHLEtBQUssRUFBRSxjQUFjLEVBQUUsT0FBTyxFQUFFLENBQUM7SUFDL0MsQ0FBQztJQUFDLE9BQU8sR0FBWSxFQUFFLENBQUM7UUFDdEIsZUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsRUFBRSx3QkFBd0IsQ0FBQyxDQUFDO1FBQ3hELE1BQU0sSUFBSSw0QkFBbUIsQ0FBQyxrQ0FBa0MsRUFBRTtZQUNoRSxLQUFLLEVBQUUsR0FBRztTQUNYLENBQUMsQ0FBQztJQUNMLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgeiB9IGZyb20gJ3pvZCc7XG5cbmltcG9ydCB7IGdldFRleHRMTE0gfSBmcm9tICcuLi8uLi9saWIvYWknO1xuaW1wb3J0IHsgYWdlbnRFeGVjdXRvciB9IGZyb20gJy4uLy4uL2xpYi9haS9hZ2VudHMvZXhlY3V0b3InO1xuaW1wb3J0IHsgU3lzdGVtTWVzc2FnZSB9IGZyb20gJy4uLy4uL2xpYi9haS9jb3JlL21lc3NhZ2VzJztcbmltcG9ydCB7IEludGVybmFsU2VydmVyRXJyb3IgfSBmcm9tICcuLi8uLi91dGlscy9lcnJvcnMnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vLi4vdXRpbHMvbG9nZ2VyJztcbmltcG9ydCB7IGxvYWRQcm9tcHQgfSBmcm9tICcuLi8uLi91dGlscy9wcm9tcHRzJztcbmltcG9ydCB7IEdyYXBoU3RhdGUsIFJlcGxpZXMgfSBmcm9tICcuLi9zdGF0ZSc7XG5pbXBvcnQgeyBmZXRjaENvbG9yQW5hbHlzaXMsIHNlYXJjaFdhcmRyb2JlIH0gZnJvbSAnLi4vdG9vbHMnO1xuXG5jb25zdCBMTE1PdXRwdXRTY2hlbWEgPSB6Lm9iamVjdCh7XG4gIHN0eWxpbmdJbnRlbnQ6IHouZW51bShbJ29jY2FzaW9uJywgJ3ZhY2F0aW9uJywgJ3BhaXJpbmcnLCAnc3VnZ2VzdCddKSxcbiAgbWVzc2FnZTFfdGV4dDogei5zdHJpbmcoKSxcbiAgbWVzc2FnZTJfdGV4dDogei5zdHJpbmcoKS5udWxsYWJsZSgpLFxufSk7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYW5kbGVTdHlsaW5nKHN0YXRlOiBHcmFwaFN0YXRlKTogUHJvbWlzZTxHcmFwaFN0YXRlPiB7XG4gIGNvbnN0IHsgdXNlciwgc3R5bGluZ0ludGVudCwgY29udmVyc2F0aW9uSGlzdG9yeVRleHRPbmx5IH0gPSBzdGF0ZTtcbiAgY29uc3QgdXNlcklkID0gdXNlci5pZDtcbiAgY29uc3QgbGFzdE1lc3NhZ2UgPSBjb252ZXJzYXRpb25IaXN0b3J5VGV4dE9ubHkuYXQoLTEpO1xuXG4gIGlmICghc3R5bGluZ0ludGVudCkge1xuICAgIHRocm93IG5ldyBJbnRlcm5hbFNlcnZlckVycm9yKCdoYW5kbGVTdHlsaW5nTm9kZSBjYWxsZWQgd2l0aG91dCBhIHN0eWxpbmcgaW50ZW50LicpO1xuICB9XG5cbiAgdHJ5IHtcbiAgICBpZiAobGFzdE1lc3NhZ2U/Lm1ldGE/LmJ1dHRvblBheWxvYWQpIHtcbiAgICAgIGNvbnN0IGRlZmF1bHRQcm9tcHRUZXh0ID0gYXdhaXQgbG9hZFByb21wdCgnaGFuZGxlcnMvc3R5bGluZy9oYW5kbGVfc3R5bGluZ19ub19pbnB1dC50eHQnKTtcbiAgICAgIGNvbnN0IHN5c3RlbVByb21wdFRleHQgPSBkZWZhdWx0UHJvbXB0VGV4dC5yZXBsYWNlKCd7SU5URU5UfScsIHN0eWxpbmdJbnRlbnQpO1xuICAgICAgY29uc3Qgc3lzdGVtUHJvbXB0ID0gbmV3IFN5c3RlbU1lc3NhZ2Uoc3lzdGVtUHJvbXB0VGV4dCk7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGdldFRleHRMTE0oKVxuICAgICAgICAud2l0aFN0cnVjdHVyZWRPdXRwdXQoTExNT3V0cHV0U2NoZW1hKVxuICAgICAgICAucnVuKHN5c3RlbVByb21wdCwgY29udmVyc2F0aW9uSGlzdG9yeVRleHRPbmx5LCBzdGF0ZS50cmFjZUJ1ZmZlciwgJ2hhbmRsZVN0eWxpbmcnKTtcbiAgICAgIGNvbnN0IHJlcGx5X3RleHQgPSByZXNwb25zZS5tZXNzYWdlMV90ZXh0IGFzIHN0cmluZztcbiAgICAgIGxvZ2dlci5kZWJ1Zyh7IHVzZXJJZCwgcmVwbHlfdGV4dCB9LCAnUmV0dXJuaW5nIHdpdGggZGVmYXVsdCBMTE0gcmVwbHknKTtcbiAgICAgIGNvbnN0IHJlcGxpZXM6IFJlcGxpZXMgPSBbeyByZXBseV90eXBlOiAndGV4dCcsIHJlcGx5X3RleHQgfV07XG4gICAgICByZXR1cm4geyAuLi5zdGF0ZSwgYXNzaXN0YW50UmVwbHk6IHJlcGxpZXMgfTtcbiAgICB9XG5cbiAgICBjb25zdCB0b29scyA9IFtzZWFyY2hXYXJkcm9iZSh1c2VySWQpLCBmZXRjaENvbG9yQW5hbHlzaXModXNlcklkKV07XG5cbiAgICBjb25zdCBzeXN0ZW1Qcm9tcHRUZXh0ID0gYXdhaXQgbG9hZFByb21wdChgaGFuZGxlcnMvc3R5bGluZy9oYW5kbGVfJHtzdHlsaW5nSW50ZW50fS50eHRgKTtcbiAgICBjb25zdCBzeXN0ZW1Qcm9tcHQgPSBuZXcgU3lzdGVtTWVzc2FnZShzeXN0ZW1Qcm9tcHRUZXh0KTtcblxuICAgIGNvbnN0IGZpbmFsUmVzcG9uc2UgPSBhd2FpdCBhZ2VudEV4ZWN1dG9yKFxuICAgICAgZ2V0VGV4dExMTSgpLFxuICAgICAgc3lzdGVtUHJvbXB0LFxuICAgICAgY29udmVyc2F0aW9uSGlzdG9yeVRleHRPbmx5LFxuICAgICAge1xuICAgICAgICB0b29scyxcbiAgICAgICAgb3V0cHV0U2NoZW1hOiBMTE1PdXRwdXRTY2hlbWEsXG4gICAgICAgIG5vZGVOYW1lOiAnaGFuZGxlU3R5bGluZycsXG4gICAgICB9LFxuICAgICAgc3RhdGUudHJhY2VCdWZmZXIsXG4gICAgKTtcblxuICAgIGNvbnN0IHJlcGxpZXM6IFJlcGxpZXMgPSBbeyByZXBseV90eXBlOiAndGV4dCcsIHJlcGx5X3RleHQ6IGZpbmFsUmVzcG9uc2UubWVzc2FnZTFfdGV4dCB9XTtcbiAgICBpZiAoZmluYWxSZXNwb25zZS5tZXNzYWdlMl90ZXh0KSB7XG4gICAgICByZXBsaWVzLnB1c2goe1xuICAgICAgICByZXBseV90eXBlOiAndGV4dCcsXG4gICAgICAgIHJlcGx5X3RleHQ6IGZpbmFsUmVzcG9uc2UubWVzc2FnZTJfdGV4dCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGxvZ2dlci5kZWJ1Zyh7IHVzZXJJZCwgcmVwbGllcyB9LCAnUmV0dXJuaW5nIHN0eWxpbmcgcmVzcG9uc2UnKTtcbiAgICByZXR1cm4geyAuLi5zdGF0ZSwgYXNzaXN0YW50UmVwbHk6IHJlcGxpZXMgfTtcbiAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgbG9nZ2VyLmVycm9yKHsgdXNlcklkLCBlcnIgfSwgJ0Vycm9yIGluIGhhbmRsZVN0eWxpbmcnKTtcbiAgICB0aHJvdyBuZXcgSW50ZXJuYWxTZXJ2ZXJFcnJvcignRmFpbGVkIHRvIGhhbmRsZSBzdHlsaW5nIHJlcXVlc3QnLCB7XG4gICAgICBjYXVzZTogZXJyLFxuICAgIH0pO1xuICB9XG59XG4iXX0=