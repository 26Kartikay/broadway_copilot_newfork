"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.colorAnalysis = colorAnalysis;
const zod_1 = require("zod");
const ai_1 = require("../../lib/ai");
const messages_1 = require("../../lib/ai/core/messages");
const prisma_1 = require("../../lib/prisma");
const context_1 = require("../../utils/context");
const errors_1 = require("../../utils/errors");
const logger_1 = require("../../utils/logger");
const prompts_1 = require("../../utils/prompts");
const client_1 = require("@prisma/client");
const ColorObjectSchema = zod_1.z.object({
    name: zod_1.z
        .string()
        .describe("A concise, shopper-friendly color name (e.g., 'Warm Ivory', 'Deep Espresso')."),
    hex: zod_1.z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .describe('The representative hex color code (#RRGGBB).'),
});
const LLMOutputSchema = zod_1.z.object({
    compliment: zod_1.z
        .string()
        .describe("A short compliment for the user (e.g., 'Looking sharp and confident!')."),
    palette_name: zod_1.z
        .string()
        .nullable()
        .describe("The seasonal color palette name (e.g., 'Deep Winter', 'Soft Summer')."),
    palette_description: zod_1.z
        .string()
        .nullable()
        .describe("Why this palette suits the user (e.g., 'Your strong contrast and cool undertones shine in the Deep Winter palette...')."),
    colors_suited: zod_1.z
        .array(ColorObjectSchema)
        .describe('Main representative colors from the palette.'),
    colors_to_wear: zod_1.z.object({
        clothing: zod_1.z.array(zod_1.z.string()).describe('Recommended clothing colors.'),
        jewelry: zod_1.z
            .array(zod_1.z.string())
            .describe('Recommended jewelry tones (e.g., Silver, Rose Gold, White Gold).'),
    }),
    colors_to_avoid: zod_1.z
        .array(ColorObjectSchema)
        .describe('Colors that clash with the palette and should be avoided.'),
});
const NoImageLLMOutputSchema = zod_1.z.object({
    reply_text: zod_1.z
        .string()
        .describe('The text to send to the user explaining they need to send an image.'),
});
async function colorAnalysis(state) {
    const userId = state.user.id;
    const messageId = state.input.MessageSid;
    const imageCount = (0, context_1.numImagesInMessage)(state.conversationHistoryWithImages);
    if (imageCount === 0) {
        const systemPromptText = await (0, prompts_1.loadPrompt)('handlers/analysis/no_image_request.txt');
        const systemPrompt = new messages_1.SystemMessage(systemPromptText.replace('{analysis_type}', 'color analysis'));
        const response = await (0, ai_1.getTextLLM)()
            .withStructuredOutput(NoImageLLMOutputSchema)
            .run(systemPrompt, state.conversationHistoryTextOnly, state.traceBuffer, 'colorAnalysis');
        logger_1.logger.debug({ userId, reply_text: response.reply_text }, 'Invoking text LLM for no-image response');
        const replies = [{ reply_type: 'text', reply_text: response.reply_text }];
        return {
            ...state,
            assistantReply: replies,
            pending: client_1.PendingType.COLOR_ANALYSIS_IMAGE,
        };
    }
    try {
        const systemPromptText = await (0, prompts_1.loadPrompt)('handlers/analysis/color_analysis.txt');
        const systemPrompt = new messages_1.SystemMessage(systemPromptText);
        const output = await (0, ai_1.getVisionLLM)()
            .withStructuredOutput(LLMOutputSchema)
            .run(systemPrompt, state.conversationHistoryWithImages, state.traceBuffer, 'colorAnalysis');
        const [, user] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.colorAnalysis.create({
                data: {
                    userId,
                    compliment: output.compliment,
                    palette_name: output.palette_name ?? null,
                    palette_description: output.palette_description ?? null,
                    colors_suited: output.colors_suited,
                    colors_to_wear: output.colors_to_wear,
                    colors_to_avoid: output.colors_to_avoid,
                },
            }),
            prisma_1.prisma.user.update({
                where: { id: state.user.id },
                data: { lastColorAnalysisAt: new Date() },
            }),
        ]);
        const formattedMessage = `
🎨 *Your Color Palette: ${output.palette_name ?? 'Unknown'}*

💬 ${output.compliment}

✨ *Why it suits you:* ${output.palette_description ?? 'N/A'}

👗 *Colors to Wear:* ${output.colors_to_wear.clothing.join(', ')}
💍 *Jewelry:* ${output.colors_to_wear.jewelry.join(', ')}
⚠️ *Colors to Avoid:* ${output.colors_to_avoid.map((c) => c.name).join(', ')}
`;
        const replies = [{ reply_type: 'text', reply_text: formattedMessage.trim() }];
        logger_1.logger.debug({ userId, messageId, replies }, 'Color analysis completed successfully');
        return {
            ...state,
            user,
            assistantReply: replies,
            pending: client_1.PendingType.NONE,
        };
    }
    catch (err) {
        throw new errors_1.InternalServerError('Color analysis failed', { cause: err });
    }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ub2Rlcy9jb2xvckFuYWx5c2lzLnRzIiwic291cmNlcyI6WyIvdXNyL3NyYy9hcHAvc3JjL2FnZW50L25vZGVzL2NvbG9yQW5hbHlzaXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFtRUEsc0NBb0ZDO0FBdkpELDZCQUF3QjtBQUV4QixxQ0FBd0Q7QUFDeEQseURBQTJEO0FBQzNELDZDQUEwQztBQUMxQyxpREFBeUQ7QUFDekQsK0NBQXlEO0FBQ3pELCtDQUE0QztBQUM1QyxpREFBaUQ7QUFFakQsMkNBQTZDO0FBTTdDLE1BQU0saUJBQWlCLEdBQUcsT0FBQyxDQUFDLE1BQU0sQ0FBQztJQUNqQyxJQUFJLEVBQUUsT0FBQztTQUNKLE1BQU0sRUFBRTtTQUNSLFFBQVEsQ0FBQywrRUFBK0UsQ0FBQztJQUM1RixHQUFHLEVBQUUsT0FBQztTQUNILE1BQU0sRUFBRTtTQUNSLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQztTQUMxQixRQUFRLENBQUMsOENBQThDLENBQUM7Q0FDNUQsQ0FBQyxDQUFDO0FBS0gsTUFBTSxlQUFlLEdBQUcsT0FBQyxDQUFDLE1BQU0sQ0FBQztJQUMvQixVQUFVLEVBQUUsT0FBQztTQUNWLE1BQU0sRUFBRTtTQUNSLFFBQVEsQ0FBQyx5RUFBeUUsQ0FBQztJQUN0RixZQUFZLEVBQUUsT0FBQztTQUNaLE1BQU0sRUFBRTtTQUNSLFFBQVEsRUFBRTtTQUNWLFFBQVEsQ0FBQyx1RUFBdUUsQ0FBQztJQUNwRixtQkFBbUIsRUFBRSxPQUFDO1NBQ25CLE1BQU0sRUFBRTtTQUNSLFFBQVEsRUFBRTtTQUNWLFFBQVEsQ0FDUCx5SEFBeUgsQ0FDMUg7SUFDSCxhQUFhLEVBQUUsT0FBQztTQUNiLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQztTQUN4QixRQUFRLENBQUMsOENBQThDLENBQUM7SUFDM0QsY0FBYyxFQUFFLE9BQUMsQ0FBQyxNQUFNLENBQUM7UUFDdkIsUUFBUSxFQUFFLE9BQUMsQ0FBQyxLQUFL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QkFBdUIsRUFBRSxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQ3pFLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgeiB9IGZyb20gJ3pvZCc7XG5cbmltcG9ydCB7IGdldFRleHRMTE0sIGdldFZpc2lvbkxMTSB9IGZyb20gJy4uLy4uL2xpYi9haSc7XG5pbXBvcnQgeyBTeXN0ZW1NZXNzYWdlIH0gZnJvbSAnLi4vLi4vbGliL2FpL2NvcmUvbWVzc2FnZXMnO1xuaW1wb3J0IHsgcHJpc21hIH0gZnJvbSAnLi4vLi4vbGliL3ByaXNtYSc7XG5pbXBvcnQgeyBudW1JbWFnZXNJbk1lc3NhZ2UgfSBmcm9tICcuLi8uLi91dGlscy9jb250ZXh0JztcbmltcG9ydCB7IEludGVybmFsU2VydmVyRXJyb3IgfSBmcm9tICcuLi8uLi91dGlscy9lcnJvcnMnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vLi4vdXRpbHMvbG9nZ2VyJztcbmltcG9ydCB7IGxvYWRQcm9tcHQgfSBmcm9tICcuLi8uLi91dGlscy9wcm9tcHRzJztcblxuaW1wb3J0IHsgUGVuZGluZ1R5cGUgfSBmcm9tICdAcHJpc21hL2NsaWVudCc7XG5pbXBvcnQgeyBHcmFwaFN0YXRlLCBSZXBsaWVzIH0gZnJvbSAnLi4vc3RhdGUnO1xuXG4vKipcbiAqIFNjaGVtYSBmb3IgYSBjb2xvciBvYmplY3Qgd2l0aCBuYW1lIGFuZCBoZXggY29kZS5cbiAqL1xuY29uc3QgQ29sb3JPYmplY3RTY2hlbWEgPSB6Lm9iamVjdCh7XG4gIG5hbWU6IHpcbiAgICAuc3RyaW5nKClcbiAgICAuZGVzY3JpYmUoXCJBIGNvbmNpc2UsIHNob3BwZXItZnJpZW5kbHkgY29sb3IgbmFtZSAoZS5nLiwgJ1dhcm0gSXZvcnknLCAnRGVlcCBFc3ByZXNzbycpLlwiKSxcbiAgaGV4OiB6XG4gICAgLnN0cmluZygpXG4gICAgLnJlZ2V4KC9eI1swLTlhLWZBLUZdezZ9JC8pXG4gICAgLmRlc2NyaWJlKCdUaGUgcmVwcmVzZW50YXRpdmUgaGV4IGNvbG9yIGNvZGUgKCNSUkdHQkIpLicpLFxufSk7XG5cbi8qKlxuICogU2NoZW1hIGZvciB0aGUgTExNIG91dHB1dCBpbiBjb2xvciBhbmFseXNpcy5cbiAqL1xuY29uc3QgTExNT3V0cHV0U2NoZW1hID0gei5vYmplY3Qoe1xuICBjb21wbGltZW50OiB6XG4gICAgLnN0cmluZygpXG4gICAgLmRlc2NyaWJlKFwiQSBzaG9ydCBjb21wbGltZW50IGZvciB0aGUgdXNlciAoZS5nLiwgJ0xvb2tpbmcgc2hhcnAgYW5kIGNvbmZpZGVudCEnKS5cIiksXG4gIHBhbGV0dGVfbmFtZTogelxuICAgIC5zdHJpbmcoKVxuICAgIC5udWxsYWJsZSgpXG4gICAgLmRlc2NyaWJlKFwiVGhlIHNlYXNvbmFsIGNvbG9yIHBhbGV0dGUgbmFtZSAoZS5nLiwgJ0RlZXAgV2ludGVyJywgJ1NvZnQgU3VtbWVyJykuXCIpLFxuICBwYWxldHRlX2Rlc2NyaXB0aW9uOiB6XG4gICAgLnN0cmluZygpXG4gICAgLm51bGxhYmxlKClcbiAgICAuZGVzY3JpYmUoXG4gICAgICBcIldoeSB0aGlzIHBhbGV0dGUgc3VpdHMgdGhlIHVzZXIgKGUuZy4sICdZb3VyIHN0cm9uZyBjb250cmFzdCBhbmQgY29vbCB1bmRlcnRvbmVzIHNoaW5lIGluIHRoZSBEZWVwIFdpbnRlciBwYWxldHRlLi4uJykuXCIsXG4gICAgKSxcbiAgY29sb3JzX3N1aXRlZDogelxuICAgIC5hcnJheShDb2xvck9iamVjdFNjaGVtYSlcbiAgICAuZGVzY3JpYmUoJ01haW4gcmVwcmVzZW50YXRpdmUgY29sb3JzIGZyb20gdGhlIHBhbGV0dGUuJyksXG4gIGNvbG9yc190b193ZWFyOiB6Lm9iamVjdCh7XG4gICAgY2xvdGhpbmc6IHouYXJyYXkoei5zdHJpbmcoKSkuZGVzY3JpYmUoJ1JlY29tbWVuZGVkIGNsb3RoaW5nIGNvbG9ycy4nKSxcbiAgICBqZXdlbHJ5OiB6XG4gICAgICAuYXJyYXkoei5zdHJpbmcoKSlcbiAgICAgIC5kZXNjcmliZSgnUmVjb21tZW5kZWQgamV3ZWxyeSB0b25lcyAoZS5nLiwgU2lsdmVyLCBSb3NlIEdvbGQsIFdoaXRlIEdvbGQpLicpLFxuICB9KSxcbiAgY29sb3JzX3RvX2F2b2lkOiB6XG4gICAgLmFycmF5KENvbG9yT2JqZWN0U2NoZW1hKVxuICAgIC5kZXNjcmliZSgnQ29sb3JzIHRoYXQgY2xhc2ggd2l0aCB0aGUgcGFsZXR0ZSBhbmQgc2hvdWxkIGJlIGF2b2lkZWQuJyksXG59KTtcblxuY29uc3QgTm9JbWFnZUxMTU91dHB1dFNjaGVtYSA9IHoub2JqZWN0KHtcbiAgcmVwbHlfdGV4dDogelxuICAgIC5zdHJpbmcoKVxuICAgIC5kZXNjcmliZSgnVGhlIHRleHQgdG8gc2VuZCB0byB0aGUgdXNlciBleHBsYWluaW5nIHRoZXkgbmVlZCB0byBzZW5kIGFuIGltYWdlLicpLFxufSk7XG5cbi8qKlxuICogUGVyZm9ybXMgY29sb3IgYW5hbHlzaXMgZnJvbSBhIHBvcnRyYWl0IGFuZCByZXR1cm5zIGEgV2hhdHNBcHAtZnJpZW5kbHkgdGV4dCByZXBseTsgbG9ncyBhbmQgcGVyc2lzdHMgcmVzdWx0cy5cbiAqIEBwYXJhbSBzdGF0ZSBUaGUgY3VycmVudCBhZ2VudCBzdGF0ZS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvbG9yQW5hbHlzaXMoc3RhdGU6IEdyYXBoU3RhdGUpOiBQcm9taXNlPEdyYXBoU3RhdGU+IHtcbiAgY29uc3QgdXNlcklkID0gc3RhdGUudXNlci5pZDtcbiAgY29uc3QgbWVzc2FnZUlkID0gc3RhdGUuaW5wdXQuTWVzc2FnZVNpZDtcblxuICBjb25zdCBpbWFnZUNvdW50ID0gbnVtSW1hZ2VzSW5NZXNzYWdlKHN0YXRlLmNvbnZlcnNhdGlvbkhpc3RvcnlXaXRoSW1hZ2VzKTtcblxuICAvLyBObyBpbWFnZSBjYXNlXG4gIGlmIChpbWFnZUNvdW50ID09PSAwKSB7XG4gICAgY29uc3Qgc3lzdGVtUHJvbXB0VGV4dCA9IGF3YWl0IGxvYWRQcm9tcHQoJ2hhbmRsZXJzL2FuYWx5c2lzL25vX2ltYWdlX3JlcXVlc3QudHh0Jyk7XG4gICAgY29uc3Qgc3lzdGVtUHJvbXB0ID0gbmV3IFN5c3RlbU1lc3NhZ2UoXG4gICAgICBzeXN0ZW1Qcm9tcHRUZXh0LnJlcGxhY2UoJ3thbmFseXNpc190eXBlfScsICdjb2xvciBhbmFseXNpcycpLFxuICAgICk7XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGdldFRleHRMTE0oKVxuICAgICAgLndpdGhTdHJ1Y3R1cmVkT3V0cHV0KE5vSW1hZ2VMTE1PdXRwdXRTY2hlbWEpXG4gICAgICAucnVuKHN5c3RlbVByb21wdCwgc3RhdGUuY29udmVyc2F0aW9uSGlzdG9yeVRleHRPbmx5LCBzdGF0ZS50cmFjZUJ1ZmZlciwgJ2NvbG9yQW5hbHlzaXMnKTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhcbiAgICAgIHsgdXNlcklkLCByZXBseV90ZXh0OiByZXNwb25zZS5yZXBseV90ZXh0IH0sXG4gICAgICAnSW52b2tpbmcgdGV4dCBMTE0gZm9yIG5vLWltYWdlIHJlc3BvbnNlJyxcbiAgICApO1xuXG4gICAgY29uc3QgcmVwbGllczogUmVwbGllcyA9IFt7IHJlcGx5X3R5cGU6ICd0ZXh0JywgcmVwbHlfdGV4dDogcmVzcG9uc2UucmVwbHlfdGV4dCB9XTtcbiAgICByZXR1cm4ge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBhc3Npc3RhbnRSZXBseTogcmVwbGllcyxcbiAgICAgIHBlbmRpbmc6IFBlbmRpbmdUeXBlLkNPTE9SX0FOQUxZU0lTX0lNQUdFLFxuICAgIH07XG4gIH1cblxuICAvLyBJbWFnZSBwcmVzZW50OiBydW4gY29sb3IgYW5hbHlzaXNcbiAgdHJ5IHtcbiAgICBjb25zdCBzeXN0ZW1Qcm9tcHRUZXh0ID0gYXdhaXQgbG9hZFByb21wdCgnaGFuZGxlcnMvYW5hbHlzaXMvY29sb3JfYW5hbHlzaXMudHh0Jyk7XG4gICAgY29uc3Qgc3lzdGVtUHJvbXB0ID0gbmV3IFN5c3RlbU1lc3NhZ2Uoc3lzdGVtUHJvbXB0VGV4dCk7XG5cbiAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBnZXRWaXNpb25MTE0oKVxuICAgICAgLndpdGhTdHJ1Y3R1cmVkT3V0cHV0KExMTU91dHB1dFNjaGVtYSlcbiAgICAgIC5ydW4oc3lzdGVtUHJvbXB0LCBzdGF0ZS5jb252ZXJzYXRpb25IaXN0b3J5V2l0aEltYWdlcywgc3RhdGUudHJhY2VCdWZmZXIsICdjb2xvckFuYWx5c2lzJyk7XG5cbiAgICAvLyBTYXZlIHJlc3VsdHMgdG8gREJcbiAgICBjb25zdCBbLCB1c2VyXSA9IGF3YWl0IHByaXNtYS4kdHJhbnNhY3Rpb24oW1xuICAgICAgcHJpc21hLmNvbG9yQW5hbHlzaXMuY3JlYXRlKHtcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIHVzZXJJZCxcbiAgICAgICAgICBjb21wbGltZW50OiBvdXRwdXQuY29tcGxpbWVudCxcbiAgICAgICAgICBwYWxldHRlX25hbWU6IG91dHB1dC5wYWxldHRlX25hbWUgPz8gbnVsbCxcbiAgICAgICAgICBwYWxldHRlX2Rlc2NyaXB0aW9uOiBvdXRwdXQucGFsZXR0ZV9kZXNjcmlwdGlvbiA/PyBudWxsLFxuICAgICAgICAgIGNvbG9yc19zdWl0ZWQ6IG91dHB1dC5jb2xvcnNfc3VpdGVkLFxuICAgICAgICAgIGNvbG9yc190b193ZWFyOiBvdXRwdXQuY29sb3JzX3RvX3dlYXIsXG4gICAgICAgICAgY29sb3JzX3RvX2F2b2lkOiBvdXRwdXQuY29sb3JzX3RvX2F2b2lkLFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgICBwcmlzbWEudXNlci51cGRhdGUoe1xuICAgICAgICB3aGVyZTogeyBpZDogc3RhdGUudXNlci5pZCB9LFxuICAgICAgICBkYXRhOiB7IGxhc3RDb2xvckFuYWx5c2lzQXQ6IG5ldyBEYXRlKCkgfSxcbiAgICAgIH0pLFxuICAgIF0pO1xuXG4gICAgLy8gRm9ybWF0IGEgc2luZ2xlIFdoYXRzQXBwLWZyaWVuZGx5IG1lc3NhZ2VcbiAgICBjb25zdCBmb3JtYXR0ZWRNZXNzYWdlID0gYFxu8J+OqCAqWW91ciBDb2xvciBQYWxldHRlOiAke291dHB1dC5wYWxldHRlX25hbWUgPz8gJ1Vua25vd24nfSpcblxu8J+SrCAke291dHB1dC5jb21wbGltZW50fVxuXG7inKggKldoeSBpdCBzdWl0cyB5b3U6KiAke291dHB1dC5wYWxldHRlX2Rlc2NyaXB0aW9uID8/ICdOL0EnfVxuXG7wn5GXICpDb2xvcnMgdG8gV2VhcjoqICR7b3V0cHV0LmNvbG9yc190b193ZWFyLmNsb3RoaW5nLmpvaW4oJywgJyl9XG7wn5KNICpKZXdlbHJ5OiogJHtvdXRwdXQuY29sb3JzX3RvX3dlYXIuamV3ZWxyeS5qb2luKCcsICcpfVxu4pqg77iPICpDb2xvcnMgdG8gQXZvaWQ6KiAke291dHB1dC5jb2xvcnNfdG9fYXZvaWQubWFwKChjKSA9PiBjLm5hbWUpLmpvaW4oJywgJyl9XG5gO1xuXG4gICAgY29uc3QgcmVwbGllczogUmVwbGllcyA9IFt7IHJlcGx5X3R5cGU6ICd0ZXh0JywgcmVwbHlfdGV4dDogZm9ybWF0dGVkTWVzc2FnZS50cmltKCkgfV07XG5cbiAgICBsb2dnZXIuZGVidWcoeyB1c2VySWQsIG1lc3NhZ2VJZCwgcmVwbGllcyB9LCAnQ29sb3IgYW5hbHlzaXMgY29tcGxldGVkIHN1Y2Nlc3NmdWxseScpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgdXNlcixcbiAgICAgIGFzc2lzdGFudFJlcGx5OiByZXBsaWVzLFxuICAgICAgcGVuZGluZzogUGVuZGluZ1R5cGUuTk9ORSxcbiAgICB9O1xuICB9IGNhdGNoIChlcnI6IHVua25vd24pIHtcbiAgICB0aHJvdyBuZXcgSW50ZXJuYWxTZXJ2ZXJFcnJvcignQ29sb3IgYW5hbHlzaXMgZmFpbGVkJywgeyBjYXVzZTogZXJyIH0pO1xuICB9XG59XG4iXX0=