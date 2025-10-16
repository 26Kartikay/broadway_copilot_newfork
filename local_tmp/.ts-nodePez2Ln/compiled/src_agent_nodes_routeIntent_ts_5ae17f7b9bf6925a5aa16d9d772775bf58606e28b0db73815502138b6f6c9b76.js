"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeIntent = routeIntent;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const ai_1 = require("../../lib/ai");
const messages_1 = require("../../lib/ai/core/messages");
const context_1 = require("../../utils/context");
const errors_1 = require("../../utils/errors");
const logger_1 = require("../../utils/logger");
const prompts_1 = require("../../utils/prompts");
const handleStyleStudio_1 = require("./handleStyleStudio");
const validTonalities = ['friendly', 'savage', 'hype_bff'];
const stylingRelated = [
    'style_studio',
    'style_studio_occasion',
    'style_studio_vacation',
    'style_studio_pairing',
    'style_studio_general',
];
const otherValid = ['general', 'vibe_check', 'color_analysis', 'suggest'];
const LLMOutputSchema = zod_1.z.object({
    intent: zod_1.z
        .enum(['general', 'vibe_check', 'color_analysis', 'style_studio'])
        .describe("The primary intent of the user's message, used to route to the appropriate handler."),
    missingProfileField: zod_1.z
        .enum(['gender', 'age_group'])
        .nullable()
        .describe("The profile field that is missing and required to fulfill the user's intent. Null if no field is missing."),
});
async function routeIntent(state) {
    logger_1.logger.debug({
        buttonPayload: state.input.ButtonPayload,
        pending: state.pending,
        selectedTonality: state.selectedTonality,
        userId: state.user.id,
    }, 'Routing intent with current state');
    const { user, input, conversationHistoryWithImages, pending } = state;
    const userId = user.id;
    const buttonPayload = input.ButtonPayload;
    if (buttonPayload) {
        let intent = 'general';
        if (stylingRelated.includes(buttonPayload)) {
            intent = 'style_studio';
            if (state.pending === client_1.PendingType.NONE && !stylingRelated.includes(buttonPayload)) {
                intent = 'general';
            }
        }
        else if (otherValid.includes(buttonPayload)) {
            intent = buttonPayload;
            if (intent === 'vibe_check') {
                logger_1.logger.debug({
                    selectedTonality: state.selectedTonality,
                    pending: state.pending,
                    buttonPayload,
                }, 'Received vibe_check buttonPayload - resetting selectedTonality and pending');
                return {
                    ...state,
                    intent: 'vibe_check',
                    pending: client_1.PendingType.TONALITY_SELECTION,
                    selectedTonality: null,
                    missingProfileField: null,
                };
            }
        }
        else if (validTonalities.includes(buttonPayload.toLowerCase())) {
            return {
                ...state,
                intent: 'vibe_check',
                selectedTonality: buttonPayload.toLowerCase(),
                pending: client_1.PendingType.VIBE_CHECK_IMAGE,
                missingProfileField: null,
            };
        }
        return { ...state, intent, missingProfileField: null };
    }
    else {
        if (pending === client_1.PendingType.TONALITY_SELECTION) {
            const userMessage = input.Body?.toLowerCase().trim() ?? '';
            if (validTonalities.includes(userMessage)) {
                return {
                    ...state,
                    selectedTonality: userMessage,
                    pending: client_1.PendingType.VIBE_CHECK_IMAGE,
                    intent: 'vibe_check',
                    missingProfileField: null,
                };
            }
            else {
                return {
                    ...state,
                    assistantReply: [
                        {
                            reply_type: 'text',
                            reply_text: `Invalid tonality selection. Please choose one of: Friendly, Savage, Hype BFF`,
                        },
                    ],
                    pending: client_1.PendingType.TONALITY_SELECTION,
                };
            }
        }
        const imageCount = (0, context_1.numImagesInMessage)(conversationHistoryWithImages);
        if (imageCount > 0) {
            if (pending === client_1.PendingType.VIBE_CHECK_IMAGE) {
                logger_1.logger.debug({ userId }, 'Routing to vibe_check due to pending intent and image presence');
                return { ...state, intent: 'vibe_check', missingProfileField: null };
            }
            else if (pending === client_1.PendingType.COLOR_ANALYSIS_IMAGE) {
                logger_1.logger.debug({ userId }, 'Routing to color_analysis due to pending intent and image presence');
                return { ...state, intent: 'color_analysis', missingProfileField: null };
            }
        }
        const now = Date.now();
        const lastVibeCheckAt = user.lastVibeCheckAt?.getTime() ?? null;
        const vibeMinutesAgo = lastVibeCheckAt ? Math.floor((now - lastVibeCheckAt) / (1000 * 60)) : -1;
        const canDoVibeCheck = vibeMinutesAgo === -1 || vibeMinutesAgo >= 30;
        const lastColorAnalysisAt = user.lastColorAnalysisAt?.getTime() ?? null;
        const colorMinutesAgo = lastColorAnalysisAt
            ? Math.floor((now - lastColorAnalysisAt) / (1000 * 60))
            : -1;
        const canDoColorAnalysis = colorMinutesAgo === -1 || colorMinutesAgo >= 30;
        try {
            const systemPromptText = await (0, prompts_1.loadPrompt)('routing/route_intent.txt');
            const formattedSystemPrompt = systemPromptText
                .replace('{can_do_vibe_check}', canDoVibeCheck.toString())
                .replace('{can_do_color_analysis}', canDoColorAnalysis.toString());
            const systemPrompt = new messages_1.SystemMessage(formattedSystemPrompt);
            const response = await (0, ai_1.getTextLLM)()
                .withStructuredOutput(LLMOutputSchema)
                .run(systemPrompt, state.conversationHistoryTextOnly, state.traceBuffer, 'routeIntent');
            let { intent, missingProfileField } = response;
            if (missingProfileField) {
                logger_1.logger.debug({ userId, missingProfileField }, 'Checking if missingProfileField can be cleared based on user profile');
                if (missingProfileField === 'gender' && (user.inferredGender || user.confirmedGender)) {
                    logger_1.logger.debug({ userId }, 'Clearing missingProfileField gender because user already has it.');
                    missingProfileField = null;
                }
                else if (missingProfileField === 'age_group' &&
                    (user.inferredAgeGroup || user.confirmedAgeGroup)) {
                    logger_1.logger.debug({ userId }, 'Clearing missingProfileField age_group because user already has it.');
                    missingProfileField = null;
                }
            }
            if (intent === 'vibe_check' && state.pending === client_1.PendingType.TONALITY_SELECTION) {
                state.generalIntent = 'tonality';
                logger_1.logger.debug({ userId, intent, pending: state.pending, generalIntent: state.generalIntent }, 'Set generalIntent to tonality for vibe_check with TONALITY_SELECTION');
            }
            if (intent === 'style_studio') {
                return (0, handleStyleStudio_1.handleStyleStudio)(state);
            }
            return { ...state, intent, missingProfileField, generalIntent: state.generalIntent };
        }
        catch (err) {
            throw new errors_1.InternalServerError('Failed to route intent', { cause: err });
        }
    }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ub2Rlcy9yb3V0ZUludGVudC50cyIsInNvdXJjZXMiOlsiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ub2Rlcy9yb3V0ZUludGVudC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQXlDQSxrQ0F5S0M7QUFsTkQsNkJBQXdCO0FBRXhCLDJDQUE2QztBQUU3QyxxQ0FBMEM7QUFDMUMseURBQTJEO0FBQzNELGlEQUF5RDtBQUN6RCwrQ0FBeUQ7QUFDekQsK0NBQTRDO0FBQzVDLGlEQUFpRDtBQUdqRCwyREFBd0Q7QUFHeEQsTUFBTSxlQUFlLEdBQWEsQ0FBQyxVQUFVLEVBQUUsUUFBUSxFQUFFLFVBQVUsQ0FBQyxDQUFDO0FBQ3JFLE1BQU0sY0FBYyxHQUFhO0lBQy9CLGNBQWM7SUFDZCx1QkFBdUI7SUFDdkIsdUJBQXVCO0lBQ3ZCLHNCQUFzQjtJQUN0QixzQkFBc0I7Q0FDdkIsQ0FBQztBQUVGLE1BQU0sVUFBVSxHQUFhLENBQUMsU0FBUyxFQUFFLFlBQVksRUFBRSxnQkFBZ0IsRUFBRSxTQUFTLENBQUMsQ0FBQztBQUdwRixNQUFNLGVBQWUsR0FBRyxPQUFDLENBQUMsTUFBTSxDQUFDO0lBQy9CLE1BQU0sRUFBRSxPQUFDO1NBQ04sSUFBSSxDQUFDLENBQUMsU0FBUyxFQUFFLFlBQVksRUFBRSxnQkFBZ0IsRUFBRSxjQUFjLENBQUMsQ0FBQztTQUNqRSxRQUFRLENBQ1AscUZBQXFGLENBQ3RGO0lBQ0gsbUJBQW1CLEVBQUUsT0FBQztTQUNuQixJQUFJLENBQUMsQ0FBQyxRQUFRLEVBQUUsV0FBVyxDQUFDLENBQUM7U0FDN0IsUUFBUSxFQUFFO1NBQ1YsUUFBUSxDQUNQLDJHQUEyRyxDQUM1RztDQUNKLENBQUMsQ0FBQztBQUVJLEtBQUssVUFBVSxXQUFXLENBQUMsS0FBaUI7SUFDakQsZUFBTSxDQUFDLEtBQUssQ0FDVjtRQUNFLGFBQWEsRUFBRSxLQUFLLENBQUMsS0FBSyxDQUFDLGFBQWE7UUFDeEMsT0FBTyxF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SCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgeiB9IGZyb20gJ3pvZCc7XG5cbmltcG9ydCB7IFBlbmRpbmdUeXBlIH0gZnJvbSAnQHByaXNtYS9jbGllbnQnO1xuXG5pbXBvcnQgeyBnZXRUZXh0TExNIH0gZnJvbSAnLi4vLi4vbGliL2FpJztcbmltcG9ydCB7IFN5c3RlbU1lc3NhZ2UgfSBmcm9tICcuLi8uLi9saWIvYWkvY29yZS9tZXNzYWdlcyc7XG5pbXBvcnQgeyBudW1JbWFnZXNJbk1lc3NhZ2UgfSBmcm9tICcuLi8uLi91dGlscy9jb250ZXh0JztcbmltcG9ydCB7IEludGVybmFsU2VydmVyRXJyb3IgfSBmcm9tICcuLi8uLi91dGlscy9lcnJvcnMnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vLi4vdXRpbHMvbG9nZ2VyJztcbmltcG9ydCB7IGxvYWRQcm9tcHQgfSBmcm9tICcuLi8uLi91dGlscy9wcm9tcHRzJztcbmltcG9ydCB7IEdyYXBoU3RhdGUsIEludGVudExhYmVsIH0gZnJvbSAnLi4vc3RhdGUnO1xuXG5pbXBvcnQgeyBoYW5kbGVTdHlsZVN0dWRpbyB9IGZyb20gJy4vaGFuZGxlU3R5bGVTdHVkaW8nO1xuXG4vLyAtLS0gU2hhcmVkIGNvbnN0YW50cyBzZWN0aW9uIC0tLVxuY29uc3QgdmFsaWRUb25hbGl0aWVzOiBzdHJpbmdbXSA9IFsnZnJpZW5kbHknLCAnc2F2YWdlJywgJ2h5cGVfYmZmJ107XG5jb25zdCBzdHlsaW5nUmVsYXRlZDogc3RyaW5nW10gPSBbXG4gICdzdHlsZV9zdHVkaW8nLFxuICAnc3R5bGVfc3R1ZGlvX29jY2FzaW9uJyxcbiAgJ3N0eWxlX3N0dWRpb192YWNhdGlvbicsXG4gICdzdHlsZV9zdHVkaW9fcGFpcmluZycsXG4gICdzdHlsZV9zdHVkaW9fZ2VuZXJhbCcsXG5dO1xuXG5jb25zdCBvdGhlclZhbGlkOiBzdHJpbmdbXSA9IFsnZ2VuZXJhbCcsICd2aWJlX2NoZWNrJywgJ2NvbG9yX2FuYWx5c2lzJywgJ3N1Z2dlc3QnXTtcblxuLy8gLS0tIExMTSBPdXRwdXQgU2NoZW1hIC0tLVxuY29uc3QgTExNT3V0cHV0U2NoZW1hID0gei5vYmplY3Qoe1xuICBpbnRlbnQ6IHpcbiAgICAuZW51bShbJ2dlbmVyYWwnLCAndmliZV9jaGVjaycsICdjb2xvcl9hbmFseXNpcycsICdzdHlsZV9zdHVkaW8nXSlcbiAgICAuZGVzY3JpYmUoXG4gICAgICBcIlRoZSBwcmltYXJ5IGludGVudCBvZiB0aGUgdXNlcidzIG1lc3NhZ2UsIHVzZWQgdG8gcm91dGUgdG8gdGhlIGFwcHJvcHJpYXRlIGhhbmRsZXIuXCIsXG4gICAgKSxcbiAgbWlzc2luZ1Byb2ZpbGVGaWVsZDogelxuICAgIC5lbnVtKFsnZ2VuZGVyJywgJ2FnZV9ncm91cCddKVxuICAgIC5udWxsYWJsZSgpXG4gICAgLmRlc2NyaWJlKFxuICAgICAgXCJUaGUgcHJvZmlsZSBmaWVsZCB0aGF0IGlzIG1pc3NpbmcgYW5kIHJlcXVpcmVkIHRvIGZ1bGZpbGwgdGhlIHVzZXIncyBpbnRlbnQuIE51bGwgaWYgbm8gZmllbGQgaXMgbWlzc2luZy5cIixcbiAgICApLFxufSk7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByb3V0ZUludGVudChzdGF0ZTogR3JhcGhTdGF0ZSk6IFByb21pc2U8R3JhcGhTdGF0ZT4ge1xuICBsb2dnZXIuZGVidWcoXG4gICAge1xuICAgICAgYnV0dG9uUGF5bG9hZDogc3RhdGUuaW5wdXQuQnV0dG9uUGF5bG9hZCxcbiAgICAgIHBlbmRpbmc6IHN0YXRlLnBlbmRpbmcsXG4gICAgICBzZWxlY3RlZFRvbmFsaXR5OiBzdGF0ZS5zZWxlY3RlZFRvbmFsaXR5LFxuICAgICAgdXNlcklkOiBzdGF0ZS51c2VyLmlkLFxuICAgIH0sXG4gICAgJ1JvdXRpbmcgaW50ZW50IHdpdGggY3VycmVudCBzdGF0ZScsXG4gICk7XG5cbiAgY29uc3QgeyB1c2VyLCBpbnB1dCwgY29udmVyc2F0aW9uSGlzdG9yeVdpdGhJbWFnZXMsIHBlbmRpbmcgfSA9IHN0YXRlO1xuICBjb25zdCB1c2VySWQgPSB1c2VyLmlkO1xuICBjb25zdCBidXR0b25QYXlsb2FkID0gaW5wdXQuQnV0dG9uUGF5bG9hZDtcblxuICAvLyBQcmlvcml0eSAxOiBIYW5kbGUgZXhwbGljaXQgYnV0dG9uIHBheWxvYWQgcm91dGluZ1xuICBpZiAoYnV0dG9uUGF5bG9hZCkge1xuICAgIGxldCBpbnRlbnQ6IEludGVudExhYmVsID0gJ2dlbmVyYWwnO1xuXG4gICAgaWYgKHN0eWxpbmdSZWxhdGVkLmluY2x1ZGVzKGJ1dHRvblBheWxvYWQpKSB7XG4gICAgICBpbnRlbnQgPSAnc3R5bGVfc3R1ZGlvJztcbiAgICAgIGlmIChzdGF0ZS5wZW5kaW5nID09PSBQZW5kaW5nVHlwZS5OT05FICYmICFzdHlsaW5nUmVsYXRlZC5pbmNsdWRlcyhidXR0b25QYXlsb2FkKSkge1xuICAgICAgICBpbnRlbnQgPSAnZ2VuZXJhbCc7IC8vIE5ldXRyYWwgaW50ZW50IHRvIHByZXZlbnQgYXV0byBtZW51IGxvb3BzXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChvdGhlclZhbGlkLmluY2x1ZGVzKGJ1dHRvblBheWxvYWQpKSB7XG4gICAgICBpbnRlbnQgPSBidXR0b25QYXlsb2FkIGFzIEludGVudExhYmVsO1xuICAgICAgaWYgKGludGVudCA9PT0gJ3ZpYmVfY2hlY2snKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzZWxlY3RlZFRvbmFsaXR5OiBzdGF0ZS5zZWxlY3RlZFRvbmFsaXR5LFxuICAgICAgICAgICAgcGVuZGluZzogc3RhdGUucGVuZGluZyxcbiAgICAgICAgICAgIGJ1dHRvblBheWxvYWQsXG4gICAgICAgICAgfSxcbiAgICAgICAgICAnUmVjZWl2ZWQgdmliZV9jaGVjayBidXR0b25QYXlsb2FkIC0gcmVzZXR0aW5nIHNlbGVjdGVkVG9uYWxpdHkgYW5kIHBlbmRpbmcnLFxuICAgICAgICApO1xuICAgICAgICAvLyBGb3JjZSBmcmVzaCB0b25hbGl0eSBzZWxlY3Rpb24hXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgaW50ZW50OiAndmliZV9jaGVjaycsXG4gICAgICAgICAgcGVuZGluZzogUGVuZGluZ1R5cGUuVE9OQUxJVFlfU0VMRUNUSU9OLFxuICAgICAgICAgIHNlbGVjdGVkVG9uYWxpdHk6IG51bGwsXG4gICAgICAgICAgbWlzc2luZ1Byb2ZpbGVGaWVsZDogbnVsbCxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHZhbGlkVG9uYWxpdGllcy5pbmNsdWRlcyhidXR0b25QYXlsb2FkLnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgaW50ZW50OiAndmliZV9jaGVjaycsXG4gICAgICAgIHNlbGVjdGVkVG9uYWxpdHk6IGJ1dHRvblBheWxvYWQudG9Mb3dlckNhc2UoKSxcbiAgICAgICAgcGVuZGluZzogUGVuZGluZ1R5cGUuVklCRV9DSEVDS19JTUFHRSxcbiAgICAgICAgbWlzc2luZ1Byb2ZpbGVGaWVsZDogbnVsbCxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gUmV0dXJuIGVhcmx5IGhlcmUgc28gdGhhdCBMTE0gcm91dGluZyBpcyBza2lwcGVkIHdoZW4gYnV0dG9uUGF5bG9hZCBpcyBoYW5kbGVkXG4gICAgcmV0dXJuIHsgLi4uc3RhdGUsIGludGVudCwgbWlzc2luZ1Byb2ZpbGVGaWVsZDogbnVsbCB9O1xuICB9IGVsc2Uge1xuICAgIC8vIFByaW9yaXR5IDI6IEhhbmRsZSBwZW5kaW5nIHRvbmFsaXR5IHNlbGVjdGlvblxuICAgIGlmIChwZW5kaW5nID09PSBQZW5kaW5nVHlwZS5UT05BTElUWV9TRUxFQ1RJT04pIHtcbiAgICAgIGNvbnN0IHVzZXJNZXNzYWdlID0gaW5wdXQuQm9keT8udG9Mb3dlckNhc2UoKS50cmltKCkgPz8gJyc7XG5cbiAgICAgIGlmICh2YWxpZFRvbmFsaXRpZXMuaW5jbHVkZXModXNlck1lc3NhZ2UpKSB7XG4gICAgICAgIC8vIFVzZXIgc2VsZWN0ZWQgYSB2YWxpZCB0b25hbGl0eSwgdXBkYXRlIHN0YXRlIGFuZCBtb3ZlIHRvIGltYWdlIHVwbG9hZCBwZW5kaW5nXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgc2VsZWN0ZWRUb25hbGl0eTogdXNlck1lc3NhZ2UsXG4gICAgICAgICAgcGVuZGluZzogUGVuZGluZ1R5cGUuVklCRV9DSEVDS19JTUFHRSxcbiAgICAgICAgICBpbnRlbnQ6ICd2aWJlX2NoZWNrJyxcbiAgICAgICAgICBtaXNzaW5nUHJvZmlsZUZpZWxkOiBudWxsLFxuICAgICAgICB9O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVXNlciBpbnB1dCBpbnZhbGlkIHRvbmFsaXR5IC0gcHJvbXB0IGFnYWluIG9yIGZhbGxiYWNrXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgYXNzaXN0YW50UmVwbHk6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgcmVwbHlfdHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgICByZXBseV90ZXh0OiBgSW52YWxpZCB0b25hbGl0eSBzZWxlY3Rpb24uIFBsZWFzZSBjaG9vc2Ugb25lIG9mOiBGcmllbmRseSwgU2F2YWdlLCBIeXBlIEJGRmAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcGVuZGluZzogUGVuZGluZ1R5cGUuVE9OQUxJVFlfU0VMRUNUSU9OLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDM6IEhhbmRsZSBwZW5kaW5nIGltYWdlLWJhc2VkIGludGVudHNcbiAgICBjb25zdCBpbWFnZUNvdW50ID0gbnVtSW1hZ2VzSW5NZXNzYWdlKGNvbnZlcnNhdGlvbkhpc3RvcnlXaXRoSW1hZ2VzKTtcbiAgICBpZiAoaW1hZ2VDb3VudCA+IDApIHtcbiAgICAgIGlmIChwZW5kaW5nID09PSBQZW5kaW5nVHlwZS5WSUJFX0NIRUNLX0lNQUdFKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1Zyh7IHVzZXJJZCB9LCAnUm91dGluZyB0byB2aWJlX2NoZWNrIGR1ZSB0byBwZW5kaW5nIGludGVudCBhbmQgaW1hZ2UgcHJlc2VuY2UnKTtcbiAgICAgICAgcmV0dXJuIHsgLi4uc3RhdGUsIGludGVudDogJ3ZpYmVfY2hlY2snLCBtaXNzaW5nUHJvZmlsZUZpZWxkOiBudWxsIH07XG4gICAgICB9IGVsc2UgaWYgKHBlbmRpbmcgPT09IFBlbmRpbmdUeXBlLkNPTE9SX0FOQUxZU0lTX0lNQUdFKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhcbiAgICAgICAgICB7IHVzZXJJZCB9LFxuICAgICAgICAgICdSb3V0aW5nIHRvIGNvbG9yX2FuYWx5c2lzIGR1ZSB0byBwZW5kaW5nIGludGVudCBhbmQgaW1hZ2UgcHJlc2VuY2UnLFxuICAgICAgICApO1xuICAgICAgICByZXR1cm4geyAuLi5zdGF0ZSwgaW50ZW50OiAnY29sb3JfYW5hbHlzaXMnLCBtaXNzaW5nUHJvZmlsZUZpZWxkOiBudWxsIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQ2FsY3VsYXRlIGNvb2xkb3duIHBlcmlvZHMgZm9yIHByZW1pdW0gc2VydmljZXMgKDMwLW1pbiBjb29sZG93bilcbiAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IGxhc3RWaWJlQ2hlY2tBdCA9IHVzZXIubGFzdFZpYmVDaGVja0F0Py5nZXRUaW1lKCkgPz8gbnVsbDtcbiAgICBjb25zdCB2aWJlTWludXRlc0FnbyA9IGxhc3RWaWJlQ2hlY2tBdCA/IE1hdGguZmxvb3IoKG5vdyAtIGxhc3RWaWJlQ2hlY2tBdCkgLyAoMTAwMCAqIDYwKSkgOiAtMTtcbiAgICBjb25zdCBjYW5Eb1ZpYmVDaGVjayA9IHZpYmVNaW51dGVzQWdvID09PSAtMSB8fCB2aWJlTWludXRlc0FnbyA+PSAzMDtcblxuICAgIGNvbnN0IGxhc3RDb2xvckFuYWx5c2lzQXQgPSB1c2VyLmxhc3RDb2xvckFuYWx5c2lzQXQ/LmdldFRpbWUoKSA/PyBudWxsO1xuICAgIGNvbnN0IGNvbG9yTWludXRlc0FnbyA9IGxhc3RDb2xvckFuYWx5c2lzQXRcbiAgICAgID8gTWF0aC5mbG9vcigobm93IC0gbGFzdENvbG9yQW5hbHlzaXNBdCkgLyAoMTAwMCAqIDYwKSlcbiAgICAgIDogLTE7XG4gICAgY29uc3QgY2FuRG9Db2xvckFuYWx5c2lzID0gY29sb3JNaW51dGVzQWdvID09PSAtMSB8fCBjb2xvck1pbnV0ZXNBZ28gPj0gMzA7XG5cbiAgICAvLyBQcmlvcml0eSA0OiBVc2UgTExNIGZvciBpbnRlbGxpZ2VudCBpbnRlbnQgY2xhc3NpZmljYXRpb25cbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3lzdGVtUHJvbXB0VGV4dCA9IGF3YWl0IGxvYWRQcm9tcHQoJ3JvdXRpbmcvcm91dGVfaW50ZW50LnR4dCcpO1xuICAgICAgY29uc3QgZm9ybWF0dGVkU3lzdGVtUHJvbXB0ID0gc3lzdGVtUHJvbXB0VGV4dFxuICAgICAgICAucmVwbGFjZSgne2Nhbl9kb192aWJlX2NoZWNrfScsIGNhbkRvVmliZUNoZWNrLnRvU3RyaW5nKCkpXG4gICAgICAgIC5yZXBsYWNlKCd7Y2FuX2RvX2NvbG9yX2FuYWx5c2lzfScsIGNhbkRvQ29sb3JBbmFseXNpcy50b1N0cmluZygpKTtcblxuICAgICAgY29uc3Qgc3lzdGVtUHJvbXB0ID0gbmV3IFN5c3RlbU1lc3NhZ2UoZm9ybWF0dGVkU3lzdGVtUHJvbXB0KTtcblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBnZXRUZXh0TExNKClcbiAgICAgICAgLndpdGhTdHJ1Y3R1cmVkT3V0cHV0KExMTU91dHB1dFNjaGVtYSlcbiAgICAgICAgLnJ1bihzeXN0ZW1Qcm9tcHQsIHN0YXRlLmNvbnZlcnNhdGlvbkhpc3RvcnlUZXh0T25seSwgc3RhdGUudHJhY2VCdWZmZXIsICdyb3V0ZUludGVudCcpO1xuXG4gICAgICBsZXQgeyBpbnRlbnQsIG1pc3NpbmdQcm9maWxlRmllbGQgfSA9IHJlc3BvbnNlO1xuXG4gICAgICBpZiAobWlzc2luZ1Byb2ZpbGVGaWVsZCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoXG4gICAgICAgICAgeyB1c2VySWQsIG1pc3NpbmdQcm9maWxlRmllbGQgfSxcbiAgICAgICAgICAnQ2hlY2tpbmcgaWYgbWlzc2luZ1Byb2ZpbGVGaWVsZCBjYW4gYmUgY2xlYXJlZCBiYXNlZCBvbiB1c2VyIHByb2ZpbGUnLFxuICAgICAgICApO1xuXG4gICAgICAgIGlmIChtaXNzaW5nUHJvZmlsZUZpZWxkID09PSAnZ2VuZGVyJyAmJiAodXNlci5pbmZlcnJlZEdlbmRlciB8fCB1c2VyLmNvbmZpcm1lZEdlbmRlcikpIHtcbiAgICAgICAgICBsb2dnZXIuZGVidWcoXG4gICAgICAgICAgICB7IHVzZXJJZCB9LFxuICAgICAgICAgICAgJ0NsZWFyaW5nIG1pc3NpbmdQcm9maWxlRmllbGQgZ2VuZGVyIGJlY2F1c2UgdXNlciBhbHJlYWR5IGhhcyBpdC4nLFxuICAgICAgICAgICk7XG4gICAgICAgICAgbWlzc2luZ1Byb2ZpbGVGaWVsZCA9IG51bGw7XG4gICAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgICAgbWlzc2luZ1Byb2ZpbGVGaWVsZCA9PT0gJ2FnZV9ncm91cCcgJiZcbiAgICAgICAgICAodXNlci5pbmZlcnJlZEFnZUdyb3VwIHx8IHVzZXIuY29uZmlybWVkQWdlR3JvdXApXG4gICAgICAgICkge1xuICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhcbiAgICAgICAgICAgIHsgdXNlcklkIH0sXG4gICAgICAgICAgICAnQ2xlYXJpbmcgbWlzc2luZ1Byb2ZpbGVGaWVsZCBhZ2VfZ3JvdXAgYmVjYXVzZSB1c2VyIGFscmVhZHkgaGFzIGl0LicsXG4gICAgICAgICAgKTtcbiAgICAgICAgICBtaXNzaW5nUHJvZmlsZUZpZWxkID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoaW50ZW50ID09PSAndmliZV9jaGVjaycgJiYgc3RhdGUucGVuZGluZyA9PT0gUGVuZGluZ1R5cGUuVE9OQUxJVFlfU0VMRUNUSU9OKSB7XG4gICAgICAgIHN0YXRlLmdlbmVyYWxJbnRlbnQgPSAndG9uYWxpdHknO1xuICAgICAgICBsb2dnZXIuZGVidWcoXG4gICAgICAgICAgeyB1c2VySWQsIGludGVudCwgcGVuZGluZzogc3RhdGUucGVuZGluZywgZ2VuZXJhbEludGVudDogc3RhdGUuZ2VuZXJhbEludGVudCB9LFxuICAgICAgICAgICdTZXQgZ2VuZXJhbEludGVudCB0byB0b25hbGl0eSBmb3IgdmliZV9jaGVjayB3aXRoIFRPTkFMSVRZX1NFTEVDVElPTicsXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIC8vIE5ldyBpbnRlZ3JhdGlvbiBwb2ludDogcm91dGUgdG8gU3R5bGUgU3R1ZGlvIGhhbmRsZXIgd2hlbiBpbnRlbnQgaXMgc3R5bGVfc3R1ZGlvXG4gICAgICBpZiAoaW50ZW50ID09PSAnc3R5bGVfc3R1ZGlvJykge1xuICAgICAgICByZXR1cm4gaGFuZGxlU3R5bGVTdHVkaW8oc3RhdGUpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4geyAuLi5zdGF0ZSwgaW50ZW50LCBtaXNzaW5nUHJvZmlsZUZpZWxkLCBnZW5lcmFsSW50ZW50OiBzdGF0ZS5nZW5lcmFsSW50ZW50IH07XG4gICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICB0aHJvdyBuZXcgSW50ZXJuYWxTZXJ2ZXJFcnJvcignRmFpbGVkIHRvIHJvdXRlIGludGVudCcsIHsgY2F1c2U6IGVyciB9KTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==