"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleFeedback = handleFeedback;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const ai_1 = require("../../lib/ai");
const prisma_1 = require("../../lib/prisma");
const tasks_1 = require("../../lib/tasks");
const logger_1 = require("../../utils/logger");
const prompts_1 = require("../../utils/prompts");
const FEEDBACK_ACK_FALLBACK = "Thanks so much for sharing—I'm really glad I can keep making your styling chats better!";
const FEEDBACK_NOT_SAVED = "Ah, I missed that one. Mind sharing your feedback again? I'd really appreciate it!";
const LLMOutputSchema = zod_1.z.object({
    helpful: zod_1.z
        .boolean()
        .nullable()
        .describe('Whether the user found the conversation helpful. Null if it is not stated or unclear.'),
    comment: zod_1.z
        .string()
        .nullable()
        .describe('A concise summary of any comments shared by the user about their experience.'),
    acknowledgement: zod_1.z
        .string()
        .min(1)
        .describe('A short, friendly acknowledgement message to send back to the user.'),
});
async function handleFeedback(state) {
    const { conversationId, conversationHistoryTextOnly, user } = state;
    const systemPromptText = await (0, prompts_1.loadPrompt)('data/record_feedback.txt');
    const systemPrompt = new ai_1.SystemMessage(systemPromptText);
    const trimmedHistory = conversationHistoryTextOnly.slice(-3);
    const { helpful, comment, acknowledgement } = await (0, ai_1.getTextLLM)()
        .withStructuredOutput(LLMOutputSchema)
        .run(systemPrompt, trimmedHistory, state.traceBuffer, 'handleFeedback');
    let replies = [{ reply_type: 'text', reply_text: FEEDBACK_NOT_SAVED }];
    const sanitizedComment = comment?.trim() ? comment.trim() : null;
    const acknowledgementText = acknowledgement?.trim() ? acknowledgement.trim() : null;
    if (helpful !== null || sanitizedComment) {
        await prisma_1.prisma.$transaction(async (tx) => {
            await tx.feedback.upsert({
                where: { conversationId },
                update: {
                    helpful,
                    comment: sanitizedComment,
                },
                create: {
                    conversationId,
                    helpful,
                    comment: sanitizedComment,
                },
            });
            await tx.conversation.update({
                where: { id: conversationId },
                data: { status: client_1.ConversationStatus.CLOSED },
            });
        });
        (0, tasks_1.queueMemoryExtraction)(user.id, conversationId);
        replies = [
            {
                reply_type: 'text',
                reply_text: acknowledgementText ?? FEEDBACK_ACK_FALLBACK,
            },
        ];
        logger_1.logger.info({ userId: user.id, conversationId, helpful, hasComment: Boolean(sanitizedComment) }, 'Stored user feedback');
    }
    return {
        ...state,
        assistantReply: replies,
        pending: client_1.PendingType.NONE,
    };
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ub2Rlcy9oYW5kbGVGZWVkYmFjay50cyIsInNvdXJjZXMiOlsiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ub2Rlcy9oYW5kbGVGZWVkYmFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQWdDQSx3Q0F3REM7QUF4RkQsNkJBQXdCO0FBRXhCLDJDQUFpRTtBQUNqRSxxQ0FBeUQ7QUFDekQsNkNBQTBDO0FBQzFDLDJDQUF3RDtBQUN4RCwrQ0FBNEM7QUFDNUMsaURBQWlEO0FBR2pELE1BQU0scUJBQXFCLEdBQ3pCLHlGQUF5RixDQUFDO0FBQzVGLE1BQU0sa0JBQWtCLEdBQ3RCLG9GQUFvRixDQUFDO0FBRXZGLE1BQU0sZUFBZSxHQUFHLE9BQUMsQ0FBQyxNQUFNLENBQUM7SUFDL0IsT0FBTyxFQUFFLE9BQUM7U0FDUCxPQUFPLEVBQUU7U0FDVCxRQUFRLEVBQUU7U0FDVixRQUFRLENBQ1AsdUZBQXVGLENBQ3hGO0lBQ0gsT0FBTyxFQUFFLE9BQUM7U0FDUCxNQUFNLEVBQUU7U0FDUixRQUFRLEVBQUU7U0FDVixRQUFRLENBQUMsOEVBQThFLENBQUM7SUFDM0YsZUFBZSxFQUFFLE9BQUM7U0FDZixNQUFNLEVBQUU7U0FDUixHQUFHLENBQUMsQ0FBQyxDQUFDO1NBQ04sUUFBUSxDQUFDLHFFQUFxRSxDQUFDO0NBQ25GLENBQUMsQ0FBQztBQUVJLEtBQUssVUFBVSxjQUFjLENBQUMsS0FBaUI7SUFDcEQsTUFBTSxFQUFFLGNBQWMsRUFBRSwyQkFBMkIsRUFBRSxJQUFJLEVBQUUsR0FBRyxLQUFLLENBQUM7SUFDcEUsTUFBTSxnQkFBZ0IsR0FBRyxNQUFNLElBQUEsb0JBQVUsRUFBQywwQkFBMEIsQ0FBQyxDQUFDO0lBQ3RFLE1BQU0sWUFBWSxHQUFHLElBQUksa0JBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO0lBRXpELE1BQU0sY0FBYyxHQUFHLDJCQUEyQixDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRTdELE1BQU0sRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLGVBQWUsRUFBRSxHQUFHLE1BQU0sSUFBQSxlQUFVLEdBQUU7U0FDN0Qsb0JBQW9CLENBQUMsZUFBZSxDQUFDO1NBQ3JDLEdBQUcsQ0FBQyxZQUFZLEVBQUUsY0FBYyxFQUFFLEtBQUssQ0FBQyxXQUFXLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztJQUUxRSxJQUFJLE9BQU8sR0FBWSxDQUFDLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSxVQUFVLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDO0lBQ2hGLE1BQU0sZ0JBQWdCLEdBQUcsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQztJQUNqRSxNQUFNLG1CQUFtQixHQUFHLGVBQWUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7SUFFcEYsSUFBSSxPQUFPLEtBQUssSUFBSSxJQUFJLGdCQUFnQixFQUFFLENBQUM7UUFDekMsTUFBTSxlQUFNLENBQUMsWUFBWSxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtZQUNyQyxNQUFNLEVBQUUsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDO2dCQUN2QixLQUFLLEVBQUUsRUFBRSxjQUFjLEVBQUU7Z0JBQ3pCLE1BQU0sRUFBRTtvQkFDTixPQUFPO29CQUNQLE9BQU8sRUFBRSxnQkFBZ0I7aUJBQzFCO2dCQUNELE1BQU0sRUFBRTtvQkFDTixjQUFjO29CQUNkLE9BQU87b0JBQ1AsT0FBTyxFQUFFLGdCQUFnQjtpQkFDMUI7YUFDRixDQUFDLENBQUM7WUFFSCxNQUFNLEVBQUUsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDO2dCQUMzQixLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUUsY0FBYyxFQUFFO2dCQUM3QixJQUFJLEVBQUUsRUFBRSxNQUFNLEVBQUUsMkJBQWtCLENBQUMsTUFBTSxFQUFFO2FBQzVDLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSw2QkFBcUIsRUFBQyxJQUFJLENBQUMsRUFBRSxFQUFFLGNBQWMsQ0FBQyxDQUFDO1FBRS9DLE9BQU8sR0FBRztZQUNSO2dCQUNFLFVBQVUsRUFBRSxNQUFNO2dCQUNsQixVQUFVLEVBQUUsbUJBQW1CLElBQUkscUJBQXFCO2FBQ3pEO1NBQ0YsQ0FBQztRQUVGLGVBQU0sQ0FBQyxJQUFJLENBQ1QsRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxjQUFjLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxFQUNuRixzQkFBc0IsQ0FDdkIsQ0FBQztJQUNKLENBQUM7SUFFRCxPQUFPO1FBQ0wsR0FBRyxLQUFLO1FBQ1IsY0FBYyxFQUFFLE9BQU87UUFDdkIsT0FBTyxFQUFFLG9CQUFXLENBQUMsSUFBSTtLQUMxQixDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHogfSBmcm9tICd6b2QnO1xuXG5pbXBvcnQgeyBDb252ZXJzYXRpb25TdGF0dXMsIFBlbmRpbmdUeXBlIH0gZnJvbSAnQHByaXNtYS9jbGllbnQnO1xuaW1wb3J0IHsgZ2V0VGV4dExMTSwgU3lzdGVtTWVzc2FnZSB9IGZyb20gJy4uLy4uL2xpYi9haSc7XG5pbXBvcnQgeyBwcmlzbWEgfSBmcm9tICcuLi8uLi9saWIvcHJpc21hJztcbmltcG9ydCB7IHF1ZXVlTWVtb3J5RXh0cmFjdGlvbiB9IGZyb20gJy4uLy4uL2xpYi90YXNrcyc7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi8uLi91dGlscy9sb2dnZXInO1xuaW1wb3J0IHsgbG9hZFByb21wdCB9IGZyb20gJy4uLy4uL3V0aWxzL3Byb21wdHMnO1xuaW1wb3J0IHsgR3JhcGhTdGF0ZSwgUmVwbGllcyB9IGZyb20gJy4uL3N0YXRlJztcblxuY29uc3QgRkVFREJBQ0tfQUNLX0ZBTExCQUNLID1cbiAgXCJUaGFua3Mgc28gbXVjaCBmb3Igc2hhcmluZ+KAlEknbSByZWFsbHkgZ2xhZCBJIGNhbiBrZWVwIG1ha2luZyB5b3VyIHN0eWxpbmcgY2hhdHMgYmV0dGVyIVwiO1xuY29uc3QgRkVFREJBQ0tfTk9UX1NBVkVEID1cbiAgXCJBaCwgSSBtaXNzZWQgdGhhdCBvbmUuIE1pbmQgc2hhcmluZyB5b3VyIGZlZWRiYWNrIGFnYWluPyBJJ2QgcmVhbGx5IGFwcHJlY2lhdGUgaXQhXCI7XG5cbmNvbnN0IExMTU91dHB1dFNjaGVtYSA9IHoub2JqZWN0KHtcbiAgaGVscGZ1bDogelxuICAgIC5ib29sZWFuKClcbiAgICAubnVsbGFibGUoKVxuICAgIC5kZXNjcmliZShcbiAgICAgICdXaGV0aGVyIHRoZSB1c2VyIGZvdW5kIHRoZSBjb252ZXJzYXRpb24gaGVscGZ1bC4gTnVsbCBpZiBpdCBpcyBub3Qgc3RhdGVkIG9yIHVuY2xlYXIuJyxcbiAgICApLFxuICBjb21tZW50OiB6XG4gICAgLnN0cmluZygpXG4gICAgLm51bGxhYmxlKClcbiAgICAuZGVzY3JpYmUoJ0EgY29uY2lzZSBzdW1tYXJ5IG9mIGFueSBjb21tZW50cyBzaGFyZWQgYnkgdGhlIHVzZXIgYWJvdXQgdGhlaXIgZXhwZXJpZW5jZS4nKSxcbiAgYWNrbm93bGVkZ2VtZW50OiB6XG4gICAgLnN0cmluZygpXG4gICAgLm1pbigxKVxuICAgIC5kZXNjcmliZSgnQSBzaG9ydCwgZnJpZW5kbHkgYWNrbm93bGVkZ2VtZW50IG1lc3NhZ2UgdG8gc2VuZCBiYWNrIHRvIHRoZSB1c2VyLicpLFxufSk7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYW5kbGVGZWVkYmFjayhzdGF0ZTogR3JhcGhTdGF0ZSk6IFByb21pc2U8R3JhcGhTdGF0ZT4ge1xuICBjb25zdCB7IGNvbnZlcnNhdGlvbklkLCBjb252ZXJzYXRpb25IaXN0b3J5VGV4dE9ubHksIHVzZXIgfSA9IHN0YXRlO1xuICBjb25zdCBzeXN0ZW1Qcm9tcHRUZXh0ID0gYXdhaXQgbG9hZFByb21wdCgnZGF0YS9yZWNvcmRfZmVlZGJhY2sudHh0Jyk7XG4gIGNvbnN0IHN5c3RlbVByb21wdCA9IG5ldyBTeXN0ZW1NZXNzYWdlKHN5c3RlbVByb21wdFRleHQpO1xuXG4gIGNvbnN0IHRyaW1tZWRIaXN0b3J5ID0gY29udmVyc2F0aW9uSGlzdG9yeVRleHRPbmx5LnNsaWNlKC0zKTtcblxuICBjb25zdCB7IGhlbHBmdWwsIGNvbW1lbnQsIGFja25vd2xlZGdlbWVudCB9ID0gYXdhaXQgZ2V0VGV4dExMTSgpXG4gICAgLndpdGhTdHJ1Y3R1cmVkT3V0cHV0KExMTU91dHB1dFNjaGVtYSlcbiAgICAucnVuKHN5c3RlbVByb21wdCwgdHJpbW1lZEhpc3RvcnksIHN0YXRlLnRyYWNlQnVmZmVyLCAnaGFuZGxlRmVlZGJhY2snKTtcblxuICBsZXQgcmVwbGllczogUmVwbGllcyA9IFt7IHJlcGx5X3R5cGU6ICd0ZXh0JywgcmVwbHlfdGV4dDogRkVFREJBQ0tfTk9UX1NBVkVEIH1dO1xuICBjb25zdCBzYW5pdGl6ZWRDb21tZW50ID0gY29tbWVudD8udHJpbSgpID8gY29tbWVudC50cmltKCkgOiBudWxsO1xuICBjb25zdCBhY2tub3dsZWRnZW1lbnRUZXh0ID0gYWNrbm93bGVkZ2VtZW50Py50cmltKCkgPyBhY2tub3dsZWRnZW1lbnQudHJpbSgpIDogbnVsbDtcblxuICBpZiAoaGVscGZ1bCAhPT0gbnVsbCB8fCBzYW5pdGl6ZWRDb21tZW50KSB7XG4gICAgYXdhaXQgcHJpc21hLiR0cmFuc2FjdGlvbihhc3luYyAodHgpID0+IHtcbiAgICAgIGF3YWl0IHR4LmZlZWRiYWNrLnVwc2VydCh7XG4gICAgICAgIHdoZXJlOiB7IGNvbnZlcnNhdGlvbklkIH0sXG4gICAgICAgIHVwZGF0ZToge1xuICAgICAgICAgIGhlbHBmdWwsXG4gICAgICAgICAgY29tbWVudDogc2FuaXRpemVkQ29tbWVudCxcbiAgICAgICAgfSxcbiAgICAgICAgY3JlYXRlOiB7XG4gICAgICAgICAgY29udmVyc2F0aW9uSWQsXG4gICAgICAgICAgaGVscGZ1bCxcbiAgICAgICAgICBjb21tZW50OiBzYW5pdGl6ZWRDb21tZW50LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IHR4LmNvbnZlcnNhdGlvbi51cGRhdGUoe1xuICAgICAgICB3aGVyZTogeyBpZDogY29udmVyc2F0aW9uSWQgfSxcbiAgICAgICAgZGF0YTogeyBzdGF0dXM6IENvbnZlcnNhdGlvblN0YXR1cy5DTE9TRUQgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgcXVldWVNZW1vcnlFeHRyYWN0aW9uKHVzZXIuaWQsIGNvbnZlcnNhdGlvbklkKTtcblxuICAgIHJlcGxpZXMgPSBbXG4gICAgICB7XG4gICAgICAgIHJlcGx5X3R5cGU6ICd0ZXh0JyxcbiAgICAgICAgcmVwbHlfdGV4dDogYWNrbm93bGVkZ2VtZW50VGV4dCA/PyBGRUVEQkFDS19BQ0tfRkFMTEJBQ0ssXG4gICAgICB9LFxuICAgIF07XG5cbiAgICBsb2dnZXIuaW5mbyhcbiAgICAgIHsgdXNlcklkOiB1c2VyLmlkLCBjb252ZXJzYXRpb25JZCwgaGVscGZ1bCwgaGFzQ29tbWVudDogQm9vbGVhbihzYW5pdGl6ZWRDb21tZW50KSB9LFxuICAgICAgJ1N0b3JlZCB1c2VyIGZlZWRiYWNrJyxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICAuLi5zdGF0ZSxcbiAgICBhc3Npc3RhbnRSZXBseTogcmVwbGllcyxcbiAgICBwZW5kaW5nOiBQZW5kaW5nVHlwZS5OT05FLFxuICB9O1xufVxuIl19