"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeStyling = routeStyling;
const zod_1 = require("zod");
const ai_1 = require("../../lib/ai");
const messages_1 = require("../../lib/ai/core/messages");
const logger_1 = require("../../utils/logger");
const prompts_1 = require("../../utils/prompts");
const errors_1 = require("../../utils/errors");
const LLMOutputSchema = zod_1.z.object({
    stylingIntent: zod_1.z
        .enum(['occasion', 'vacation', 'pairing', 'suggest'])
        .describe("The specific styling intent of the user's message, used to route to the appropriate styling handler."),
});
async function routeStyling(state) {
    const userId = state.user.id;
    const buttonPayload = (state.input.ButtonPayload ?? '').toLowerCase();
    logger_1.logger.debug({ userId, buttonPayload }, 'Entered routeStyling with button payload');
    try {
        if (buttonPayload === 'styling') {
            const stylingButtons = [
                { text: 'Occasion', id: 'occasion' },
                { text: 'Pairing', id: 'pairing' },
                { text: 'Vacation', id: 'vacation' },
            ];
            const replies = [
                {
                    reply_type: 'quick_reply',
                    reply_text: 'Please select which styling service you need',
                    buttons: stylingButtons,
                },
            ];
            logger_1.logger.debug({ userId }, 'Sending styling menu quick replies');
            return { ...state, assistantReply: replies };
        }
        if (buttonPayload && ['occasion', 'vacation', 'pairing', 'suggest'].includes(buttonPayload)) {
            logger_1.logger.debug({ userId, buttonPayload }, 'Styling intent determined from button payload');
            return { ...state, stylingIntent: buttonPayload };
        }
        const systemPromptText = await (0, prompts_1.loadPrompt)('routing/route_styling.txt');
        const systemPrompt = new messages_1.SystemMessage(systemPromptText);
        const response = await (0, ai_1.getTextLLM)()
            .withStructuredOutput(LLMOutputSchema)
            .run(systemPrompt, state.conversationHistoryTextOnly, state.traceBuffer, 'routeStyling');
        logger_1.logger.debug({ userId, stylingIntent: response.stylingIntent }, 'Styling intent determined from LLM');
        return { ...state, ...response };
    }
    catch (err) {
        logger_1.logger.error({ userId, err }, 'Error in routeStyling');
        throw new errors_1.InternalServerError('Failed to route styling intent', { cause: err });
    }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ub2Rlcy9yb3V0ZVN0eWxpbmcudHMiLCJzb3VyY2VzIjpbIi91c3Ivc3JjL2FwcC9zcmMvYWdlbnQvbm9kZXMvcm91dGVTdHlsaW5nLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBa0JBLG9DQWlEQztBQW5FRCw2QkFBd0I7QUFFeEIscUNBQTBDO0FBQzFDLHlEQUEyRDtBQUMzRCwrQ0FBNEM7QUFDNUMsaURBQWlEO0FBRWpELCtDQUF5RDtBQUd6RCxNQUFNLGVBQWUsR0FBRyxPQUFDLENBQUMsTUFBTSxDQUFDO0lBQy9CLGFBQWEsRUFBRSxPQUFDO1NBQ2IsSUFBSSxDQUFDLENBQUMsVUFBVSxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLENBQUM7U0FDcEQsUUFBUSxDQUNQLHNHQUFzRyxDQUN2RztDQUNKLENBQUMsQ0FBQztBQUVJLEtBQUssVUFBVSxZQUFZLENBQUMsS0FBaUI7SUFDbEQsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7SUFDN0IsTUFBTSxhQUFhLEdBQUcsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLGFBQWEsSUFBSSxFQUFFLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUV0RSxlQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsTUFBTSxFQUFFLGFBQWEsRUFBRSxFQUFFLDBDQUEwQyxDQUFDLENBQUM7SUFFcEYsSUFBSSxDQUFDO1FBQ0gsSUFBSSxhQUFhLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDaEMsTUFBTSxjQUFjLEdBQUc7Z0JBQ3JCLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxFQUFFLEVBQUUsVUFBVSxFQUFFO2dCQUNwQyxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRTtnQkFDbEMsRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLEVBQUUsRUFBRSxVQUFVLEVBQUU7YUFDckMsQ0FBQztZQUVGLE1BQU0sT0FBTyxHQUFZO2dCQUN2QjtvQkFDRSxVQUFVLEVBQUUsYUFBYTtvQkFDekIsVUFBVSxFQUFFLDhDQUE4QztvQkFDMUQsT0FBTyxFQUFFLGNBQWM7aUJBQ3hCO2FBQ0YsQ0FBQztZQUVGLGVBQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxNQUFNLEVBQUUsRUFBRSxvQ0FBb0MsQ0FBQyxDQUFDO1lBQy9ELE9BQU8sRUFBRSxHQUFHLEtBQUssRUFBRSxjQUFjLEVBQUUsT0FBTyxFQUFFLENBQUM7UUFDL0MsQ0FBQztRQUVELElBQUksYUFBYSxJQUFJLENBQUMsVUFBVSxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUM7WUFDNUYsZUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLE1BQU0sRUFBRSxhQUFhLEVBQUUsRUFBRSwrQ0FBK0MsQ0FBQyxDQUFDO1lBQ3pGLE9BQU8sRUFBRSxHQUFHLEtBQUssRUFBRSxhQUFhLEVBQUUsYUFBOEIsRUFBRSxDQUFDO1FBQ3JFLENBQUM7UUFHRCxNQUFNLGdCQUFnQixHQUFHLE1BQU0sSUFBQSxvQkFBVSxFQUFDLDJCQUEyQixDQUFDLENBQUM7UUFDdkUsTUFBTSxZQUFZLEdBQUcsSUFBSSx3QkFBYSxDQUFDLGdCQUFnQixDQUFDLENBQUM7UUFFekQsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFBLGVBQVUsR0FBRTthQUNoQyxvQkFBb0IsQ0FBQyxlQUFlLENBQUM7YUFDckMsR0FBRyxDQUFDLFlBQVksRUFBRSxLQUFLLENBQUMsMkJBQTJCLEVBQUUsS0FBSyxDQUFDLFdBQVcsRUFBRSxjQUFjLENBQUMsQ0FBQztRQUUzRixlQUFNLENBQUMsS0FBSyxDQUNWLEVBQUUsTUFBTSxFQUFFLGFBQWEsRUFBRSxRQUFRLENBQUMsYUFBYSxFQUFFLEVBQ2pELG9DQUFvQyxDQUNyQyxDQUFDO1FBRUYsT0FBTyxFQUFFLEdBQUcsS0FBSyxFQUFFLEdBQUcsUUFBUSxFQUFFLENBQUM7SUFDbkMsQ0FBQztJQUFDLE9BQU8sR0FBWSxFQUFFLENBQUM7UUFDdEIsZUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsRUFBRSx1QkFBdUIsQ0FBQyxDQUFDO1FBQ3ZELE1BQU0sSUFBSSw0QkFBbUIsQ0FBQyxnQ0FBZ0MsRUFBRSxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQ2xGLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgeiB9IGZyb20gJ3pvZCc7XG5cbmltcG9ydCB7IGdldFRleHRMTE0gfSBmcm9tICcuLi8uLi9saWIvYWknO1xuaW1wb3J0IHsgU3lzdGVtTWVzc2FnZSB9IGZyb20gJy4uLy4uL2xpYi9haS9jb3JlL21lc3NhZ2VzJztcbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uLy4uL3V0aWxzL2xvZ2dlcic7XG5pbXBvcnQgeyBsb2FkUHJvbXB0IH0gZnJvbSAnLi4vLi4vdXRpbHMvcHJvbXB0cyc7XG5cbmltcG9ydCB7IEludGVybmFsU2VydmVyRXJyb3IgfSBmcm9tICcuLi8uLi91dGlscy9lcnJvcnMnO1xuaW1wb3J0IHsgR3JhcGhTdGF0ZSwgUmVwbGllcywgU3R5bGluZ0ludGVudCB9IGZyb20gJy4uL3N0YXRlJztcblxuY29uc3QgTExNT3V0cHV0U2NoZW1hID0gei5vYmplY3Qoe1xuICBzdHlsaW5nSW50ZW50OiB6XG4gICAgLmVudW0oWydvY2Nhc2lvbicsICd2YWNhdGlvbicsICdwYWlyaW5nJywgJ3N1Z2dlc3QnXSlcbiAgICAuZGVzY3JpYmUoXG4gICAgICBcIlRoZSBzcGVjaWZpYyBzdHlsaW5nIGludGVudCBvZiB0aGUgdXNlcidzIG1lc3NhZ2UsIHVzZWQgdG8gcm91dGUgdG8gdGhlIGFwcHJvcHJpYXRlIHN0eWxpbmcgaGFuZGxlci5cIixcbiAgICApLFxufSk7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByb3V0ZVN0eWxpbmcoc3RhdGU6IEdyYXBoU3RhdGUpOiBQcm9taXNlPEdyYXBoU3RhdGU+IHtcbiAgY29uc3QgdXNlcklkID0gc3RhdGUudXNlci5pZDtcbiAgY29uc3QgYnV0dG9uUGF5bG9hZCA9IChzdGF0ZS5pbnB1dC5CdXR0b25QYXlsb2FkID8/ICcnKS50b0xvd2VyQ2FzZSgpO1xuXG4gIGxvZ2dlci5kZWJ1Zyh7IHVzZXJJZCwgYnV0dG9uUGF5bG9hZCB9LCAnRW50ZXJlZCByb3V0ZVN0eWxpbmcgd2l0aCBidXR0b24gcGF5bG9hZCcpO1xuXG4gIHRyeSB7XG4gICAgaWYgKGJ1dHRvblBheWxvYWQgPT09ICdzdHlsaW5nJykge1xuICAgICAgY29uc3Qgc3R5bGluZ0J1dHRvbnMgPSBbXG4gICAgICAgIHsgdGV4dDogJ09jY2FzaW9uJywgaWQ6ICdvY2Nhc2lvbicgfSxcbiAgICAgICAgeyB0ZXh0OiAnUGFpcmluZycsIGlkOiAncGFpcmluZycgfSxcbiAgICAgICAgeyB0ZXh0OiAnVmFjYXRpb24nLCBpZDogJ3ZhY2F0aW9uJyB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgcmVwbGllczogUmVwbGllcyA9IFtcbiAgICAgICAge1xuICAgICAgICAgIHJlcGx5X3R5cGU6ICdxdWlja19yZXBseScsXG4gICAgICAgICAgcmVwbHlfdGV4dDogJ1BsZWFzZSBzZWxlY3Qgd2hpY2ggc3R5bGluZyBzZXJ2aWNlIHlvdSBuZWVkJyxcbiAgICAgICAgICBidXR0b25zOiBzdHlsaW5nQnV0dG9ucyxcbiAgICAgICAgfSxcbiAgICAgIF07XG5cbiAgICAgIGxvZ2dlci5kZWJ1Zyh7IHVzZXJJZCB9LCAnU2VuZGluZyBzdHlsaW5nIG1lbnUgcXVpY2sgcmVwbGllcycpO1xuICAgICAgcmV0dXJuIHsgLi4uc3RhdGUsIGFzc2lzdGFudFJlcGx5OiByZXBsaWVzIH07XG4gICAgfVxuXG4gICAgaWYgKGJ1dHRvblBheWxvYWQgJiYgWydvY2Nhc2lvbicsICd2YWNhdGlvbicsICdwYWlyaW5nJywgJ3N1Z2dlc3QnXS5pbmNsdWRlcyhidXR0b25QYXlsb2FkKSkge1xuICAgICAgbG9nZ2VyLmRlYnVnKHsgdXNlcklkLCBidXR0b25QYXlsb2FkIH0sICdTdHlsaW5nIGludGVudCBkZXRlcm1pbmVkIGZyb20gYnV0dG9uIHBheWxvYWQnKTtcbiAgICAgIHJldHVybiB7IC4uLnN0YXRlLCBzdHlsaW5nSW50ZW50OiBidXR0b25QYXlsb2FkIGFzIFN0eWxpbmdJbnRlbnQgfTtcbiAgICB9XG5cbiAgICAvLyBGYWxsYmFjayB0byBMTE0gZm9yIHJvdXRpbmcgaWYgbm8gYnV0dG9uIHBheWxvYWQgbWF0Y2hlc1xuICAgIGNvbnN0IHN5c3RlbVByb21wdFRleHQgPSBhd2FpdCBsb2FkUHJvbXB0KCdyb3V0aW5nL3JvdXRlX3N0eWxpbmcudHh0Jyk7XG4gICAgY29uc3Qgc3lzdGVtUHJvbXB0ID0gbmV3IFN5c3RlbU1lc3NhZ2Uoc3lzdGVtUHJvbXB0VGV4dCk7XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGdldFRleHRMTE0oKVxuICAgICAgLndpdGhTdHJ1Y3R1cmVkT3V0cHV0KExMTU91dHB1dFNjaGVtYSlcbiAgICAgIC5ydW4oc3lzdGVtUHJvbXB0LCBzdGF0ZS5jb252ZXJzYXRpb25IaXN0b3J5VGV4dE9ubHksIHN0YXRlLnRyYWNlQnVmZmVyLCAncm91dGVTdHlsaW5nJyk7XG5cbiAgICBsb2dnZXIuZGVidWcoXG4gICAgICB7IHVzZXJJZCwgc3R5bGluZ0ludGVudDogcmVzcG9uc2Uuc3R5bGluZ0ludGVudCB9LFxuICAgICAgJ1N0eWxpbmcgaW50ZW50IGRldGVybWluZWQgZnJvbSBMTE0nLFxuICAgICk7XG5cbiAgICByZXR1cm4geyAuLi5zdGF0ZSwgLi4ucmVzcG9uc2UgfTtcbiAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgbG9nZ2VyLmVycm9yKHsgdXNlcklkLCBlcnIgfSwgJ0Vycm9yIGluIHJvdXRlU3R5bGluZycpO1xuICAgIHRocm93IG5ldyBJbnRlcm5hbFNlcnZlckVycm9yKCdGYWlsZWQgdG8gcm91dGUgc3R5bGluZyBpbnRlbnQnLCB7IGNhdXNlOiBlcnIgfSk7XG4gIH1cbn1cbiJdfQ==