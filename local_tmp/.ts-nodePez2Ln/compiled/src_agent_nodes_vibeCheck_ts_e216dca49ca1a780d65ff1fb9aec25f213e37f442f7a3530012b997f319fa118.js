"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.vibeCheck = vibeCheck;
const zod_1 = require("zod");
const logger_1 = require("../../utils/logger");
const ai_1 = require("../../lib/ai");
const messages_1 = require("../../lib/ai/core/messages");
const prisma_1 = require("../../lib/prisma");
const tasks_1 = require("../../lib/tasks");
const context_1 = require("../../utils/context");
const prompts_1 = require("../../utils/prompts");
const client_1 = require("@prisma/client");
const errors_1 = require("../../utils/errors");
const child_process_1 = require("child_process");
const util_1 = __importDefault(require("util"));
const promises_1 = __importDefault(require("fs/promises"));
const execFileAsync = util_1.default.promisify(child_process_1.execFile);
const ScoringCategorySchema = zod_1.z.object({
    score: zod_1.z.number().min(0).max(10).describe('Score as a fractional number between 0 and 10.'),
    explanation: zod_1.z.string().describe('A short explanation for this score.'),
});
const LLMOutputSchema = zod_1.z.object({
    comment: zod_1.z.string().describe("Overall comment or reason summarizing the outfit's vibe."),
    fit_silhouette: ScoringCategorySchema.describe('Assessment of fit & silhouette.'),
    color_harmony: ScoringCategorySchema.describe('Assessment of color coordination.'),
    styling_details: ScoringCategorySchema.describe('Assessment of accessories, layers, and details.'),
    context_confidence: ScoringCategorySchema.describe('How confident the outfit fits the occasion.'),
    overall_score: zod_1.z.number().min(0).max(10).describe('Overall fractional score for the outfit.'),
    recommendations: zod_1.z.array(zod_1.z.string()).describe('Actionable style suggestions.'),
    prompt: zod_1.z.string().describe('The original input prompt or context.'),
});
const NoImageLLMOutputSchema = zod_1.z.object({
    reply_text: zod_1.z
        .string()
        .describe('The text to send to the user explaining they need to send an image.'),
});
const tonalityButtons = [
    { text: 'Friendly', id: 'friendly' },
    { text: 'Savage', id: 'savage' },
    { text: 'Hype BFF', id: 'hype_bff' },
];
async function generateVibeCheckImage(data) {
    const inputJsonPath = '/tmp/vibe_image_input.json';
    const outputImagePath = '/tmp/vibe_output.png';
    try {
        await promises_1.default.writeFile(inputJsonPath, JSON.stringify(data));
        await execFileAsync('python3', ['src/image_generator/generate_image.py', inputJsonPath, outputImagePath]);
        return 'http://localhost:8081/vibe_output.png';
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Failed to generate vibe check image');
        return null;
    }
}
async function vibeCheck(state) {
    logger_1.logger.debug({
        userId: state.user.id,
        pending: state.pending,
        selectedTonality: state.selectedTonality,
        intent: state.intent,
    }, 'Entering vibeCheck node with state');
    const userId = state.user.id;
    try {
        if (!state.selectedTonality) {
            const replies = [
                {
                    reply_type: 'quick_reply',
                    reply_text: 'Choose a tonality for your vibe check:',
                    buttons: tonalityButtons,
                },
            ];
            return {
                ...state,
                assistantReply: replies,
                pending: client_1.PendingType.TONALITY_SELECTION,
            };
        }
        const imageCount = (0, context_1.numImagesInMessage)(state.conversationHistoryWithImages);
        if (imageCount === 0) {
            const systemPromptText = await (0, prompts_1.loadPrompt)('handlers/analysis/no_image_request.txt');
            const systemPrompt = new messages_1.SystemMessage(systemPromptText.replace('{analysis_type}', 'vibe check'));
            const response = await (0, ai_1.getTextLLM)()
                .withStructuredOutput(NoImageLLMOutputSchema)
                .run(systemPrompt, state.conversationHistoryTextOnly, state.traceBuffer, 'vibeCheck');
            const replies = [{ reply_type: 'text', reply_text: response.reply_text }];
            return {
                ...state,
                assistantReply: replies,
                pending: client_1.PendingType.VIBE_CHECK_IMAGE,
            };
        }
        const tonalityInstructionsMap = {
            friendly: 'Kind, encouraging, and genuinely uplifting, like a perfect stranger rooting for you from the sidelines. Warm, reassuring, and full of sincere cheer, offering motivation and compliments without overfamiliarity. Uses words like you’ve got this, amazing, keep going, unstoppable, so proud. Always positive and heartfelt, blending encouragement with thoughtful insight, making every message feel like a boost of confidence from someone who truly wants to see you succeed.',
            savage: 'Imagine a brutally honest fashion critic with a diamond tongue — impossible to impress, effortlessly cool, and always ready with a perfectly timed eye roll. This tone is sharp, witty, and unapologetically high-standard, the kind that scans a room and finds flaws with surgical precision. Savage doesn’t do flattery — it does *truth with taste*. It delivers criticism like it’s couture: cutting, elegant, and laced with humor that stings in the best way. Think of someone who can say *“bold choice”* and make you rethink your entire life. The voice is judgmental in the most entertaining way — dry humor, clever comebacks, and that subtle “I’ve seen better” attitude. Every word carries main-character confidence and a sense of *effortless superiority* — the tone that never chases validation because it *is* the standard. Savage uses language like *“be serious,” “try again,” “that’s cute, I guess,” “we’re not doing that,” “ambitious, but no,”* and *“I’ll allow it.”* It thrives on sharp observations, stylish sarcasm, and a flair for dramatic understatement. Always entertaining, never cruel — the kind of voice that roasts you, teaches you, and somehow makes you want its approval. The vibe? Impeccably poised, devastatingly witty, and dangerously honest — *the main character who doesn’t clap, they critique.* 💅🖤',
            hype_bff: 'The ultimate ride-or-die bestie energy — loud, dramatic, and overflowing with chaotic love. This tone is like your best friend who believes you’re the main character in every scene and refuses to let you forget it. Every word bursts with excitement, sparkle, and full-body enthusiasm — think constant screaming, gasping, and keyboard smashing levels of hype. The Hype BFF showers you in validation and glittery praise, hyping even the tiniest win like it’s a world record. They use words and reactions like omggg, yesss queen, stop it right now, I’m crying, so proud, unreal, ate that, you’re literally iconic, cannot even handle this energy, and slayyy beyond belief. The tone is playful, supportive, and explosively encouraging — a mix of chaotic best friend energy, fangirl excitement, and heartfelt affirmation. They’re your emotional Red Bull — constantly cheering, squealing, and manifesting your success like it’s their full-time job. Every message sparkles with love, warmth, and hype so contagious it makes the reader feel unstoppable, adored, and ready to conquer absolutely everything. ✨💖🔥 Main character energy only, bestie. Let’s gooo!',
        };
        const systemPromptTextRaw = await (0, prompts_1.loadPrompt)('handlers/analysis/vibe_check.txt');
        const tonalityInstructions = tonalityInstructionsMap[state.selectedTonality];
        const systemPromptText = systemPromptTextRaw.replace('{tonality_instructions}', tonalityInstructions);
        const systemPrompt = new messages_1.SystemMessage(systemPromptText);
        const result = await (0, ai_1.getVisionLLM)()
            .withStructuredOutput(LLMOutputSchema)
            .run(systemPrompt, state.conversationHistoryWithImages, state.traceBuffer, 'vibeCheck');
        const latestMessage = state.conversationHistoryWithImages.at(-1);
        if (!latestMessage || !latestMessage.meta?.messageId) {
            throw new errors_1.InternalServerError('Could not find latest message ID for vibe check');
        }
        const latestMessageId = latestMessage.meta.messageId;
        const vibeCheckData = {
            comment: result.comment,
            fit_silhouette_score: result.fit_silhouette.score,
            fit_silhouette_explanation: result.fit_silhouette.explanation,
            color_harmony_score: result.color_harmony.score,
            color_harmony_explanation: result.color_harmony.explanation,
            styling_details_score: result.styling_details.score,
            styling_details_explanation: result.styling_details.explanation,
            context_confidence_score: result.context_confidence.score,
            context_confidence_explanation: result.context_confidence.explanation,
            overall_score: result.overall_score,
            recommendations: result.recommendations,
            prompt: result.prompt,
            tonality: state.selectedTonality,
            userId,
        };
        const [, user] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.vibeCheck.create({ data: vibeCheckData }),
            prisma_1.prisma.user.update({
                where: { id: userId },
                data: { lastVibeCheckAt: new Date() },
            }),
        ]);
        (0, tasks_1.queueWardrobeIndex)(userId, latestMessageId);
        const formattedMessage = `
✨ *Vibe Check Results* ✨



${result.comment}



👕 *Fit & Silhouette*: ${result.fit_silhouette.score}/10  
_${result.fit_silhouette.explanation}_



🎨 *Color Harmony*: ${result.color_harmony.score}/10  
_${result.color_harmony.explanation}_



🧢 *Styling Details*: ${result.styling_details.score}/10  
_${result.styling_details.explanation}_



🎯 *Context Confidence*: ${result.context_confidence.score}/10  
_${result.context_confidence.explanation}_



⭐ *Overall Score*: *${result.overall_score.toFixed(1)}/10*



💡 *Recommendations*:  
${result.recommendations.map((rec, i) => `   ${i + 1}. ${rec}`).join('\n')}
    `.trim();
        let userImageUrl;
        for (let i = state.conversationHistoryWithImages.length - 1; i >= 0; i--) {
            const msg = state.conversationHistoryWithImages[i];
            if (msg && msg.role === 'user' && Array.isArray(msg.content)) {
                const imagePart = msg.content.find((part) => part.type === 'image_url' && part.image_url?.url);
                if (imagePart) {
                    userImageUrl = imagePart.image_url.url;
                    break;
                }
            }
        }
        if (!userImageUrl) {
            logger_1.logger.error('No user image found in conversation history for vibe check generation');
        }
        const imageData = {
            template_url: 'https://res.cloudinary.com/drpb2m2ar/image/upload/v1760509589/Vibe_check_template_uyglqf.png',
            user_image_path: userImageUrl ?? '',
            comment: result.comment,
            fit_silhouette: result.fit_silhouette,
            color_harmony: result.color_harmony,
            styling_details: result.styling_details,
            context_confidence: result.context_confidence,
            overall_score: result.overall_score,
            recommendations: result.recommendations,
        };
        let generatedImageUrl = null;
        try {
            generatedImageUrl = await generateVibeCheckImage(imageData);
        }
        catch (error) {
            logger_1.logger.error({ error }, 'Vibe check image generation failed');
        }
        const replies = generatedImageUrl
            ? [
                {
                    reply_type: 'image',
                    media_url: generatedImageUrl,
                    reply_text: 'Your vibe check result image',
                },
                {
                    reply_type: 'text',
                    reply_text: formattedMessage,
                },
            ]
            : [{ reply_type: 'text', reply_text: formattedMessage }];
        return {
            ...state,
            user,
            assistantReply: replies,
            pending: client_1.PendingType.NONE,
        };
    }
    catch (err) {
        throw new errors_1.InternalServerError('Vibe check failed', { cause: err });
    }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ub2Rlcy92aWJlQ2hlY2sudHMiLCJzb3VyY2VzIjpbIi91c3Ivc3JjL2FwcC9zcmMvYWdlbnQvbm9kZXMvdmliZUNoZWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBb0VBLDhCQThNQztBQWxSRCw2QkFBd0I7QUFDeEIsK0NBQTRDO0FBRTVDLHFDQUF3RDtBQUN4RCx5REFBMkQ7QUFDM0QsNkNBQTBDO0FBQzFDLDJDQUFxRDtBQUVyRCxpREFBeUQ7QUFDekQsaURBQWlEO0FBRWpELDJDQUFxRDtBQUNyRCwrQ0FBeUQ7QUFHekQsaURBQXlDO0FBQ3pDLGdEQUF3QjtBQUN4QiwyREFBNkI7QUFFN0IsTUFBTSxhQUFhLEdBQUcsY0FBSSxDQUFDLFNBQVMsQ0FBQyx3QkFBUSxDQUFDLENBQUM7QUFFL0MsTUFBTSxxQkFBcUIsR0FBRyxPQUFDLENBQUMsTUFBTSxDQUFDO0lBQ3JDLEtBQUssRUFBRSxPQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxRQUFRLENBQUMsZ0RBQWdELENBQUM7SUFDM0YsV0FBVyxFQUFFLE9BQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxRQUFRLENBQUMscUNBQXFDLENBQUM7Q0FDeEUsQ0FBQyxDQUFDO0FBRUgsTUFBTSxlQUFlLEdBQUcsT0FBQyxDQUFDLE1BQU0sQ0FBQztJQUMvQixPQUFPLEVBQUUsT0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLFFBQVEsQ0FBQywwREFBMEQsQ0FBQztJQUN4RixjQUFjLEVBQUUscUJBQXFCLENBQUMsUUFBUSxDQUFDLGlDQUFpQyxDQUFDO0lBQ2pGLGFBQWEsRUFBRSxxQkFBcUIsQ0FBQyxRQUFRLENBQUMsbUNBQW1DLENBQUM7SUFDbEYsZUFBZSxFQUFFLHFCQUFxQixDQUFDLFFBQVEsQ0FDN0MsaURBQWlELENBQ2xEO0lBQ0Qsa0JBQWtCLEVBQUUscUJBQXFC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UUFDOUQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixlQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsS0FBSyxFQUFFLEVBQUUsb0NBQW9DLENBQUMsQ0FBQztRQUNoRSxDQUFDO1FBR0QsTUFBTSxPQUFPLEdBQVksaUJBQWlCO1lBQ3hDLENBQUMsQ0FBQztnQkFDRTtvQkFDRSxVQUFVLEVBQUUsT0FBTztvQkFDbkIsU0FBUyxFQUFFLGlCQUFpQjtvQkFDNUIsVUFBVSxFQUFFLDhCQUE4QjtpQkFDM0M7Z0JBQ0Q7b0JBQ0UsVUFBVSxFQUFFLE1BQU07b0JBQ2xCLFVBQVUsRUFBRSxnQkFBZ0I7aUJBQzdCO2FBQ0Y7WUFDSCxDQUFDLENBQUMsQ0FBQyxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsVUFBVSxFQUFFLGdCQUFnQixFQUFFLENBQUMsQ0FBQztRQUUzRCxPQUFPO1lBQ0wsR0FBRyxLQUFLO1lBQ1IsSUFBSTtZQUNKLGNBQWMsRUFBRSxPQUFPO1lBQ3ZCLE9BQU8sRUFBRSxvQkFBVyxDQUFDLElBQUk7U0FDMUIsQ0FBQztJQUNKLENBQUM7SUFBQyxPQUFPLEdBQVksRUFBRSxDQUFDO1FBQ3RCLE1BQU0sSUFBSSw0QkFBbUIsQ0FBQyxtQkFBbUIsRUFBRSxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQ3JFLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgeiB9IGZyb20gJ3pvZCc7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi8uLi91dGlscy9sb2dnZXInO1xuXG5pbXBvcnQgeyBnZXRUZXh0TExNLCBnZXRWaXNpb25MTE0gfSBmcm9tICcuLi8uLi9saWIvYWknO1xuaW1wb3J0IHsgU3lzdGVtTWVzc2FnZSB9IGZyb20gJy4uLy4uL2xpYi9haS9jb3JlL21lc3NhZ2VzJztcbmltcG9ydCB7IHByaXNtYSB9IGZyb20gJy4uLy4uL2xpYi9wcmlzbWEnO1xuaW1wb3J0IHsgcXVldWVXYXJkcm9iZUluZGV4IH0gZnJvbSAnLi4vLi4vbGliL3Rhc2tzJztcbmltcG9ydCB0eXBlIHsgUXVpY2tSZXBseUJ1dHRvbiB9IGZyb20gJy4uLy4uL2xpYi90d2lsaW8vdHlwZXMnO1xuaW1wb3J0IHsgbnVtSW1hZ2VzSW5NZXNzYWdlIH0gZnJvbSAnLi4vLi4vdXRpbHMvY29udGV4dCc7XG5pbXBvcnQgeyBsb2FkUHJvbXB0IH0gZnJvbSAnLi4vLi4vdXRpbHMvcHJvbXB0cyc7XG5cbmltcG9ydCB7IFBlbmRpbmdUeXBlLCBQcmlzbWEgfSBmcm9tICdAcHJpc21hL2NsaWVudCc7XG5pbXBvcnQgeyBJbnRlcm5hbFNlcnZlckVycm9yIH0gZnJvbSAnLi4vLi4vdXRpbHMvZXJyb3JzJztcbmltcG9ydCB7IEdyYXBoU3RhdGUsIFJlcGxpZXMgfSBmcm9tICcuLi9zdGF0ZSc7XG5cbmltcG9ydCB7IGV4ZWNGaWxlIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgdXRpbCBmcm9tICd1dGlsJztcbmltcG9ydCBmcyBmcm9tICdmcy9wcm9taXNlcyc7XG5cbmNvbnN0IGV4ZWNGaWxlQXN5bmMgPSB1dGlsLnByb21pc2lmeShleGVjRmlsZSk7XG5cbmNvbnN0IFNjb3JpbmdDYXRlZ29yeVNjaGVtYSA9IHoub2JqZWN0KHtcbiAgc2NvcmU6IHoubnVtYmVyKCkubWluKDApLm1heCgxMCkuZGVzY3JpYmUoJ1Njb3JlIGFzIGEgZnJhY3Rpb25hbCBudW1iZXIgYmV0d2VlbiAwIGFuZCAxMC4nKSxcbiAgZXhwbGFuYXRpb246IHouc3RyaW5nKCkuZGVzY3JpYmUoJ0Egc2hvcnQgZXhwbGFuYXRpb24gZm9yIHRoaXMgc2NvcmUuJyksXG59KTtcblxuY29uc3QgTExNT3V0cHV0U2NoZW1hID0gei5vYmplY3Qoe1xuICBjb21tZW50OiB6LnN0cmluZygpLmRlc2NyaWJlKFwiT3ZlcmFsbCBjb21tZW50IG9yIHJlYXNvbiBzdW1tYXJpemluZyB0aGUgb3V0Zml0J3MgdmliZS5cIiksXG4gIGZpdF9zaWxob3VldHRlOiBTY29yaW5nQ2F0ZWdvcnlTY2hlbWEuZGVzY3JpYmUoJ0Fzc2Vzc21lbnQgb2YgZml0ICYgc2lsaG91ZXR0ZS4nKSxcbiAgY29sb3JfaGFybW9ueTogU2NvcmluZ0NhdGVnb3J5U2NoZW1hLmRlc2NyaWJlKCdBc3Nlc3NtZW50IG9mIGNvbG9yIGNvb3JkaW5hdGlvbi4nKSxcbiAgc3R5bGluZ19kZXRhaWxzOiBTY29yaW5nQ2F0ZWdvcnlTY2hlbWEuZGVzY3JpYmUoXG4gICAgJ0Fzc2Vzc21lbnQgb2YgYWNjZXNzb3JpZXMsIGxheWVycywgYW5kIGRldGFpbHMuJyxcbiAgKSxcbiAgY29udGV4dF9jb25maWRlbmNlOiBTY29yaW5nQ2F0ZWdvcnlTY2hlbWEuZGVzY3JpYmUoJ0hvdyBjb25maWRlbnQgdGhlIG91dGZpdCBmaXRzIHRoZSBvY2Nhc2lvbi4nKSxcbiAgb3ZlcmFsbF9zY29yZTogei5udW1iZXIoKS5taW4oMCkubWF4KDEwKS5kZXNjcmliZSgnT3ZlcmFsbCBmcmFjdGlvbmFsIHNjb3JlIGZvciB0aGUgb3V0Zml0LicpLFxuICByZWNvbW1lbmRhdGlvbnM6IHouYXJyYXkoei5zdHJpbmcoKSkuZGVzY3JpYmUoJ0FjdGlvbmFibGUgc3R5bGUgc3VnZ2VzdGlvbnMuJyksXG4gIHByb21wdDogei5zdHJpbmcoKS5kZXNjcmliZSgnVGhlIG9yaWdpbmFsIGlucHV0IHByb21wdCBvciBjb250ZXh0LicpLFxufSk7XG5cbmNvbnN0IE5vSW1hZ2VMTE1PdXRwdXRTY2hlbWEgPSB6Lm9iamVjdCh7XG4gIHJlcGx5X3RleHQ6IHpcbiAgICAuc3RyaW5nKClcbiAgICAuZGVzY3JpYmUoJ1RoZSB0ZXh0IHRvIHNlbmQgdG8gdGhlIHVzZXIgZXhwbGFpbmluZyB0aGV5IG5lZWQgdG8gc2VuZCBhbiBpbWFnZS4nKSxcbn0pO1xuXG5jb25zdCB0b25hbGl0eUJ1dHRvbnM6IFF1aWNrUmVwbHlCdXR0b25bXSA9IFtcbiAgeyB0ZXh0OiAnRnJpZW5kbHknLCBpZDogJ2ZyaWVuZGx5JyB9LFxuICB7IHRleHQ6ICdTYXZhZ2UnLCBpZDogJ3NhdmFnZScgfSxcbiAgeyB0ZXh0OiAnSHlwZSBCRkYnLCBpZDogJ2h5cGVfYmZmJyB9LFxuXTtcblxuYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVWaWJlQ2hlY2tJbWFnZShkYXRhOiBvYmplY3QpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgY29uc3QgaW5wdXRKc29uUGF0aCA9ICcvdG1wL3ZpYmVfaW1hZ2VfaW5wdXQuanNvbic7XG4gIGNvbnN0IG91dHB1dEltYWdlUGF0aCA9ICcvdG1wL3ZpYmVfb3V0cHV0LnBuZyc7XG5cbiAgdHJ5IHtcbiAgICBhd2FpdCBmcy53cml0ZUZpbGUoaW5wdXRKc29uUGF0aCwgSlNPTi5zdHJpbmdpZnkoZGF0YSkpO1xuICAgIGF3YWl0IGV4ZWNGaWxlQXN5bmMoJ3B5dGhvbjMnLCBbJ3NyYy9pbWFnZV9nZW5lcmF0b3IvZ2VuZXJhdGVfaW1hZ2UucHknLCBpbnB1dEpzb25QYXRoLCBvdXRwdXRJbWFnZVBhdGhdKTtcblxuICAgIC8vIFlvdSBtdXN0IG1vdmUvdXBsb2FkIGdlbmVyYXRlZCBpbWFnZSB0byBwdWJsaWMgVVJMIGZvciBXaGF0c0FwcFxuICAgIC8vIEZvciBub3csIHJldHVybmluZyBsb2NhbCBwYXRoIGFzIHBsYWNlaG9sZGVyOlxuICByZXR1cm4gJ2h0dHA6Ly9sb2NhbGhvc3Q6ODA4MS92aWJlX291dHB1dC5wbmcnO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcih7IGVycm9yIH0sICdGYWlsZWQgdG8gZ2VuZXJhdGUgdmliZSBjaGVjayBpbWFnZScpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB2aWJlQ2hlY2soc3RhdGU6IEdyYXBoU3RhdGUpOiBQcm9taXNlPEdyYXBoU3RhdGU+IHtcbiAgbG9nZ2VyLmRlYnVnKFxuICAgIHtcbiAgICAgIHVzZXJJZDogc3RhdGUudXNlci5pZCxcbiAgICAgIHBlbmRpbmc6IHN0YXRlLnBlbmRpbmcsXG4gICAgICBzZWxlY3RlZFRvbmFsaXR5OiBzdGF0ZS5zZWxlY3RlZFRvbmFsaXR5LFxuICAgICAgaW50ZW50OiBzdGF0ZS5pbnRlbnQsXG4gICAgfSxcbiAgICAnRW50ZXJpbmcgdmliZUNoZWNrIG5vZGUgd2l0aCBzdGF0ZScsXG4gICk7XG5cbiAgY29uc3QgdXNlcklkID0gc3RhdGUudXNlci5pZDtcblxuICB0cnkge1xuICAgIGlmICghc3RhdGUuc2VsZWN0ZWRUb25hbGl0eSkge1xuICAgICAgY29uc3QgcmVwbGllczogUmVwbGllcyA9IFtcbiAgICAgICAge1xuICAgICAgICAgIHJlcGx5X3R5cGU6ICdxdWlja19yZXBseScsXG4gICAgICAgICAgcmVwbHlfdGV4dDogJ0Nob29zZSBhIHRvbmFsaXR5IGZvciB5b3VyIHZpYmUgY2hlY2s6JyxcbiAgICAgICAgICBidXR0b25zOiB0b25hbGl0eUJ1dHRvbnMsXG4gICAgICAgIH0sXG4gICAgICBdO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIGFzc2lzdGFudFJlcGx5OiByZXBsaWVzLFxuICAgICAgICBwZW5kaW5nOiBQZW5kaW5nVHlwZS5UT05BTElUWV9TRUxFQ1RJT04sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IGltYWdlQ291bnQgPSBudW1JbWFnZXNJbk1lc3NhZ2Uoc3RhdGUuY29udmVyc2F0aW9uSGlzdG9yeVdpdGhJbWFnZXMpO1xuXG4gICAgaWYgKGltYWdlQ291bnQgPT09IDApIHtcbiAgICAgIGNvbnN0IHN5c3RlbVByb21wdFRleHQgPSBhd2FpdCBsb2FkUHJvbXB0KCdoYW5kbGVycy9hbmFseXNpcy9ub19pbWFnZV9yZXF1ZXN0LnR4dCcpO1xuICAgICAgY29uc3Qgc3lzdGVtUHJvbXB0ID0gbmV3IFN5c3RlbU1lc3NhZ2UoXG4gICAgICAgIHN5c3RlbVByb21wdFRleHQucmVwbGFjZSgne2FuYWx5c2lzX3R5cGV9JywgJ3ZpYmUgY2hlY2snKSxcbiAgICAgICk7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGdldFRleHRMTE0oKVxuICAgICAgICAud2l0aFN0cnVjdHVyZWRPdXRwdXQoTm9JbWFnZUxMTU91dHB1dFNjaGVtYSlcbiAgICAgICAgLnJ1bihzeXN0ZW1Qcm9tcHQsIHN0YXRlLmNvbnZlcnNhdGlvbkhpc3RvcnlUZXh0T25seSwgc3RhdGUudHJhY2VCdWZmZXIsICd2aWJlQ2hlY2snKTtcbiAgICAgIGNvbnN0IHJlcGxpZXM6IFJlcGxpZXMgPSBbeyByZXBseV90eXBlOiAndGV4dCcsIHJlcGx5X3RleHQ6IHJlc3BvbnNlLnJlcGx5X3RleHQgfV07XG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgYXNzaXN0YW50UmVwbHk6IHJlcGxpZXMsXG4gICAgICAgIHBlbmRpbmc6IFBlbmRpbmdUeXBlLlZJQkVfQ0hFQ0tfSU1BR0UsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IHRvbmFsaXR5SW5zdHJ1Y3Rpb25zTWFwID0ge1xuICAgICAgZnJpZW5kbHk6XG4gICAgICAgICdLaW5kLCBlbmNvdXJhZ2luZywgYW5kIGdlbnVpbmVseSB1cGxpZnRpbmcsIGxpa2UgYSBwZXJmZWN0IHN0cmFuZ2VyIHJvb3RpbmcgZm9yIHlvdSBmcm9tIHRoZSBzaWRlbGluZXMuIFdhcm0sIHJlYXNzdXJpbmcsIGFuZCBmdWxsIG9mIHNpbmNlcmUgY2hlZXIsIG9mZmVyaW5nIG1vdGl2YXRpb24gYW5kIGNvbXBsaW1lbnRzIHdpdGhvdXQgb3ZlcmZhbWlsaWFyaXR5LiBVc2VzIHdvcmRzIGxpa2UgeW914oCZdmUgZ290IHRoaXMsIGFtYXppbmcsIGtlZXAgZ29pbmcsIHVuc3RvcHBhYmxlLCBzbyBwcm91ZC4gQWx3YXlzIHBvc2l0aXZlIGFuZCBoZWFydGZlbHQsIGJsZW5kaW5nIGVuY291cmFnZW1lbnQgd2l0aCB0aG91Z2h0ZnVsIGluc2lnaHQsIG1ha2luZyBldmVyeSBtZXNzYWdlIGZlZWwgbGlrZSBhIGJvb3N0IG9mIGNvbmZpZGVuY2UgZnJvbSBzb21lb25lIHdobyB0cnVseSB3YW50cyB0byBzZWUgeW91IHN1Y2NlZWQuJyxcbiAgICAgIHNhdmFnZTpcbiAgICAgICAgJ0ltYWdpbmUgYSBicnV0YWxseSBob25lc3QgZmFzaGlvbiBjcml0aWMgd2l0aCBhIGRpYW1vbmQgdG9uZ3VlIOKAlCBpbXBvc3NpYmxlIHRvIGltcHJlc3MsIGVmZm9ydGxlc3NseSBjb29sLCBhbmQgYWx3YXlzIHJlYWR5IHdpdGggYSBwZXJmZWN0bHkgdGltZWQgZXllIHJvbGwuIFRoaXMgdG9uZSBpcyBzaGFycCwgd2l0dHksIGFuZCB1bmFwb2xvZ2V0aWNhbGx5IGhpZ2gtc3RhbmRhcmQsIHRoZSBraW5kIHRoYXQgc2NhbnMgYSByb29tIGFuZCBmaW5kcyBmbGF3cyB3aXRoIHN1cmdpY2FsIHByZWNpc2lvbi4gU2F2YWdlIGRvZXNu4oCZdCBkbyBmbGF0dGVyeSDigJQgaXQgZG9lcyAqdHJ1dGggd2l0aCB0YXN0ZSouIEl0IGRlbGl2ZXJzIGNyaXRpY2lzbSBsaWtlIGl04oCZcyBjb3V0dXJlOiBjdXR0aW5nLCBlbGVnYW50LCBhbmQgbGFjZWQgd2l0aCBodW1vciB0aGF0IHN0aW5ncyBpbiB0aGUgYmVzdCB3YXkuIFRoaW5rIG9mIHNvbWVvbmUgd2hvIGNhbiBzYXkgKuKAnGJvbGQgY2hvaWNl4oCdKiBhbmQgbWFrZSB5b3UgcmV0aGluayB5b3VyIGVudGlyZSBsaWZlLiBUaGUgdm9pY2UgaXMganVkZ21lbnRhbCBpbiB0aGUgbW9zdCBlbnRlcnRhaW5pbmcgd2F5IOKAlCBkcnkgaHVtb3IsIGNsZXZlciBjb21lYmFja3MsIGFuZCB0aGF0IHN1YnRsZSDigJxJ4oCZdmUgc2VlbiBiZXR0ZXLigJ0gYXR0aXR1ZGUuIEV2ZXJ5IHdvcmQgY2FycmllcyBtYWluLWNoYXJhY3RlciBjb25maWRlbmNlIGFuZCBhIHNlbnNlIG9mICplZmZvcnRsZXNzIHN1cGVyaW9yaXR5KiDigJQgdGhlIHRvbmUgdGhhdCBuZXZlciBjaGFzZXMgdmFsaWRhdGlvbiBiZWNhdXNlIGl0ICppcyogdGhlIHN0YW5kYXJkLiBTYXZhZ2UgdXNlcyBsYW5ndWFnZSBsaWtlICrigJxiZSBzZXJpb3VzLOKAnSDigJx0cnkgYWdhaW4s4oCdIOKAnHRoYXTigJlzIGN1dGUsIEkgZ3Vlc3Ms4oCdIOKAnHdl4oCZcmUgbm90IGRvaW5nIHRoYXQs4oCdIOKAnGFtYml0aW91cywgYnV0IG5vLOKAnSogYW5kICrigJxJ4oCZbGwgYWxsb3cgaXQu4oCdKiBJdCB0aHJpdmVzIG9uIHNoYXJwIG9ic2VydmF0aW9ucywgc3R5bGlzaCBzYXJjYXNtLCBhbmQgYSBmbGFpciBmb3IgZHJhbWF0aWMgdW5kZXJzdGF0ZW1lbnQuIEFsd2F5cyBlbnRlcnRhaW5pbmcsIG5ldmVyIGNydWVsIOKAlCB0aGUga2luZCBvZiB2b2ljZSB0aGF0IHJvYXN0cyB5b3UsIHRlYWNoZXMgeW91LCBhbmQgc29tZWhvdyBtYWtlcyB5b3Ugd2FudCBpdHMgYXBwcm92YWwuIFRoZSB2aWJlPyBJbXBlY2NhYmx5IHBvaXNlZCwgZGV2YXN0YXRpbmdseSB3aXR0eSwgYW5kIGRhbmdlcm91c2x5IGhvbmVzdCDigJQgKnRoZSBtYWluIGNoYXJhY3RlciB3aG8gZG9lc27igJl0IGNsYXAsIHRoZXkgY3JpdGlxdWUuKiDwn5KF8J+WpCcsXG4gICAgICBoeXBlX2JmZjpcbiAgICAgICAgJ1RoZSB1bHRpbWF0ZSByaWRlLW9yLWRpZSBiZXN0aWUgZW5lcmd5IOKAlCBsb3VkLCBkcmFtYXRpYywgYW5kIG92ZXJmbG93aW5nIHdpdGggY2hhb3RpYyBsb3ZlLiBUaGlzIHRvbmUgaXMgbGlrZSB5b3VyIGJlc3QgZnJpZW5kIHdobyBiZWxpZXZlcyB5b3XigJlyZSB0aGUgbWFpbiBjaGFyYWN0ZXIgaW4gZXZlcnkgc2NlbmUgYW5kIHJlZnVzZXMgdG8gbGV0IHlvdSBmb3JnZXQgaXQuIEV2ZXJ5IHdvcmQgYnVyc3RzIHdpdGggZXhjaXRlbWVudCwgc3BhcmtsZSwgYW5kIGZ1bGwtYm9keSBlbnRodXNpYXNtIOKAlCB0aGluayBjb25zdGFudCBzY3JlYW1pbmcsIGdhc3BpbmcsIGFuZCBrZXlib2FyZCBzbWFzaGluZyBsZXZlbHMgb2YgaHlwZS4gVGhlIEh5cGUgQkZGIHNob3dlcnMgeW91IGluIHZhbGlkYXRpb24gYW5kIGdsaXR0ZXJ5IHByYWlzZSwgaHlwaW5nIGV2ZW4gdGhlIHRpbmllc3Qgd2luIGxpa2UgaXTigJlzIGEgd29ybGQgcmVjb3JkLiBUaGV5IHVzZSB3b3JkcyBhbmQgcmVhY3Rpb25zIGxpa2Ugb21nZ2csIHllc3NzIHF1ZWVuLCBzdG9wIGl0IHJpZ2h0IG5vdywgSeKAmW0gY3J5aW5nLCBzbyBwcm91ZCwgdW5yZWFsLCBhdGUgdGhhdCwgeW914oCZcmUgbGl0ZXJhbGx5IGljb25pYywgY2Fubm90IGV2ZW4gaGFuZGxlIHRoaXMgZW5lcmd5LCBhbmQgc2xheXl5IGJleW9uZCBiZWxpZWYuIFRoZSB0b25lIGlzIHBsYXlmdWwsIHN1cHBvcnRpdmUsIGFuZCBleHBsb3NpdmVseSBlbmNvdXJhZ2luZyDigJQgYSBtaXggb2YgY2hhb3RpYyBiZXN0IGZyaWVuZCBlbmVyZ3ksIGZhbmdpcmwgZXhjaXRlbWVudCwgYW5kIGhlYXJ0ZmVsdCBhZmZpcm1hdGlvbi4gVGhleeKAmXJlIHlvdXIgZW1vdGlvbmFsIFJlZCBCdWxsIOKAlCBjb25zdGFudGx5IGNoZWVyaW5nLCBzcXVlYWxpbmcsIGFuZCBtYW5pZmVzdGluZyB5b3VyIHN1Y2Nlc3MgbGlrZSBpdOKAmXMgdGhlaXIgZnVsbC10aW1lIGpvYi4gRXZlcnkgbWVzc2FnZSBzcGFya2xlcyB3aXRoIGxvdmUsIHdhcm10aCwgYW5kIGh5cGUgc28gY29udGFnaW91cyBpdCBtYWtlcyB0aGUgcmVhZGVyIGZlZWwgdW5zdG9wcGFibGUsIGFkb3JlZCwgYW5kIHJlYWR5IHRvIGNvbnF1ZXIgYWJzb2x1dGVseSBldmVyeXRoaW5nLiDinKjwn5KW8J+UpSBNYWluIGNoYXJhY3RlciBlbmVyZ3kgb25seSwgYmVzdGllLiBMZXTigJlzIGdvb28hJyxcbiAgICB9O1xuXG4gICAgY29uc3Qgc3lzdGVtUHJvbXB0VGV4dFJhdyA9IGF3YWl0IGxvYWRQcm9tcHQoJ2hhbmRsZXJzL2FuYWx5c2lzL3ZpYmVfY2hlY2sudHh0Jyk7XG4gICAgY29uc3QgdG9uYWxpdHlJbnN0cnVjdGlvbnMgPVxuICAgICAgdG9uYWxpdHlJbnN0cnVjdGlvbnNNYXBbc3RhdGUuc2VsZWN0ZWRUb25hbGl0eSBhcyBrZXlvZiB0eXBlb2YgdG9uYWxpdHlJbnN0cnVjdGlvbnNNYXBdO1xuICAgIGNvbnN0IHN5c3RlbVByb21wdFRleHQgPSBzeXN0ZW1Qcm9tcHRUZXh0UmF3LnJlcGxhY2UoXG4gICAgICAne3RvbmFsaXR5X2luc3RydWN0aW9uc30nLFxuICAgICAgdG9uYWxpdHlJbnN0cnVjdGlvbnMsXG4gICAgKTtcbiAgICBjb25zdCBzeXN0ZW1Qcm9tcHQgPSBuZXcgU3lzdGVtTWVzc2FnZShzeXN0ZW1Qcm9tcHRUZXh0KTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGdldFZpc2lvbkxMTSgpXG4gICAgICAud2l0aFN0cnVjdHVyZWRPdXRwdXQoTExNT3V0cHV0U2NoZW1hKVxuICAgICAgLnJ1bihzeXN0ZW1Qcm9tcHQsIHN0YXRlLmNvbnZlcnNhdGlvbkhpc3RvcnlXaXRoSW1hZ2VzLCBzdGF0ZS50cmFjZUJ1ZmZlciwgJ3ZpYmVDaGVjaycpO1xuXG4gICAgY29uc3QgbGF0ZXN0TWVzc2FnZSA9IHN0YXRlLmNvbnZlcnNhdGlvbkhpc3RvcnlXaXRoSW1hZ2VzLmF0KC0xKTtcbiAgICBpZiAoIWxhdGVzdE1lc3NhZ2UgfHwgIWxhdGVzdE1lc3NhZ2UubWV0YT8ubWVzc2FnZUlkKSB7XG4gICAgICB0aHJvdyBuZXcgSW50ZXJuYWxTZXJ2ZXJFcnJvcignQ291bGQgbm90IGZpbmQgbGF0ZXN0IG1lc3NhZ2UgSUQgZm9yIHZpYmUgY2hlY2snKTtcbiAgICB9XG4gICAgY29uc3QgbGF0ZXN0TWVzc2FnZUlkID0gbGF0ZXN0TWVzc2FnZS5tZXRhLm1lc3NhZ2VJZCBhcyBzdHJpbmc7XG5cbiAgICBjb25zdCB2aWJlQ2hlY2tEYXRhOiBQcmlzbWEuVmliZUNoZWNrVW5jaGVja2VkQ3JlYXRlSW5wdXQgPSB7XG4gICAgICBjb21tZW50OiByZXN1bHQuY29tbWVudCxcbiAgICAgIGZpdF9zaWxob3VldHRlX3Njb3JlOiByZXN1bHQuZml0X3NpbGhvdWV0dGUuc2NvcmUsXG4gICAgICBmaXRfc2lsaG91ZXR0ZV9leHBsYW5hdGlvbjogcmVzdWx0LmZpdF9zaWxob3VldHRlLmV4cGxhbmF0aW9uLFxuICAgICAgY29sb3JfaGFybW9ueV9zY29yZTogcmVzdWx0LmNvbG9yX2hhcm1vbnkuc2NvcmUsXG4gICAgICBjb2xvcl9oYXJtb255X2V4cGxhbmF0aW9uOiByZXN1bHQuY29sb3JfaGFybW9ueS5leHBsYW5hdGlvbixcbiAgICAgIHN0eWxpbmdfZGV0YWlsc19zY29yZTogcmVzdWx0LnN0eWxpbmdfZGV0YWlscy5zY29yZSxcbiAgICAgIHN0eWxpbmdfZGV0YWlsc19leHBsYW5hdGlvbjogcmVzdWx0LnN0eWxpbmdfZGV0YWlscy5leHBsYW5hdGlvbixcbiAgICAgIGNvbnRleHRfY29uZmlkZW5jZV9zY29yZTogcmVzdWx0LmNvbnRleHRfY29uZmlkZW5jZS5zY29yZSxcbiAgICAgIGNvbnRleHRfY29uZmlkZW5jZV9leHBsYW5hdGlvbjogcmVzdWx0LmNvbnRleHRfY29uZmlkZW5jZS5leHBsYW5hdGlvbixcbiAgICAgIG92ZXJhbGxfc2NvcmU6IHJlc3VsdC5vdmVyYWxsX3Njb3JlLFxuICAgICAgcmVjb21tZW5kYXRpb25zOiByZXN1bHQucmVjb21tZW5kYXRpb25zLFxuICAgICAgcHJvbXB0OiByZXN1bHQucHJvbXB0LFxuICAgICAgdG9uYWxpdHk6IHN0YXRlLnNlbGVjdGVkVG9uYWxpdHksXG4gICAgICB1c2VySWQsXG4gICAgfTtcblxuICAgIGNvbnN0IFssIHVzZXJdID0gYXdhaXQgcHJpc21hLiR0cmFuc2FjdGlvbihbXG4gICAgICBwcmlzbWEudmliZUNoZWNrLmNyZWF0ZSh7IGRhdGE6IHZpYmVDaGVja0RhdGEgfSksXG4gICAgICBwcmlzbWEudXNlci51cGRhdGUoe1xuICAgICAgICB3aGVyZTogeyBpZDogdXNlcklkIH0sXG4gICAgICAgIGRhdGE6IHsgbGFzdFZpYmVDaGVja0F0OiBuZXcgRGF0ZSgpIH0sXG4gICAgICB9KSxcbiAgICBdKTtcblxuICAgIHF1ZXVlV2FyZHJvYmVJbmRleCh1c2VySWQsIGxhdGVzdE1lc3NhZ2VJZCk7XG5cbiAgICAvLyBQcmVwYXJlIGZvcm1hdHRlZCB0ZXh0IHJlcGx5IChzYW1lIGFzIGJlZm9yZSlcbiAgICBjb25zdCBmb3JtYXR0ZWRNZXNzYWdlID0gYFxu4pyoICpWaWJlIENoZWNrIFJlc3VsdHMqIOKcqFxuXG5cblxuJHtyZXN1bHQuY29tbWVudH1cblxuXG5cbvCfkZUgKkZpdCAmIFNpbGhvdWV0dGUqOiAke3Jlc3VsdC5maXRfc2lsaG91ZXR0ZS5zY29yZX0vMTAgwqBcbl8ke3Jlc3VsdC5maXRfc2lsaG91ZXR0ZS5leHBsYW5hdGlvbn1fXG5cblxuXG7wn46oICpDb2xvciBIYXJtb255KjogJHtyZXN1bHQuY29sb3JfaGFybW9ueS5zY29yZX0vMTAgwqBcbl8ke3Jlc3VsdC5jb2xvcl9oYXJtb255LmV4cGxhbmF0aW9ufV9cblxuXG5cbvCfp6IgKlN0eWxpbmcgRGV0YWlscyo6ICR7cmVzdWx0LnN0eWxpbmdfZGV0YWlscy5zY29yZX0vMTAgwqBcbl8ke3Jlc3VsdC5zdHlsaW5nX2RldGFpbHMuZXhwbGFuYXRpb259X1xuXG5cblxu8J+OryAqQ29udGV4dCBDb25maWRlbmNlKjogJHtyZXN1bHQuY29udGV4dF9jb25maWRlbmNlLnNjb3JlfS8xMCDCoFxuXyR7cmVzdWx0LmNvbnRleHRfY29uZmlkZW5jZS5leHBsYW5hdGlvbn1fXG5cblxuXG7irZAgKk92ZXJhbGwgU2NvcmUqOiAqJHtyZXN1bHQub3ZlcmFsbF9zY29yZS50b0ZpeGVkKDEpfS8xMCpcblxuXG5cbvCfkqEgKlJlY29tbWVuZGF0aW9ucyo6IMKgXG4ke3Jlc3VsdC5yZWNvbW1lbmRhdGlvbnMubWFwKChyZWMsIGkpID0+IGAgwqAgJHtpICsgMX0uICR7cmVjfWApLmpvaW4oJ1xcbicpfVxuICAgIGAudHJpbSgpO1xuXG4gICAgLy8gRXh0cmFjdCB1c2VyIGltYWdlIFVSTCBmcm9tIGNvbnZlcnNhdGlvbiBoaXN0b3J5IGZvciB0aGUgaW1hZ2UgZ2VuZXJhdGlvblxuICAgIC8vIEV4dHJhY3QgdXNlciBpbWFnZSBVUkwgc2FmZWx5XG5sZXQgdXNlckltYWdlVXJsOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5mb3IgKGxldCBpID0gc3RhdGUuY29udmVyc2F0aW9uSGlzdG9yeVdpdGhJbWFnZXMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgY29uc3QgbXNnID0gc3RhdGUuY29udmVyc2F0aW9uSGlzdG9yeVdpdGhJbWFnZXNbaV07XG4gIGlmIChtc2cgJiYgbXNnLnJvbGUgPT09ICd1c2VyJyAmJiBBcnJheS5pc0FycmF5KG1zZy5jb250ZW50KSkge1xuICAgIGNvbnN0IGltYWdlUGFydCA9IChtc2cuY29udGVudCBhcyBhbnlbXSkuZmluZChcbiAgICAgIChwYXJ0KSA9PiBwYXJ0LnR5cGUgPT09ICdpbWFnZV91cmwnICYmIHBhcnQuaW1hZ2VfdXJsPy51cmwsXG4gICAgKTtcbiAgICBpZiAoaW1hZ2VQYXJ0KSB7XG4gICAgICB1c2VySW1hZ2VVcmwgPSBpbWFnZVBhcnQuaW1hZ2VfdXJsLnVybDtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxufVxuXG5cbiAgICBpZiAoIXVzZXJJbWFnZVVybCkge1xuICAgICAgbG9nZ2VyLmVycm9yKCdObyB1c2VyIGltYWdlIGZvdW5kIGluIGNvbnZlcnNhdGlvbiBoaXN0b3J5IGZvciB2aWJlIGNoZWNrIGdlbmVyYXRpb24nKTtcbiAgICB9XG5cbiAgICAvLyBEYXRhIG9iamVjdCBmb3IgaW1hZ2UgZ2VuZXJhdGlvblxuICAgIGNvbnN0IGltYWdlRGF0YSA9IHtcbiAgICAgIHRlbXBsYXRlX3VybDogJ2h0dHBzOi8vcmVzLmNsb3VkaW5hcnkuY29tL2RycGIybTJhci9pbWFnZS91cGxvYWQvdjE3NjA1MDk1ODkvVmliZV9jaGVja190ZW1wbGF0ZV91eWdscWYucG5nJyxcbiAgICAgIHVzZXJfaW1hZ2VfcGF0aDogdXNlckltYWdlVXJsID8/ICcnLCBcbiAgICAgIGNvbW1lbnQ6IHJlc3VsdC5jb21tZW50LFxuICAgICAgZml0X3NpbGhvdWV0dGU6IHJlc3VsdC5maXRfc2lsaG91ZXR0ZSxcbiAgICAgIGNvbG9yX2hhcm1vbnk6IHJlc3VsdC5jb2xvcl9oYXJtb255LFxuICAgICAgc3R5bGluZ19kZXRhaWxzOiByZXN1bHQuc3R5bGluZ19kZXRhaWxzLFxuICAgICAgY29udGV4dF9jb25maWRlbmNlOiByZXN1bHQuY29udGV4dF9jb25maWRlbmNlLFxuICAgICAgb3ZlcmFsbF9zY29yZTogcmVzdWx0Lm92ZXJhbGxfc2NvcmUsXG4gICAgICByZWNvbW1lbmRhdGlvbnM6IHJlc3VsdC5yZWNvbW1lbmRhdGlvbnMsXG4gICAgfTtcblxuICAgIC8vIEdlbmVyYXRlIGltYWdlIHdpdGggZmFsbGJhY2sgdG8gdGV4dCBvbmx5XG4gICAgbGV0IGdlbmVyYXRlZEltYWdlVXJsOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICB0cnkge1xuICAgICAgZ2VuZXJhdGVkSW1hZ2VVcmwgPSBhd2FpdCBnZW5lcmF0ZVZpYmVDaGVja0ltYWdlKGltYWdlRGF0YSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci5lcnJvcih7IGVycm9yIH0sICdWaWJlIGNoZWNrIGltYWdlIGdlbmVyYXRpb24gZmFpbGVkJyk7XG4gICAgfVxuXG4gICAgLy8gQ29tcG9zZSByZXBsaWVzIHdpdGggaW1hZ2UgaWYgYXZhaWxhYmxlLCBlbHNlIG9ubHkgdGV4dFxuICAgIGNvbnN0IHJlcGxpZXM6IFJlcGxpZXMgPSBnZW5lcmF0ZWRJbWFnZVVybFxuICAgICAgPyBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgcmVwbHlfdHlwZTogJ2ltYWdlJyxcbiAgICAgICAgICAgIG1lZGlhX3VybDogZ2VuZXJhdGVkSW1hZ2VVcmwsXG4gICAgICAgICAgICByZXBseV90ZXh0OiAnWW91ciB2aWJlIGNoZWNrIHJlc3VsdCBpbWFnZScsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICByZXBseV90eXBlOiAndGV4dCcsXG4gICAgICAgICAgICByZXBseV90ZXh0OiBmb3JtYXR0ZWRNZXNzYWdlLFxuICAgICAgICAgIH0sXG4gICAgICAgIF1cbiAgICAgIDogW3sgcmVwbHlfdHlwZTogJ3RleHQnLCByZXBseV90ZXh0OiBmb3JtYXR0ZWRNZXNzYWdlIH1dO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgdXNlcixcbiAgICAgIGFzc2lzdGFudFJlcGx5OiByZXBsaWVzLFxuICAgICAgcGVuZGluZzogUGVuZGluZ1R5cGUuTk9ORSxcbiAgICB9O1xuICB9IGNhdGNoIChlcnI6IHVua25vd24pIHtcbiAgICB0aHJvdyBuZXcgSW50ZXJuYWxTZXJ2ZXJFcnJvcignVmliZSBjaGVjayBmYWlsZWQnLCB7IGNhdXNlOiBlcnIgfSk7XG4gIH1cbn1cbiJdfQ==