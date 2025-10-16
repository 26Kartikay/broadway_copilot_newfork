"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestMessage = ingestMessage;
const client_1 = require("@prisma/client");
const ai_1 = require("../../lib/ai");
const prisma_1 = require("../../lib/prisma");
const tasks_1 = require("../../lib/tasks");
const logger_1 = require("../../utils/logger");
const media_1 = require("../../utils/media");
const text_1 = require("../../utils/text");
async function ingestMessage(state) {
    const { input, user, conversationId, graphRunId } = state;
    const { Body: text, ButtonPayload: buttonPayload, NumMedia: numMedia, MediaUrl0: mediaUrl0, MediaContentType0: mediaContentType0, WaId: whatsappId, } = input;
    if (!whatsappId) {
        throw new Error('Whatsapp ID not found in webhook payload');
    }
    let media;
    let content = [{ type: 'text', text }];
    if (numMedia === '1' && mediaUrl0 && mediaContentType0?.startsWith('image/')) {
        try {
            const serverUrl = await (0, media_1.downloadTwilioMedia)(mediaUrl0, whatsappId, mediaContentType0);
            content.push({ type: 'image_url', image_url: { url: serverUrl } });
            media = { serverUrl, twilioUrl: mediaUrl0, mimeType: mediaContentType0 };
        }
        catch (error) {
            logger_1.logger.warn({
                error: error instanceof Error ? error.message : String(error),
                whatsappId,
                mediaUrl0,
            }, 'Failed to download image, proceeding without it.');
        }
    }
    const { savedMessage, messages, pending: dbPending, selectedTonality: dbSelectedTonality, } = await prisma_1.prisma.$transaction(async (tx) => {
        const [lastMessage, latestAssistantMessage] = await Promise.all([
            tx.message.findFirst({
                where: { conversationId },
                orderBy: { createdAt: 'desc' },
                select: { id: true, role: true, content: true },
            }),
            tx.message.findFirst({
                where: {
                    conversation: { id: conversationId, userId: user.id },
                    role: client_1.MessageRole.AI,
                },
                orderBy: { createdAt: 'desc' },
                select: { pending: true, selectedTonality: true },
            }),
        ]);
        const pendingStateDB = latestAssistantMessage?.pending ?? client_1.PendingType.NONE;
        const selectedTonalityDB = latestAssistantMessage?.selectedTonality ?? null;
        logger_1.logger.debug({
            whatsappId,
            pendingStateDB,
            selectedTonalityDB,
            conversationId,
            graphRunId,
            buttonPayload,
            text,
        }, 'IngestMessage: Current pending, selectedTonality, and input');
        let savedMessage;
        if (lastMessage && lastMessage.role === client_1.MessageRole.USER) {
            const existingContent = lastMessage.content;
            const mergedContent = [...existingContent, ...content];
            savedMessage = await tx.message.update({
                where: { id: lastMessage.id },
                data: {
                    content: mergedContent,
                    ...(buttonPayload != null && { buttonPayload }),
                    ...(media && {
                        media: {
                            create: {
                                twilioUrl: media.twilioUrl,
                                serverUrl: media.serverUrl,
                                mimeType: media.mimeType,
                            },
                        },
                    }),
                },
            });
        }
        else {
            savedMessage = await tx.message.create({
                data: {
                    conversationId,
                    role: client_1.MessageRole.USER,
                    content,
                    ...(buttonPayload != null && { buttonPayload }),
                    ...(media && {
                        media: {
                            create: {
                                twilioUrl: media.twilioUrl,
                                serverUrl: media.serverUrl,
                                mimeType: media.mimeType,
                            },
                        },
                    }),
                },
            });
        }
        const messages = await tx.message
            .findMany({
            where: {
                conversationId,
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
                id: true,
                role: true,
                content: true,
                buttonPayload: true,
                createdAt: true,
            },
        })
            .then((msgs) => msgs.reverse());
        return {
            savedMessage,
            messages,
            pending: pendingStateDB,
            selectedTonality: selectedTonalityDB,
        };
    });
    logger_1.logger.debug({
        pending: state.pending ?? dbPending,
        selectedTonality: state.selectedTonality ?? dbSelectedTonality ?? null,
        messagesCount: messages.length,
    }, 'IngestMessage: Final state before returning');
    (0, tasks_1.queueImageUpload)(user.id, savedMessage.id);
    const conversationHistoryWithImages = [];
    const conversationHistoryTextOnly = [];
    for (const msg of messages) {
        const meta = {
            createdAt: msg.createdAt,
            messageId: msg.id,
            ...(msg.role === client_1.MessageRole.USER && {
                buttonPayload: msg.buttonPayload,
            }),
        };
        const contentWithImage = msg.content;
        const textContent = (0, text_1.extractTextContent)(contentWithImage);
        if (msg.role === client_1.MessageRole.USER) {
            const messageWithImage = new ai_1.UserMessage(contentWithImage);
            messageWithImage.meta = meta;
            conversationHistoryWithImages.push(messageWithImage);
            const textOnlyMessage = new ai_1.UserMessage(textContent);
            textOnlyMessage.meta = meta;
            conversationHistoryTextOnly.push(textOnlyMessage);
        }
        else {
            const assistantMessage = new ai_1.AssistantMessage(textContent);
            assistantMessage.meta = meta;
            conversationHistoryWithImages.push(assistantMessage);
            conversationHistoryTextOnly.push(assistantMessage);
        }
    }
    logger_1.logger.debug({ whatsappId, graphRunId }, 'Message ingested successfully');
    return {
        ...state,
        conversationHistoryWithImages,
        conversationHistoryTextOnly,
        pending: state.pending ?? dbPending,
        selectedTonality: state.selectedTonality ?? dbSelectedTonality,
        user,
        input,
    };
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9ub2Rlcy9pbmdlc3RNZXNzYWdlLnRzIiwic291cmNlcyI6WyIvdXNyL3NyYy9hcHAvc3JjL2FnZW50L25vZGVzL2luZ2VzdE1lc3NhZ2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFpQkEsc0NBcU1DO0FBdE5ELDJDQUEwRDtBQUMxRCxxQ0FBNkU7QUFFN0UsNkNBQTBDO0FBQzFDLDJDQUFtRDtBQUNuRCwrQ0FBNEM7QUFDNUMsNkNBQXdEO0FBQ3hELDJDQUFzRDtBQVUvQyxLQUFLLFVBQVUsYUFBYSxDQUFDLEtBQWlCO0lBQ25ELE1BQU0sRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLGNBQWMsRUFBRSxVQUFVLEVBQUUsR0FBRyxLQUFLLENBQUM7SUFDMUQsTUFBTSxFQUNKLElBQUksRUFBRSxJQUFJLEVBQ1YsYUFBYSxFQUFFLGFBQWEsRUFDNUIsUUFBUSxFQUFFLFFBQVEsRUFDbEIsU0FBUyxFQUFFLFNBQVMsRUFDcEIsaUJBQWlCLEVBQUUsaUJBQWlCLEVBQ3BDLElBQUksRUFBRSxVQUFVLEdBQ2pCLEdBQUcsS0FBSyxDQUFDO0lBRVYsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ2hCLE1BQU0sSUFBSSxLQUFLLENBQUMsMENBQTBDLENBQUMsQ0FBQztJQUM5RCxDQUFDO0lBRUQsSUFBSSxLQUE2RSxDQUFDO0lBQ2xGLElBQUksT0FBTyxHQUFtQixDQUFDLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO0lBQ3ZELElBQUksUUFBUSxLQUFLLEdBQUcsSUFBSSxTQUFTLElBQUksaUJBQWlCLEVBQUUsVUFBVSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7UUFDN0UsSUFBSSxDQUFDO1lBQ0gsTUFBTSxTQUFTLEdBQUcsTUFBTSxJQUFBLDJCQUFtQixFQUFDLFNBQVMsRUFBRSxVQUFVLEVBQUUsaUJBQWlCLENBQUMsQ0FBQztZQUN0RixPQUFPLENBQUMsSUFBSSxDQUFD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QUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUM7WUFFckQsTUFBTSxlQUFlLEdBQUcsSUFBSSxnQkFBVyxDQUFDLFdBQVcsQ0FBQyxDQUFDO1lBQ3JELGVBQWUsQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDO1lBQzVCLDJCQUEyQixDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUNwRCxDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxxQkFBZ0IsQ0FBQyxXQUFXLENBQUMsQ0FBQztZQUMzRCxnQkFBZ0IsQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDO1lBQzdCLDZCQUE2QixDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1lBQ3JELDJCQUEyQixDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBQ3JELENBQUM7SUFDSCxDQUFDO0lBRUQsZUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUUsRUFBRSwrQkFBK0IsQ0FBQyxDQUFDO0lBTTFFLE9BQU87UUFDTCxHQUFHLEtBQUs7UUFDUiw2QkFBNkI7UUFDN0IsMkJBQTJCO1FBQzNCLE9BQU8sRUFBRSxLQUFLLENBQUMsT0FBTyxJQUFJLFNBQVM7UUFDbkMsZ0JBQWdCLEVBQUUsS0FBSyxDQUFDLGdCQUFnQixJQUFJLGtCQUFrQjtRQUM5RCxJQUFJO1FBQ0osS0FBSztLQUNOLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTWVzc2FnZVJvbGUsIFBlbmRpbmdUeXBlIH0gZnJvbSAnQHByaXNtYS9jbGllbnQnO1xuaW1wb3J0IHsgQXNzaXN0YW50TWVzc2FnZSwgTWVzc2FnZUNvbnRlbnQsIFVzZXJNZXNzYWdlIH0gZnJvbSAnLi4vLi4vbGliL2FpJztcblxuaW1wb3J0IHsgcHJpc21hIH0gZnJvbSAnLi4vLi4vbGliL3ByaXNtYSc7XG5pbXBvcnQgeyBxdWV1ZUltYWdlVXBsb2FkIH0gZnJvbSAnLi4vLi4vbGliL3Rhc2tzJztcbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4uLy4uL3V0aWxzL2xvZ2dlcic7XG5pbXBvcnQgeyBkb3dubG9hZFR3aWxpb01lZGlhIH0gZnJvbSAnLi4vLi4vdXRpbHMvbWVkaWEnO1xuaW1wb3J0IHsgZXh0cmFjdFRleHRDb250ZW50IH0gZnJvbSAnLi4vLi4vdXRpbHMvdGV4dCc7XG5pbXBvcnQgeyBHcmFwaFN0YXRlIH0gZnJvbSAnLi4vc3RhdGUnO1xuXG4vKipcbiAqIEluZ2VzdHMgaW5jb21pbmcgVHdpbGlvIG1lc3NhZ2VzLCBwcm9jZXNzZXMgbWVkaWEgYXR0YWNobWVudHMsbWFuYWdlcyBjb252ZXJzYXRpb24gaGlzdG9yeSxcbiAqIGFuZCBwcmVwYXJlcyBkYXRhIGZvciBkb3duc3RyZWFtIHByb2Nlc3NpbmcgaW4gdGhlIGFnZW50IGdyYXBoLlxuICpcbiAqIEhhbmRsZXMgbWVzc2FnZSBtZXJnaW5nIGZvciBtdWx0aS1wYXJ0IG1lc3NhZ2VzLCBtZWRpYSBkb3dubG9hZCBhbmQgc3RvcmFnZSxcbiAqIGFuZCBjb252ZXJzYXRpb24gaGlzdG9yeSBwcmVwYXJhdGlvbiB3aXRoIGJvdGggaW1hZ2UgYW5kIHRleHQtb25seSB2ZXJzaW9ucy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGluZ2VzdE1lc3NhZ2Uoc3RhdGU6IEdyYXBoU3RhdGUpOiBQcm9taXNlPEdyYXBoU3RhdGU+IHtcbiAgY29uc3QgeyBpbnB1dCwgdXNlciwgY29udmVyc2F0aW9uSWQsIGdyYXBoUnVuSWQgfSA9IHN0YXRlO1xuICBjb25zdCB7XG4gICAgQm9keTogdGV4dCxcbiAgICBCdXR0b25QYXlsb2FkOiBidXR0b25QYXlsb2FkLFxuICAgIE51bU1lZGlhOiBudW1NZWRpYSxcbiAgICBNZWRpYVVybDA6IG1lZGlhVXJsMCxcbiAgICBNZWRpYUNvbnRlbnRUeXBlMDogbWVkaWFDb250ZW50VHlwZTAsXG4gICAgV2FJZDogd2hhdHNhcHBJZCxcbiAgfSA9IGlucHV0O1xuXG4gIGlmICghd2hhdHNhcHBJZCkge1xuICAgIHRocm93IG5ldyBFcnJvcignV2hhdHNhcHAgSUQgbm90IGZvdW5kIGluIHdlYmhvb2sgcGF5bG9hZCcpO1xuICB9XG5cbiAgbGV0IG1lZGlhOiB7IHNlcnZlclVybDogc3RyaW5nOyB0d2lsaW9Vcmw6IHN0cmluZzsgbWltZVR5cGU6IHN0cmluZyB9IHwgdW5kZWZpbmVkO1xuICBsZXQgY29udGVudDogTWVzc2FnZUNvbnRlbnQgPSBbeyB0eXBlOiAndGV4dCcsIHRleHQgfV07XG4gIGlmIChudW1NZWRpYSA9PT0gJzEnICYmIG1lZGlhVXJsMCAmJiBtZWRpYUNvbnRlbnRUeXBlMD8uc3RhcnRzV2l0aCgnaW1hZ2UvJykpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc2VydmVyVXJsID0gYXdhaXQgZG93bmxvYWRUd2lsaW9NZWRpYShtZWRpYVVybDAsIHdoYXRzYXBwSWQsIG1lZGlhQ29udGVudFR5cGUwKTtcbiAgICAgIGNvbnRlbnQucHVzaCh7IHR5cGU6ICdpbWFnZV91cmwnLCBpbWFnZV91cmw6IHsgdXJsOiBzZXJ2ZXJVcmwgfSB9KTtcbiAgICAgIG1lZGlhID0geyBzZXJ2ZXJVcmwsIHR3aWxpb1VybDogbWVkaWFVcmwwLCBtaW1lVHlwZTogbWVkaWFDb250ZW50VHlwZTAgfTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLndhcm4oXG4gICAgICAgIHtcbiAgICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpLFxuICAgICAgICAgIHdoYXRzYXBwSWQsXG4gICAgICAgICAgbWVkaWFVcmwwLFxuICAgICAgICB9LFxuICAgICAgICAnRmFpbGVkIHRvIGRvd25sb2FkIGltYWdlLCBwcm9jZWVkaW5nIHdpdGhvdXQgaXQuJyxcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgY29uc3Qge1xuICAgIHNhdmVkTWVzc2FnZSxcbiAgICBtZXNzYWdlcyxcbiAgICBwZW5kaW5nOiBkYlBlbmRpbmcsXG4gICAgc2VsZWN0ZWRUb25hbGl0eTogZGJTZWxlY3RlZFRvbmFsaXR5LFxuICB9ID0gYXdhaXQgcHJpc21hLiR0cmFuc2FjdGlvbihhc3luYyAodHgpID0+IHtcbiAgICBjb25zdCBbbGFzdE1lc3NhZ2UsIGxhdGVzdEFzc2lzdGFudE1lc3NhZ2VdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgdHgubWVzc2FnZS5maW5kRmlyc3Qoe1xuICAgICAgICB3aGVyZTogeyBjb252ZXJzYXRpb25JZCB9LFxuICAgICAgICBvcmRlckJ5OiB7IGNyZWF0ZWRBdDogJ2Rlc2MnIH0sXG4gICAgICAgIHNlbGVjdDogeyBpZDogdHJ1ZSwgcm9sZTogdHJ1ZSwgY29udGVudDogdHJ1ZSB9LFxuICAgICAgfSksXG4gICAgICB0eC5tZXNzYWdlLmZpbmRGaXJzdCh7XG4gICAgICAgIHdoZXJlOiB7XG4gICAgICAgICAgY29udmVyc2F0aW9uOiB7IGlkOiBjb252ZXJzYXRpb25JZCwgdXNlcklkOiB1c2VyLmlkIH0sXG4gICAgICAgICAgcm9sZTogTWVzc2FnZVJvbGUuQUksXG4gICAgICAgIH0sXG4gICAgICAgIG9yZGVyQnk6IHsgY3JlYXRlZEF0OiAnZGVzYycgfSxcbiAgICAgICAgc2VsZWN0OiB7IHBlbmRpbmc6IHRydWUsIHNlbGVjdGVkVG9uYWxpdHk6IHRydWUgfSwgLy8gPC0tIG5vdyBzZWxlY3Rpbmcgc2VsZWN0ZWRUb25hbGl0eVxuICAgICAgfSksXG4gICAgXSk7XG5cbiAgICAvLyBQdWxsIGZyb20gREJcbiAgICBjb25zdCBwZW5kaW5nU3RhdGVEQiA9IGxhdGVzdEFzc2lzdGFudE1lc3NhZ2U/LnBlbmRpbmcgPz8gUGVuZGluZ1R5cGUuTk9ORTtcbiAgICBjb25zdCBzZWxlY3RlZFRvbmFsaXR5REIgPSBsYXRlc3RBc3Npc3RhbnRNZXNzYWdlPy5zZWxlY3RlZFRvbmFsaXR5ID8/IG51bGw7XG5cbiAgICBsb2dnZXIuZGVidWcoXG4gICAgICB7XG4gICAgICAgIHdoYXRzYXBwSWQsXG4gICAgICAgIHBlbmRpbmdTdGF0ZURCLFxuICAgICAgICBzZWxlY3RlZFRvbmFsaXR5REIsXG4gICAgICAgIGNvbnZlcnNhdGlvbklkLFxuICAgICAgICBncmFwaFJ1bklkLFxuICAgICAgICBidXR0b25QYXlsb2FkLFxuICAgICAgICB0ZXh0LFxuICAgICAgfSxcbiAgICAgICdJbmdlc3RNZXNzYWdlOiBDdXJyZW50IHBlbmRpbmcsIHNlbGVjdGVkVG9uYWxpdHksIGFuZCBpbnB1dCcsXG4gICAgKTtcblxuICAgIGxldCBzYXZlZE1lc3NhZ2U7XG4gICAgaWYgKGxhc3RNZXNzYWdlICYmIGxhc3RNZXNzYWdlLnJvbGUgPT09IE1lc3NhZ2VSb2xlLlVTRVIpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nQ29udGVudCA9IGxhc3RNZXNzYWdlLmNvbnRlbnQgYXMgTWVzc2FnZUNvbnRlbnQ7XG4gICAgICBjb25zdCBtZXJnZWRDb250ZW50ID0gWy4uLmV4aXN0aW5nQ29udGVudCwgLi4uY29udGVudF07XG5cbiAgICAgIHNhdmVkTWVzc2FnZSA9IGF3YWl0IHR4Lm1lc3NhZ2UudXBkYXRlKHtcbiAgICAgICAgd2hlcmU6IHsgaWQ6IGxhc3RNZXNzYWdlLmlkIH0sXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBjb250ZW50OiBtZXJnZWRDb250ZW50LFxuICAgICAgICAgIC4uLihidXR0b25QYXlsb2FkICE9IG51bGwgJiYgeyBidXR0b25QYXlsb2FkIH0pLFxuICAgICAgICAgIC4uLihtZWRpYSAmJiB7XG4gICAgICAgICAgICBtZWRpYToge1xuICAgICAgICAgICAgICBjcmVhdGU6IHtcbiAgICAgICAgICAgICAgICB0d2lsaW9Vcmw6IG1lZGlhLnR3aWxpb1VybCxcbiAgICAgICAgICAgICAgICBzZXJ2ZXJVcmw6IG1lZGlhLnNlcnZlclVybCxcbiAgICAgICAgICAgICAgICBtaW1lVHlwZTogbWVkaWEubWltZVR5cGUsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHNhdmVkTWVzc2FnZSA9IGF3YWl0IHR4Lm1lc3NhZ2UuY3JlYXRlKHtcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIGNvbnZlcnNhdGlvbklkLFxuICAgICAgICAgIHJvbGU6IE1lc3NhZ2VSb2xlLlVTRVIsXG4gICAgICAgICAgY29udGVudCxcbiAgICAgICAgICAuLi4oYnV0dG9uUGF5bG9hZCAhPSBudWxsICYmIHsgYnV0dG9uUGF5bG9hZCB9KSxcbiAgICAgICAgICAuLi4obWVkaWEgJiYge1xuICAgICAgICAgICAgbWVkaWE6IHtcbiAgICAgICAgICAgICAgY3JlYXRlOiB7XG4gICAgICAgICAgICAgICAgdHdpbGlvVXJsOiBtZWRpYS50d2lsaW9VcmwsXG4gICAgICAgICAgICAgICAgc2VydmVyVXJsOiBtZWRpYS5zZXJ2ZXJVcmwsXG4gICAgICAgICAgICAgICAgbWltZVR5cGU6IG1lZGlhLm1pbWVUeXBlLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IG1lc3NhZ2VzID0gYXdhaXQgdHgubWVzc2FnZVxuICAgICAgLmZpbmRNYW55KHtcbiAgICAgICAgd2hlcmU6IHtcbiAgICAgICAgICBjb252ZXJzYXRpb25JZCxcbiAgICAgICAgfSxcbiAgICAgICAgb3JkZXJCeTogeyBjcmVhdGVkQXQ6ICdkZXNjJyB9LFxuICAgICAgICB0YWtlOiAxMCxcbiAgICAgICAgc2VsZWN0OiB7XG4gICAgICAgICAgaWQ6IHRydWUsXG4gICAgICAgICAgcm9sZTogdHJ1ZSxcbiAgICAgICAgICBjb250ZW50OiB0cnVlLFxuICAgICAgICAgIGJ1dHRvblBheWxvYWQ6IHRydWUsXG4gICAgICAgICAgY3JlYXRlZEF0OiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfSlcbiAgICAgIC50aGVuKChtc2dzKSA9PiBtc2dzLnJldmVyc2UoKSk7XG5cbiAgICAvLyBSZXR1cm4gYm90aCBwZW5kaW5nIGFuZCBzZWxlY3RlZFRvbmFsaXR5IGZyb20gREIgKGZvciBmYWxsYmFjay9tZXJnZSlcbiAgICByZXR1cm4ge1xuICAgICAgc2F2ZWRNZXNzYWdlLFxuICAgICAgbWVzc2FnZXMsXG4gICAgICBwZW5kaW5nOiBwZW5kaW5nU3RhdGVEQixcbiAgICAgIHNlbGVjdGVkVG9uYWxpdHk6IHNlbGVjdGVkVG9uYWxpdHlEQixcbiAgICB9O1xuICB9KTtcblxuICBsb2dnZXIuZGVidWcoXG4gICAge1xuICAgICAgcGVuZGluZzogc3RhdGUucGVuZGluZyA/PyBkYlBlbmRpbmcsXG4gICAgICBzZWxlY3RlZFRvbmFsaXR5OiBzdGF0ZS5zZWxlY3RlZFRvbmFsaXR5ID8/IGRiU2VsZWN0ZWRUb25hbGl0eSA/PyBudWxsLFxuICAgICAgbWVzc2FnZXNDb3VudDogbWVzc2FnZXMubGVuZ3RoLFxuICAgIH0sXG4gICAgJ0luZ2VzdE1lc3NhZ2U6IEZpbmFsIHN0YXRlIGJlZm9yZSByZXR1cm5pbmcnLFxuICApO1xuXG4gIHF1ZXVlSW1hZ2VVcGxvYWQodXNlci5pZCwgc2F2ZWRNZXNzYWdlLmlkKTtcblxuICBjb25zdCBjb252ZXJzYXRpb25IaXN0b3J5V2l0aEltYWdlczogKFVzZXJNZXNzYWdlIHwgQXNzaXN0YW50TWVzc2FnZSlbXSA9IFtdO1xuICBjb25zdCBjb252ZXJzYXRpb25IaXN0b3J5VGV4dE9ubHk6IChVc2VyTWVzc2FnZSB8IEFzc2lzdGFudE1lc3NhZ2UpW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IG1zZyBvZiBtZXNzYWdlcykge1xuICAgIGNvbnN0IG1ldGEgPSB7XG4gICAgICBjcmVhdGVkQXQ6IG1zZy5jcmVhdGVkQXQsXG4gICAgICBtZXNzYWdlSWQ6IG1zZy5pZCxcbiAgICAgIC4uLihtc2cucm9sZSA9PT0gTWVzc2FnZVJvbGUuVVNFUiAmJiB7XG4gICAgICAgIGJ1dHRvblBheWxvYWQ6IG1zZy5idXR0b25QYXlsb2FkLFxuICAgICAgfSksXG4gICAgfTtcblxuICAgIGNvbnN0IGNvbnRlbnRXaXRoSW1hZ2UgPSBtc2cuY29udGVudCBhcyBNZXNzYWdlQ29udGVudDtcbiAgICBjb25zdCB0ZXh0Q29udGVudCA9IGV4dHJhY3RUZXh0Q29udGVudChjb250ZW50V2l0aEltYWdlKTtcblxuICAgIGlmIChtc2cucm9sZSA9PT0gTWVzc2FnZVJvbGUuVVNFUikge1xuICAgICAgY29uc3QgbWVzc2FnZVdpdGhJbWFnZSA9IG5ldyBVc2VyTWVzc2FnZShjb250ZW50V2l0aEltYWdlKTtcbiAgICAgIG1lc3NhZ2VXaXRoSW1hZ2UubWV0YSA9IG1ldGE7XG4gICAgICBjb252ZXJzYXRpb25IaXN0b3J5V2l0aEltYWdlcy5wdXNoKG1lc3NhZ2VXaXRoSW1hZ2UpO1xuXG4gICAgICBjb25zdCB0ZXh0T25seU1lc3NhZ2UgPSBuZXcgVXNlck1lc3NhZ2UodGV4dENvbnRlbnQpO1xuICAgICAgdGV4dE9ubHlNZXNzYWdlLm1ldGEgPSBtZXRhO1xuICAgICAgY29udmVyc2F0aW9uSGlzdG9yeVRleHRPbmx5LnB1c2godGV4dE9ubHlNZXNzYWdlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgYXNzaXN0YW50TWVzc2FnZSA9IG5ldyBBc3Npc3RhbnRNZXNzYWdlKHRleHRDb250ZW50KTtcbiAgICAgIGFzc2lzdGFudE1lc3NhZ2UubWV0YSA9IG1ldGE7XG4gICAgICBjb252ZXJzYXRpb25IaXN0b3J5V2l0aEltYWdlcy5wdXNoKGFzc2lzdGFudE1lc3NhZ2UpO1xuICAgICAgY29udmVyc2F0aW9uSGlzdG9yeVRleHRPbmx5LnB1c2goYXNzaXN0YW50TWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgbG9nZ2VyLmRlYnVnKHsgd2hhdHNhcHBJZCwgZ3JhcGhSdW5JZCB9LCAnTWVzc2FnZSBpbmdlc3RlZCBzdWNjZXNzZnVsbHknKTtcblxuICAvKipcbiAgICogVGhlIGtleTogUFJFRkVSIHRoZSBsYXRlc3QgY29tcHV0ZWQgc3RhdGUgZm9yIHBlbmRpbmcvc2VsZWN0ZWRUb25hbGl0eSAoZnJvbSByb3V0aW5nL2hhbmRsZXIpLlxuICAgKiBVc2UgZmFsbGJhY2sgZnJvbSBEQiBvbmx5IGlmIGhhbmRsZXIgZGlkIG5vdCBwcm92aWRlIHRoZW0uXG4gICAqL1xuICByZXR1cm4ge1xuICAgIC4uLnN0YXRlLFxuICAgIGNvbnZlcnNhdGlvbkhpc3RvcnlXaXRoSW1hZ2VzLFxuICAgIGNvbnZlcnNhdGlvbkhpc3RvcnlUZXh0T25seSxcbiAgICBwZW5kaW5nOiBzdGF0ZS5wZW5kaW5nID8/IGRiUGVuZGluZywgLy8gcHJpb3JpdGl6ZSBsYXRlc3QgbG9naWMvc3RhdGVcbiAgICBzZWxlY3RlZFRvbmFsaXR5OiBzdGF0ZS5zZWxlY3RlZFRvbmFsaXR5ID8/IGRiU2VsZWN0ZWRUb25hbGl0eSwgLy8gcHJpb3JpdGl6ZSBsYXRlc3QgbG9naWMvc3RhdGVcbiAgICB1c2VyLFxuICAgIGlucHV0LFxuICB9O1xufVxuIl19