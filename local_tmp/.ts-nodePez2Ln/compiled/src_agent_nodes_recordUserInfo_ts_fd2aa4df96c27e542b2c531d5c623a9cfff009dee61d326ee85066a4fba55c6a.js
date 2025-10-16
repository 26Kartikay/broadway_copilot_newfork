"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordUserInfo = recordUserInfo;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const ai_1 = require("../../lib/ai");
const messages_1 = require("../../lib/ai/core/messages");
const prisma_1 = require("../../lib/prisma");
const errors_1 = require("../../utils/errors");
const logger_1 = require("../../utils/logger");
const prompts_1 = require("../../utils/prompts");
const LLMOutputSchema = zod_1.z.object({
    confirmed_gender: zod_1.z
        .enum(client_1.Gender)
        .describe("The user's inferred gender, which must be one of the values from the Gender enum."),
    confirmed_age_group: zod_1.z
        .enum(client_1.AgeGroup)
        .describe("The user's inferred age group, which must be one of the values from the AgeGroup enum."),
});
async function recordUserInfo(state) {
    const userId = state.user.id;
    try {
        const systemPromptText = await (0, prompts_1.loadPrompt)('data/record_user_info.txt');
        const systemPrompt = new messages_1.SystemMessage(systemPromptText);
        const response = await (0, ai_1.getTextLLM)()
            .withStructuredOutput(LLMOutputSchema)
            .run(systemPrompt, state.conversationHistoryTextOnly, state.traceBuffer, 'recordUserInfo');
        const user = await prisma_1.prisma.user.update({
            where: { id: state.user.id },
            data: {
                confirmedGender: response.confirmed_gender,
                confirmedAgeGroup: response.confirmed_age_group,
            },
        });
        logger_1.logger.debug({ userId }, 'User info recorded successfully');
        return { ...state, user, pending: client_1.PendingType.NONE };
    }
    catch (err) {
        throw new errors_1.InternalServerError('Failed to record user info', { cause: err });
    }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ub2Rlcy9yZWNvcmRVc2VySW5mby50cyIsInNvdXJjZXMiOlsiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ub2Rlcy9yZWNvcmRVc2VySW5mby50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQThCQSx3Q0FzQkM7QUFwREQsNkJBQXdCO0FBRXhCLDJDQUErRDtBQUUvRCxxQ0FBMEM7QUFDMUMseURBQTJEO0FBQzNELDZDQUEwQztBQUMxQywrQ0FBeUQ7QUFDekQsK0NBQTRDO0FBQzVDLGlEQUFpRDtBQU1qRCxNQUFNLGVBQWUsR0FBRyxPQUFDLENBQUMsTUFBTSxDQUFDO0lBQy9CLGdCQUFnQixFQUFFLE9BQUM7U0FDaEIsSUFBSSxDQUFDLGVBQU0sQ0FBQztTQUNaLFFBQVEsQ0FBQyxtRkFBbUYsQ0FBQztJQUNoRyxtQkFBbUIsRUFBRSxPQUFDO1NBQ25CLElBQUksQ0FBQyxpQkFBUSxDQUFDO1NBQ2QsUUFBUSxDQUNQLHdGQUF3RixDQUN6RjtDQUNKLENBQUMsQ0FBQztBQU1JLEtBQUssVUFBVSxjQUFjLENBQUMsS0FBaUI7SUFDcEQsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7SUFDN0IsSUFBSSxDQUFDO1FBQ0gsTUFBTSxnQkFBZ0IsR0FBRyxNQUFNLElBQUEsb0JBQVUsRUFBQywyQkFBMkIsQ0FBQyxDQUFDO1FBQ3ZFLE1BQU0sWUFBWSxHQUFHLElBQUksd0JBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBRXpELE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBQSxlQUFVLEdBQUU7YUFDaEMsb0JBQW9CLENBQUMsZUFBZSxDQUFDO2FBQ3JDLEdBQUcsQ0FBQyxZQUFZLEVBQUUsS0FBSyxDQUFDLDJCQUEyQixFQUFFLEtBQUssQ0FBQyxXQUFXLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztRQUU3RixNQUFNLElBQUksR0FBRyxNQUFNLGVBQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDO1lBQ3BDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRTtZQUM1QixJQUFJLEVBQUU7Z0JBQ0osZUFBZSxFQUFFLFFBQVEsQ0FBQyxnQkFBZ0I7Z0JBQzFDLGlCQUFpQixFQUFFLFFBQVEsQ0FBQyxtQkFBbUI7YUFDaEQ7U0FDRixDQUFDLENBQUM7UUFDSCxlQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsTUFBTSxFQUFFLEVBQUUsaUNBQWlDLENBQUMsQ0FBQztRQUM1RCxPQUFPLEVBQUUsR0FBRyxLQUFLLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxvQkFBVyxDQUFDLElBQUksRUFBRSxDQUFDO0lBQ3ZELENBQUM7SUFBQyxPQUFPLEdBQVksRUFBRSxDQUFDO1FBQ3RCLE1BQU0sSUFBSSw0QkFBbUIsQ0FBQyw0QkFBNEIsRUFBRSxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQzlFLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgeiB9IGZyb20gJ3pvZCc7XG5cbmltcG9ydCB7IEFnZUdyb3VwLCBHZW5kZXIsIFBlbmRpbmdUeXBlIH0gZnJvbSAnQHByaXNtYS9jbGllbnQnO1xuXG5pbXBvcnQgeyBnZXRUZXh0TExNIH0gZnJvbSAnLi4vLi4vbGliL2FpJztcbmltcG9ydCB7IFN5c3RlbU1lc3NhZ2UgfSBmcm9tICcuLi8uLi9saWIvYWkvY29yZS9tZXNzYWdlcyc7XG5pbXBvcnQgeyBwcmlzbWEgfSBmcm9tICcuLi8uLi9saWIvcHJpc21hJztcbmltcG9ydCB7IEludGVybmFsU2VydmVyRXJyb3IgfSBmcm9tICcuLi8uLi91dGlscy9lcnJvcnMnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vLi4vdXRpbHMvbG9nZ2VyJztcbmltcG9ydCB7IGxvYWRQcm9tcHQgfSBmcm9tICcuLi8uLi91dGlscy9wcm9tcHRzJztcbmltcG9ydCB7IEdyYXBoU3RhdGUgfSBmcm9tICcuLi9zdGF0ZSc7XG5cbi8qKlxuICogU3RydWN0dXJlZCBvdXRwdXQgc2NoZW1hIGZvciBjb25maXJtaW5nIHVzZXIgcHJvZmlsZSBmaWVsZHMuXG4gKi9cbmNvbnN0IExMTU91dHB1dFNjaGVtYSA9IHoub2JqZWN0KHtcbiAgY29uZmlybWVkX2dlbmRlcjogelxuICAgIC5lbnVtKEdlbmRlcilcbiAgICAuZGVzY3JpYmUoXCJUaGUgdXNlcidzIGluZmVycmVkIGdlbmRlciwgd2hpY2ggbXVzdCBiZSBvbmUgb2YgdGhlIHZhbHVlcyBmcm9tIHRoZSBHZW5kZXIgZW51bS5cIiksXG4gIGNvbmZpcm1lZF9hZ2VfZ3JvdXA6IHpcbiAgICAuZW51bShBZ2VHcm91cClcbiAgICAuZGVzY3JpYmUoXG4gICAgICBcIlRoZSB1c2VyJ3MgaW5mZXJyZWQgYWdlIGdyb3VwLCB3aGljaCBtdXN0IGJlIG9uZSBvZiB0aGUgdmFsdWVzIGZyb20gdGhlIEFnZUdyb3VwIGVudW0uXCIsXG4gICAgKSxcbn0pO1xuXG4vKipcbiAqIEV4dHJhY3RzIGFuZCBwZXJzaXN0cyBjb25maXJtZWQgdXNlciBwcm9maWxlIGZpZWxkcyBpbmZlcnJlZCBmcm9tIHJlY2VudCBjb252ZXJzYXRpb24uXG4gKiBSZXNldHMgcGVuZGluZyBzdGF0ZSB0byBOT05FIHdoZW4gY29tcGxldGUuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWNvcmRVc2VySW5mbyhzdGF0ZTogR3JhcGhTdGF0ZSk6IFByb21pc2U8R3JhcGhTdGF0ZT4ge1xuICBjb25zdCB1c2VySWQgPSBzdGF0ZS51c2VyLmlkO1xuICB0cnkge1xuICAgIGNvbnN0IHN5c3RlbVByb21wdFRleHQgPSBhd2FpdCBsb2FkUHJvbXB0KCdkYXRhL3JlY29yZF91c2VyX2luZm8udHh0Jyk7XG4gICAgY29uc3Qgc3lzdGVtUHJvbXB0ID0gbmV3IFN5c3RlbU1lc3NhZ2Uoc3lzdGVtUHJvbXB0VGV4dCk7XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGdldFRleHRMTE0oKVxuICAgICAgLndpdGhTdHJ1Y3R1cmVkT3V0cHV0KExMTU91dHB1dFNjaGVtYSlcbiAgICAgIC5ydW4oc3lzdGVtUHJvbXB0LCBzdGF0ZS5jb252ZXJzYXRpb25IaXN0b3J5VGV4dE9ubHksIHN0YXRlLnRyYWNlQnVmZmVyLCAncmVjb3JkVXNlckluZm8nKTtcblxuICAgIGNvbnN0IHVzZXIgPSBhd2FpdCBwcmlzbWEudXNlci51cGRhdGUoe1xuICAgICAgd2hlcmU6IHsgaWQ6IHN0YXRlLnVzZXIuaWQgfSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgY29uZmlybWVkR2VuZGVyOiByZXNwb25zZS5jb25maXJtZWRfZ2VuZGVyLFxuICAgICAgICBjb25maXJtZWRBZ2VHcm91cDogcmVzcG9uc2UuY29uZmlybWVkX2FnZV9ncm91cCxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgbG9nZ2VyLmRlYnVnKHsgdXNlcklkIH0sICdVc2VyIGluZm8gcmVjb3JkZWQgc3VjY2Vzc2Z1bGx5Jyk7XG4gICAgcmV0dXJuIHsgLi4uc3RhdGUsIHVzZXIsIHBlbmRpbmc6IFBlbmRpbmdUeXBlLk5PTkUgfTtcbiAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgdGhyb3cgbmV3IEludGVybmFsU2VydmVyRXJyb3IoJ0ZhaWxlZCB0byByZWNvcmQgdXNlciBpbmZvJywgeyBjYXVzZTogZXJyIH0pO1xuICB9XG59XG4iXX0=