"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStyleStudio = handleStyleStudio;
const zod_1 = require("zod");
const logger_1 = require("../../utils/logger");
const ai_1 = require("../../lib/ai");
const messages_1 = require("../../lib/ai/core/messages");
const prompts_1 = require("../../utils/prompts");
const client_1 = require("@prisma/client");
const errors_1 = require("../../utils/errors");
const styleStudioMenuButtons = [
    { text: 'Style for any occasion', id: 'style_studio_occasion' },
    { text: 'Vacation looks', id: 'style_studio_vacation' },
    { text: 'General styling', id: 'style_studio_general' },
];
const StyleStudioOutputSchema = zod_1.z.object({
    reply_text: zod_1.z.string().describe('Detailed outfit advice including specific suggestions.'),
});
async function handleStyleStudio(state) {
    logger_1.logger.debug({
        userId: state.user.id,
        intent: state.intent,
        pending: state.pending,
        buttonPayload: state.input.ButtonPayload,
        lastHandledPayload: state.lastHandledPayload,
    }, 'Entering handleStyleStudio node');
    const payload = state.input.ButtonPayload;
    if (state.pending !== client_1.PendingType.STYLE_STUDIO_MENU) {
        const replies = [
            {
                reply_type: 'quick_reply',
                reply_text: 'Welcome to Style Studio! Choose a styling service:',
                buttons: styleStudioMenuButtons,
            },
        ];
        return {
            ...state,
            assistantReply: replies,
            pending: client_1.PendingType.STYLE_STUDIO_MENU,
            lastHandledPayload: null,
        };
    }
    if (payload && payload === state.lastHandledPayload) {
        return { ...state, assistantReply: [] };
    }
    const subservicePromptMap = {
        style_studio_occasion: 'handlers/style_studio/occasion.txt',
        style_studio_vacation: 'handlers/style_studio/vacation.txt',
        style_studio_general: 'handlers/style_studio/general_styling.txt',
    };
    if (payload && subservicePromptMap[payload]) {
        try {
            const promptText = await (0, prompts_1.loadPrompt)(subservicePromptMap[payload]);
            const systemMessage = new messages_1.SystemMessage(promptText);
            const result = await (0, ai_1.getTextLLM)()
                .withStructuredOutput(StyleStudioOutputSchema)
                .run(systemMessage, state.conversationHistoryTextOnly, state.traceBuffer, 'handleStyleStudio');
            const replies = [
                {
                    reply_type: 'text',
                    reply_text: result.reply_text,
                },
            ];
            return {
                ...state,
                assistantReply: replies,
                pending: client_1.PendingType.NONE,
                lastHandledPayload: payload,
            };
        }
        catch (err) {
            throw new errors_1.InternalServerError('Style Studio failed to generate a response', { cause: err });
        }
    }
    const replies = [
        {
            reply_type: 'text',
            reply_text: 'Please select a valid Style Studio option from the menu below.',
        },
        {
            reply_type: 'quick_reply',
            reply_text: 'Choose a styling service:',
            buttons: styleStudioMenuButtons,
        },
    ];
    return {
        ...state,
        assistantReply: replies,
        pending: client_1.PendingType.STYLE_STUDIO_MENU,
        lastHandledPayload: null,
    };
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ub2Rlcy9oYW5kbGVTdHlsZVN0dWRpby50cyIsInNvdXJjZXMiOlsiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ub2Rlcy9oYW5kbGVTdHlsZVN0dWRpby50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQXFCQSw4Q0E4RkM7QUFuSEQsNkJBQXdCO0FBQ3hCLCtDQUE0QztBQUU1QyxxQ0FBMEM7QUFDMUMseURBQTJEO0FBQzNELGlEQUFpRDtBQUVqRCwyQ0FBNkM7QUFDN0MsK0NBQXlEO0FBR3pELE1BQU0sc0JBQXNCLEdBQUc7SUFDN0IsRUFBRSxJQUFJLEVBQUUsd0JBQXdCLEVBQUUsRUFBRSxFQUFFLHVCQUF1QixFQUFFO0lBQy9ELEVBQUUsSUFBSSxFQUFFLGdCQUFnQixFQUFFLEVBQUUsRUFBRSx1QkFBdUIsRUFBRTtJQUN2RCxFQUFFLElBQUksRUFBRSxpQkFBaUIsRUFBRSxFQUFFLEVBQUUsc0JBQXNCLEVBQUU7Q0FDeEQsQ0FBQztBQUVGLE1BQU0sdUJBQXVCLEdBQUcsT0FBQyxDQUFDLE1BQU0sQ0FBQztJQUN2QyxVQUFVLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLFFBQVEsQ0FBQyx3REFBd0QsQ0FBQztDQUMxRixDQUFDLENBQUM7QUFFSSxLQUFLLFVBQVUsaUJBQWlCLENBQUMsS0FBaUI7SUFDdkQsZUFBTSxDQUFDLEtBQUssQ0FDVjtRQUNFLE1BQU0sRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUU7UUFDckIsTUFBTSxFQUFFLEtBQUssQ0FBQyxNQUFNO1FBQ3BCLE9BQU8sRUFBRSxLQUFLLENBQUMsT0FBTztRQUN0QixhQUFhLEVBQUUsS0FBSyxDQUFDLEtBQUssQ0FBQyxhQUFhO1FBQ3hDLGtCQUFrQixFQUFFLEtBQUssQ0FBQyxrQkFBa0I7S0FDN0MsRUFDRCxpQ0FBaUMsQ0FDbEMsQ0FBQztJQUVGLE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDO0lBRzFDLElBQUksS0FBSyxDQUFDLE9BQU8sS0FBSyxvQkFBVyxDQUFDLGlCQUFpQixFQUFFLENBQUM7UUFDcEQsTUFBTSxPQUFPLEdBQVk7WUFDdkI7Z0JBQ0UsVUFBVSxFQUFFLGFBQWE7Z0JBQ3pCLFVBQVUsRUFBRSxvREFBb0Q7Z0JBQ2hFLE9BQU8sRUFBRSxzQkFBc0I7YUFDaEM7U0FDRixDQUFDO1FBQ0YsT0FBTztZQUNMLEdBQUcsS0FBSztZQUNSLGNBQWMsRUFBRSxPQUFPO1lBQ3ZCLE9BQU8sRUFBRSxvQkFBVyxDQUFDLGlCQUFpQjtZQUN0QyxrQkFBa0IsRUFBRSxJQUFJO1NBQ3pCLENBQUM7SUFDSixDQUFDO0lBR0QsSUFBSSxPQUFPLElBQUksT0FBTyxLQUFLLEtBQUssQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO1FBQ3BELE9BQU8sRUFBRSxHQUFHLEtBQUssRUFBRSxjQUFjLEVBQUUsRUFBRSxFQUFFLENBQUM7SUFDMUMsQ0FBQztJQUdELE1BQU0sbUJBQW1CLEdBQTJCO1FBQ2xELHFCQUFxQixFQUFFLG9DQUFvQztRQUMzRCxxQkFBcUIsRUFBRSxvQ0FBb0M7UUFDM0Qsb0JBQW9CLEVBQUUsMkNBQTJDO0tBQ2xFLENBQUM7SUFFRixJQUFJLE9BQU8sSUFBSSxtQkFBbUIsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQzVDLElBQUksQ0FBQztZQUNILE1BQU0sVUFBVSxHQUFHLE1BQU0sSUFBQSxvQkFBVSxFQUFDLG1CQUFtQixDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDbEUsTUFBTSxhQUFhLEdBQUcsSUFBSSx3QkFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1lBQ3BELE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBQSxlQUFVLEdBQUU7aUJBQzlCLG9CQUFvQixDQUFDLHVCQUF1QixDQUFDO2lCQUM3QyxHQUFHLENBQ0YsYUFBYSxFQUNiLEtBQUssQ0FBQywyQkFBMkIsRUFDakMsS0FBSyxDQUFDLFdBQVcsRUFDakIsbUJBQW1CLENBQ3BCLENBQUM7WUFFSixNQUFNLE9BQU8sR0FBWTtnQkFDdkI7b0JBQ0UsVUFBVSxFQUFFLE1BQU07b0JBQ2xCLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVTtpQkFDOUI7YUFDRixDQUFDO1lBR0YsT0FBTztnQkFDTCxHQUFHLEtBQUs7Z0JBQ1IsY0FBYyxFQUFFLE9BQU87Z0JBQ3ZCLE9BQU8sRUFBRSxvQkFBVyxDQUFDLElBQUk7Z0JBQ3pCLGtCQUFrQixFQUFFLE9BQU87YUFDNUIsQ0FBQztRQUNKLENBQUM7UUFBQyxPQUFPLEdBQVksRUFBRSxDQUFDO1lBQ3RCLE1BQU0sSUFBSSw0QkFBbUIsQ0FBQyw0Q0FBNEMsRUFBRSxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBQzlGLENBQUM7SUFDSCxDQUFDO0lBR0QsTUFBTSxPQUFPLEdBQVk7UUFDdkI7WUFDRSxVQUFVLEVBQUUsTUFBTTtZQUNsQixVQUFVLEVBQUUsZ0VBQWdFO1NBQzdFO1FBQ0Q7WUFDRSxVQUFVLEVBQUUsYUFBYTtZQUN6QixVQUFVLEVBQUUsMkJBQTJCO1lBQ3ZDLE9BQU8sRUFBRSxzQkFBc0I7U0FDaEM7S0FDRixDQUFDO0lBRUYsT0FBTztRQUNMLEdBQUcsS0FBSztRQUNSLGNBQWMsRUFBRSxPQUFPO1FBQ3ZCLE9BQU8sRUFBRSxvQkFBVyxDQUFDLGlCQUFpQjtRQUN0QyxrQkFBa0IsRUFBRSxJQUFJO0tBQ3pCLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgeiB9IGZyb20gJ3pvZCc7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi8uLi91dGlscy9sb2dnZXInO1xuXG5pbXBvcnQgeyBnZXRUZXh0TExNIH0gZnJvbSAnLi4vLi4vbGliL2FpJztcbmltcG9ydCB7IFN5c3RlbU1lc3NhZ2UgfSBmcm9tICcuLi8uLi9saWIvYWkvY29yZS9tZXNzYWdlcyc7XG5pbXBvcnQgeyBsb2FkUHJvbXB0IH0gZnJvbSAnLi4vLi4vdXRpbHMvcHJvbXB0cyc7XG5cbmltcG9ydCB7IFBlbmRpbmdUeXBlIH0gZnJvbSAnQHByaXNtYS9jbGllbnQnO1xuaW1wb3J0IHsgSW50ZXJuYWxTZXJ2ZXJFcnJvciB9IGZyb20gJy4uLy4uL3V0aWxzL2Vycm9ycyc7XG5pbXBvcnQgeyBHcmFwaFN0YXRlLCBSZXBsaWVzIH0gZnJvbSAnLi4vc3RhdGUnO1xuXG5jb25zdCBzdHlsZVN0dWRpb01lbnVCdXR0b25zID0gW1xuICB7IHRleHQ6ICdTdHlsZSBmb3IgYW55IG9jY2FzaW9uJywgaWQ6ICdzdHlsZV9zdHVkaW9fb2NjYXNpb24nIH0sXG4gIHsgdGV4dDogJ1ZhY2F0aW9uIGxvb2tzJywgaWQ6ICdzdHlsZV9zdHVkaW9fdmFjYXRpb24nIH0sXG4gIHsgdGV4dDogJ0dlbmVyYWwgc3R5bGluZycsIGlkOiAnc3R5bGVfc3R1ZGlvX2dlbmVyYWwnIH0sXG5dO1xuXG5jb25zdCBTdHlsZVN0dWRpb091dHB1dFNjaGVtYSA9IHoub2JqZWN0KHtcbiAgcmVwbHlfdGV4dDogei5zdHJpbmcoKS5kZXNjcmliZSgnRGV0YWlsZWQgb3V0Zml0IGFkdmljZSBpbmNsdWRpbmcgc3BlY2lmaWMgc3VnZ2VzdGlvbnMuJyksXG59KTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhhbmRsZVN0eWxlU3R1ZGlvKHN0YXRlOiBHcmFwaFN0YXRlKTogUHJvbWlzZTxHcmFwaFN0YXRlPiB7XG4gIGxvZ2dlci5kZWJ1ZyhcbiAgICB7XG4gICAgICB1c2VySWQ6IHN0YXRlLnVzZXIuaWQsXG4gICAgICBpbnRlbnQ6IHN0YXRlLmludGVudCxcbiAgICAgIHBlbmRpbmc6IHN0YXRlLnBlbmRpbmcsXG4gICAgICBidXR0b25QYXlsb2FkOiBzdGF0ZS5pbnB1dC5CdXR0b25QYXlsb2FkLFxuICAgICAgbGFzdEhhbmRsZWRQYXlsb2FkOiBzdGF0ZS5sYXN0SGFuZGxlZFBheWxvYWQsXG4gICAgfSxcbiAgICAnRW50ZXJpbmcgaGFuZGxlU3R5bGVTdHVkaW8gbm9kZScsXG4gICk7XG5cbiAgY29uc3QgcGF5bG9hZCA9IHN0YXRlLmlucHV0LkJ1dHRvblBheWxvYWQ7XG5cbiAgLy8gU3RlcCAxOiBJZiBub3QgaW4gc3R5bGUgc3R1ZGlvIG1lbnUgcGVuZGluZyBzdGF0ZSwgc2VuZCB0aGUgbWVudSBhbmQgc2V0IHBlbmRpbmdcbiAgaWYgKHN0YXRlLnBlbmRpbmcgIT09IFBlbmRpbmdUeXBlLlNUWUxFX1NUVURJT19NRU5VKSB7XG4gICAgY29uc3QgcmVwbGllczogUmVwbGllcyA9IFtcbiAgICAgIHtcbiAgICAgICAgcmVwbHlfdHlwZTogJ3F1aWNrX3JlcGx5JyxcbiAgICAgICAgcmVwbHlfdGV4dDogJ1dlbGNvbWUgdG8gU3R5bGUgU3R1ZGlvISBDaG9vc2UgYSBzdHlsaW5nIHNlcnZpY2U6JyxcbiAgICAgICAgYnV0dG9uczogc3R5bGVTdHVkaW9NZW51QnV0dG9ucyxcbiAgICAgIH0sXG4gICAgXTtcbiAgICByZXR1cm4ge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBhc3Npc3RhbnRSZXBseTogcmVwbGllcyxcbiAgICAgIHBlbmRpbmc6IFBlbmRpbmdUeXBlLlNUWUxFX1NUVURJT19NRU5VLFxuICAgICAgbGFzdEhhbmRsZWRQYXlsb2FkOiBudWxsLFxuICAgIH07XG4gIH1cblxuICAvLyBTdGVwIDI6IFByZXZlbnQgcmVwZWF0ZWQgcmVwbHkgZm9yIHNhbWUgYnV0dG9uIHBheWxvYWRcbiAgaWYgKHBheWxvYWQgJiYgcGF5bG9hZCA9PT0gc3RhdGUubGFzdEhhbmRsZWRQYXlsb2FkKSB7XG4gICAgcmV0dXJuIHsgLi4uc3RhdGUsIGFzc2lzdGFudFJlcGx5OiBbXSB9O1xuICB9XG5cbiAgLy8gU3RlcCAzOiBIYW5kbGUgc3VibWVudSBiYXNlZCBvbiBwYXlsb2FkXG4gIGNvbnN0IHN1YnNlcnZpY2VQcm9tcHRNYXA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgc3R5bGVfc3R1ZGlvX29jY2FzaW9uOiAnaGFuZGxlcnMvc3R5bGVfc3R1ZGlvL29jY2FzaW9uLnR4dCcsXG4gICAgc3R5bGVfc3R1ZGlvX3ZhY2F0aW9uOiAnaGFuZGxlcnMvc3R5bGVfc3R1ZGlvL3ZhY2F0aW9uLnR4dCcsXG4gICAgc3R5bGVfc3R1ZGlvX2dlbmVyYWw6ICdoYW5kbGVycy9zdHlsZV9zdHVkaW8vZ2VuZXJhbF9zdHlsaW5nLnR4dCcsXG4gIH07XG5cbiAgaWYgKHBheWxvYWQgJiYgc3Vic2VydmljZVByb21wdE1hcFtwYXlsb2FkXSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwcm9tcHRUZXh0ID0gYXdhaXQgbG9hZFByb21wdChzdWJzZXJ2aWNlUHJvbXB0TWFwW3BheWxvYWRdKTtcbiAgICAgIGNvbnN0IHN5c3RlbU1lc3NhZ2UgPSBuZXcgU3lzdGVtTWVzc2FnZShwcm9tcHRUZXh0KTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGdldFRleHRMTE0oKVxuICAgICAgICAud2l0aFN0cnVjdHVyZWRPdXRwdXQoU3R5bGVTdHVkaW9PdXRwdXRTY2hlbWEpXG4gICAgICAgIC5ydW4oXG4gICAgICAgICAgc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgICBzdGF0ZS5jb252ZXJzYXRpb25IaXN0b3J5VGV4dE9ubHksXG4gICAgICAgICAgc3RhdGUudHJhY2VCdWZmZXIsXG4gICAgICAgICAgJ2hhbmRsZVN0eWxlU3R1ZGlvJyxcbiAgICAgICAgKTtcblxuICAgICAgY29uc3QgcmVwbGllczogUmVwbGllcyA9IFtcbiAgICAgICAge1xuICAgICAgICAgIHJlcGx5X3R5cGU6ICd0ZXh0JyxcbiAgICAgICAgICByZXBseV90ZXh0OiByZXN1bHQucmVwbHlfdGV4dCxcbiAgICAgICAgfSxcbiAgICAgIF07XG5cbiAgICAgIC8vIENsZWFyIHBlbmRpbmcgYWZ0ZXIgcmV1c2UgdG8gYXZvaWQgcmVwZWF0ZWQgbWVudXMsIG9yIGtlZXAgaWYgeW91IHdhbnQgbWVudSBwZXJzaXN0ZW50XG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgYXNzaXN0YW50UmVwbHk6IHJlcGxpZXMsXG4gICAgICAgIHBlbmRpbmc6IFBlbmRpbmdUeXBlLk5PTkUsIC8vIDwtLSBSZXNldCBwZW5kaW5nIGhlcmUgYWZ0ZXIgaGFuZGxpbmcgc2VsZWN0aW9uXG4gICAgICAgIGxhc3RIYW5kbGVkUGF5bG9hZDogcGF5bG9hZCxcbiAgICAgIH07XG4gICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICB0aHJvdyBuZXcgSW50ZXJuYWxTZXJ2ZXJFcnJvcignU3R5bGUgU3R1ZGlvIGZhaWxlZCB0byBnZW5lcmF0ZSBhIHJlc3BvbnNlJywgeyBjYXVzZTogZXJyIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIFN0ZXAgNDogSGFuZGxlIGludmFsaWQgcGF5bG9hZCBieSByZXBlYXRpbmcgbWVudSBwcm9tcHRcbiAgY29uc3QgcmVwbGllczogUmVwbGllcyA9IFtcbiAgICB7XG4gICAgICByZXBseV90eXBlOiAndGV4dCcsXG4gICAgICByZXBseV90ZXh0OiAnUGxlYXNlIHNlbGVjdCBhIHZhbGlkIFN0eWxlIFN0dWRpbyBvcHRpb24gZnJvbSB0aGUgbWVudSBiZWxvdy4nLFxuICAgIH0sXG4gICAge1xuICAgICAgcmVwbHlfdHlwZTogJ3F1aWNrX3JlcGx5JyxcbiAgICAgIHJlcGx5X3RleHQ6ICdDaG9vc2UgYSBzdHlsaW5nIHNlcnZpY2U6JyxcbiAgICAgIGJ1dHRvbnM6IHN0eWxlU3R1ZGlvTWVudUJ1dHRvbnMsXG4gICAgfSxcbiAgXTtcblxuICByZXR1cm4ge1xuICAgIC4uLnN0YXRlLFxuICAgIGFzc2lzdGFudFJlcGx5OiByZXBsaWVzLFxuICAgIHBlbmRpbmc6IFBlbmRpbmdUeXBlLlNUWUxFX1NUVURJT19NRU5VLFxuICAgIGxhc3RIYW5kbGVkUGF5bG9hZDogbnVsbCxcbiAgfTtcbn1cbiJdfQ==