"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeAgent = initializeAgent;
exports.runAgent = runAgent;
require("dotenv/config");
const client_1 = require("@prisma/client");
const prisma_1 = require("../lib/prisma");
const redis_1 = require("../lib/redis");
const twilio_1 = require("../lib/twilio");
const context_1 = require("../utils/context");
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
const graph_1 = require("./graph");
let compiledApp = null;
let subscriber;
const getUserAbortChannel = (id) => `user_abort:${id}`;
async function getSubscriber() {
    if (!subscriber || !subscriber.isOpen) {
        subscriber = redis_1.redis.duplicate();
        await subscriber.connect();
    }
    return subscriber;
}
async function initializeAgent() {
    logger_1.logger.info('Compiling agent graph...');
    try {
        compiledApp = (0, graph_1.buildAgentGraph)();
        logger_1.logger.info('Agent graph compiled successfully.');
    }
    catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger_1.logger.error({ err: error.message, stack: error.stack }, 'Agent graph compilation failed');
        throw error;
    }
}
async function logGraphResult(graphRunId, status, finalState, error) {
    try {
        const graphRun = await prisma_1.prisma.graphRun.findUnique({
            where: { id: graphRunId },
        });
        if (!graphRun)
            return;
        const endTime = new Date();
        const durationMs = endTime.getTime() - graphRun.startTime.getTime();
        if (finalState?.traceBuffer) {
            const { nodeRuns, llmTraces } = finalState.traceBuffer;
            if (nodeRuns.length > 0) {
                await prisma_1.prisma.nodeRun.createMany({
                    data: nodeRuns.map((ne) => ({
                        ...ne,
                        graphRunId,
                    })),
                });
            }
            if (llmTraces.length > 0) {
                await prisma_1.prisma.lLMTrace.createMany({
                    data: llmTraces.map((lt) => ({
                        ...lt,
                    })),
                });
            }
            delete finalState.traceBuffer;
        }
        const getErrorTrace = (err) => {
            if (err instanceof Error) {
                let trace = err.stack ?? err.message;
                if (err.cause) {
                    trace += `\nCaused by: ${getErrorTrace(err.cause)}`;
                }
                return trace;
            }
            return String(err);
        };
        await prisma_1.prisma.graphRun.update({
            where: { id: graphRunId },
            data: {
                finalState: finalState,
                status,
                errorTrace: error ? getErrorTrace(error) : null,
                endTime,
                durationMs,
            },
        });
    }
    catch (logErr) {
        logger_1.logger.error({
            err: logErr instanceof Error ? logErr.message : String(logErr),
            graphRunId,
        }, 'Failed to log graph result');
    }
}
async function runAgent(userId, messageId, input) {
    const controller = new AbortController();
    const sub = await getSubscriber();
    const channel = getUserAbortChannel(userId);
    const listener = (message) => {
        if (message === messageId) {
            controller.abort();
        }
    };
    sub.subscribe(channel, listener);
    const { WaId: whatsappId, ProfileName: profileName } = input;
    if (!whatsappId) {
        throw new Error('Whatsapp ID not found in webhook payload');
    }
    if (!compiledApp) {
        throw new Error('Agent not initialized. Call initializeAgent() on startup.');
    }
    let conversation;
    let finalState = null;
    const graphRunId = messageId;
    try {
        const { user, conversation: _conversation } = await (0, context_1.getOrCreateUserAndConversation)(whatsappId, profileName ?? '');
        conversation = _conversation;
        await prisma_1.prisma.graphRun.create({
            data: {
                id: graphRunId,
                userId: user.id,
                conversationId: conversation.id,
                initialState: { input, user },
            },
        });
        finalState = await compiledApp.invoke({
            input,
            user,
            graphRunId,
            conversationId: conversation.id,
            traceBuffer: { nodeRuns: [], llmTraces: [] },
        }, { signal: controller.signal, runId: graphRunId });
        logGraphResult(graphRunId, 'COMPLETED', finalState);
    }
    catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            logGraphResult(graphRunId, 'ABORTED', finalState, err);
            throw err;
        }
        logGraphResult(graphRunId, 'ERROR', finalState, err);
        const error = (0, errors_1.logError)(err, {
            whatsappId,
            messageId,
            location: 'runAgent',
        });
        try {
            await (0, twilio_1.sendText)(whatsappId, 'Sorry, something went wrong. Please try again later.');
            if (conversation) {
                await prisma_1.prisma.message.create({
                    data: {
                        conversationId: conversation.id,
                        role: client_1.MessageRole.AI,
                        content: [
                            {
                                type: 'text',
                                text: 'Sorry, something went wrong. Please try again later.',
                            },
                        ],
                        pending: client_1.PendingType.NONE,
                    },
                });
            }
        }
        catch (sendErr) {
            (0, errors_1.logError)(sendErr, {
                whatsappId,
                messageId,
                location: 'runAgent.sendTextFallback',
                originalError: error.message,
            });
        }
        throw error;
    }
    finally {
        await sub.unsubscribe(channel);
    }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9pbmRleC50cyIsInNvdXJjZXMiOlsiL3Vzci9zcmMvYXBwL3NyYy9hZ2VudC9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQStCQSwwQ0FVQztBQThFRCw0QkFpR0M7QUF4TkQseUJBQXVCO0FBRXZCLDJDQUFnRztBQUVoRywwQ0FBdUM7QUFDdkMsd0NBQXFDO0FBQ3JDLDBDQUF5QztBQUV6Qyw4Q0FBa0U7QUFDbEUsNENBQTJDO0FBQzNDLDRDQUF5QztBQUN6QyxtQ0FBMEM7QUFHMUMsSUFBSSxXQUFXLEdBQTJELElBQUksQ0FBQztBQUMvRSxJQUFJLFVBQTBELENBQUM7QUFFL0QsTUFBTSxtQkFBbUIsR0FBRyxDQUFDLEVBQVUsRUFBRSxFQUFFLENBQUMsY0FBYyxFQUFFLEVBQUUsQ0FBQztBQUUvRCxLQUFLLFVBQVUsYUFBYTtJQUMxQixJQUFJLENBQUMsVUFBVSxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ3RDLFVBQVUsR0FBRyxhQUFLLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDL0IsTUFBTSxVQUFVLENBQUMsT0FBTyxFQUFFLENBQUM7SUFDN0IsQ0FBQztJQUNELE9BQU8sVUFBVSxDQUFDO0FBQ3BCLENBQUM7QUFNTSxLQUFLLFVBQVUsZUFBZTtJQUNuQyxlQUFNLENBQUMsSUFBSSxDQUFDLDBCQUEwQixDQUFDLENBQUM7SUFDeEMsSUFBSSxDQUFDO1FBQ0gsV0FBVyxHQUFHLElBQUEsdUJBQWUsR0FBRSxDQUFDO1FBQ2hDLGVBQU0sQ0FBQyxJQUFJLENBQUMsb0NBQW9DLENBQUMsQ0FBQztJQUNwRCxDQUFDO0lBQUMsT0FBTyxHQUFZLEVBQUUsQ0FBQztRQUN0QixNQUFNLEtBQUssR0FBRyxHQUFHLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ2xFLGVBQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxHQUFHLEVBQUUsS0FBSyxDQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLGdDQUFnQyxDQUFDLENBQUM7UUFDM0YsTUFBTSxLQUFLLENBQUM7SUFDZCxDQUFDO0FBQ0gsQ0FBQztBQUVELEtBQUssVUFBVSxjQUFjLENBQzNCLFVBQWtCLEVBQ2xCLE1BQXNCLEVBQ3RCLFVBQXNDLEVBQ3RDLEtBQWU7SUFFZixJQUFJLENBQUM7UUFDSCxNQUFNLFFBQVEsR0FBRyxNQUFNLGVBQU0sQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDO1lBQ2hELEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRSxVQUFVLEVBQUU7U0FDMUIsQ0FBQyxDQUFDO1FBQ0gsSUFBSSxDQUFDLFFBQVE7WUFBRSxPQUFPO1FBRXRCLE1BQU0sT0FBTyxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7UUFDM0IsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLE9BQU8sRUFBRSxHQUFHLFFBQVEsQ0FBQyxTQUFTLENBQUMsT0FBTyxFQUFFLENBQUM7UUFFcEUsSUFBSSxVQUFVLEVBQUUsV0FBVyxFQUFFLENBQUM7WUFDNUIsTUFBTSxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsR0FBRyxVQUFVLENBQUMsV0FBVyxDQUFDO1lBRXZELElBQUksUUFBUSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDeEIsTUFBTSxlQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQztvQkFDOUIsSUFBSSxFQUFFLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUM7d0JBQzFCLEdBQUcsRUFBRTt3QkFDTCxVQUFVO3FCQUNYLENBQUMsQ0FBQztpQkFDSixDQUFDLENBQUM7WUFDTCxDQUFDO1lBRUQsSUFBSSxTQUFTLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUN6QixNQUFNLGVBQU0sQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDO29CQUMvQixJQUFJLEVBQUUsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQzt3QkFDM0IsR0FBRyxFQUFFO3FCQUNOLENBQUMsQ0FBQztpQkFDSixDQUFDLENBQUM7WUFDTCxDQUFDO1lBRUQsT0FBTyxVQUFVLENBQUMsV0FBVyxDQUFDO1FBQ2hDLENBQUM7UUFFRCxNQUFNLGFBQWEsR0FBRyxDQUFDLEdBQVksRUFBVSxFQUFFO1lBQzdDLElBQUksR0FBRyxZQUFZLEtBQUssRUFBRSxDQUFDO2dCQUN6QixJQUFJLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxJQUFJLEdBQUcsQ0FBQyxPQUFPLENBQUM7Z0JBQ3JDLElBQUksR0FBRyxDQUFDLEtBQUssRUFBRSxDQUFDO29CQUNkLEtBQUssSUFBSSxnQkFBZ0IsYUFBYSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUN0RCxDQUFDO2dCQUNELE9BQU8sS0FBSyxDQUFDO1lBQ2YsQ0FBQztZQUNELE9BQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3JCLENBQUMsQ0FBQztRQUVGLE1BQU0sZUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUM7WUFDM0IsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFLFVBQVUsRUFBRTtZQUN6QixJQUFJLEVBQUU7Z0JBQ0osVUFBVSxFQUFFLFVBQW1DO2dCQUMvQyxNQUFNO2dCQUNOLFVBQVUsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSTtnQkFDL0MsT0FBTztnQkFDUCxVQUFVO2FBQ1g7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDO0lBQUMsT0FBTyxNQUFlLEVBQUUsQ0FBQztRQUN6QixlQUFNLENBQUMsS0FBSyxDQUNWO1lBQ0UsR0FBRyxFQUFFLE1BQU0sWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUM7WUFDOUQsVUFBVTtTQUNYLEVBQ0QsNEJBQTRCLENBQzdCLENBQUM7SUFDSixDQUFDO0FBQ0gsQ0FBQztBQVFNLEtBQUssVUFBVSxRQUFRLENBQzVCLE1BQWMsRUFDZCxTQUFpQixFQUNqQixLQUEyQjtJQUUzQixNQUFNLFVBQVUsR0FBRyxJQUFJLGVBQWUsRUFBRSxDQUFDO0lBQ3pDLE1BQU0sR0FBRyxHQUFHLE1BQU0sYUFBYSxFQUFFLENBQUM7SUFDbEMsTUFBTSxPQUFPLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxDQUFDLENBQUM7SUFFNUMsTUFBTSxRQUFRLEdBQUcsQ0FBQyxPQUFlLEVBQUUsRUFBRTtRQUNuQyxJQUFJLE9BQU8sS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUMxQixVQUFVLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDckIsQ0FBQztJQUNILENBQUMsQ0FBQztJQUNGLEdBQUcsQ0FBQyxTQUFTLENBQUMsT0FBTyxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBRWpDLE1BQU0sRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLFdBQVcsRUFBRSxXQUFXLEVBQUUsR0FBRyxLQUFLLENBQUM7SUFFN0QsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ2hCLE1BQU0sSUFBSSxLQUFLLENBQUMsMENBQTBDLENBQUMsQ0FBQztJQUM5RCxDQUFDO0lBRUQsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQ2pCLE1BQU0sSUFBSSxLQUFLLENBQUMsMkRBQTJELENBQUMsQ0FBQztJQUMvRSxDQUFDO0lBRUQsSUFBSSxZQUFzQyxDQUFDO0lBQzNDLElBQUksVUFBVSxHQUErQixJQUFJLENBQUM7SUFDbEQsTUFBTSxVQUFVLEdBQUcsU0FBUyxDQUFDO0lBQzdCLElBQUksQ0FBQztRQUNILE1BQU0sRUFBRSxJQUFJLEVBQUUsWUFBWSxFQUFFLGFBQWEsRUFBRSxHQUFHLE1BQU0sSUFBQSx3Q0FBOEIsRUFDaEYsVUFBVSxFQUNWLFdBQVcsSUFBSSxFQUFFLENBQ2xCLENBQUM7UUFDRixZQUFZLEdBQUcsYUFBYSxDQUFDO1FBRTdCLE1BQU0sZUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUM7WUFDM0IsSUFBSSxFQUFFO2dCQUNKLEVBQUUsRUFBRSxVQUFVO2dCQUNkLE1BQU0sRUFBRSxJQUFJLENBQUMsRUFBRTtnQkFDZixjQUFjLEVBQUUsWUFBWSxDQUFDLEVBQUU7Z0JBQy9CLFlBQVksRUFBRSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUU7YUFDOUI7U0FDRixDQUFDLENBQUM7UUFFSCxVQUFVLEdBQUcsTUFBTSxXQUFXLENBQUMsTUFBTSxDQUNuQztZQUNFLEtBQUs7WUFDTCxJQUFJO1lBQ0osVUFBVTtZQUNWLGNBQWMsRUFBRSxZQUFZLENBQUMsRUFBRTtZQUMvQixXQUFXLEVBQUUsRUFBRSxRQUFRLEVBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRSxFQUFFLEVBQUU7U0FDN0MsRUFDRCxFQUFFLE1BQU0sRUFBRSxVQUFVLENBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsQ0FDakQsQ0FBQztRQUNGLGNBQWMsQ0FBQyxVQUFVLEVBQUUsV0FBVyxFQUFFLFVBQVUsQ0FBQyxDQUFDO0lBQ3RELENBQUM7SUFBQyxPQUFPLEdBQVksRUFBRSxDQUFDO1FBQ3RCLElBQUksR0FBRyxZQUFZLEtBQUssSUFBSSxHQUFHLENBQUMsSUFBSSxLQUFLLFlBQVksRUFBRSxDQUFDO1lBQ3RELGNBQWMsQ0FBQyxVQUFVLEVBQUUsU0FBUyxFQUFFLFVBQVUsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUN2RCxNQUFNLEdBQUcsQ0FBQztRQUNaLENBQUM7UUFDRCxjQUFjLENBQUMsVUFBVSxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsR0FBRyxDQUFDLENBQUM7UUFFckQsTUFBTSxLQUFLLEdBQUcsSUFBQSxpQkFBUSxFQUFDLEdBQUcsRUFBRTtZQUMxQixVQUFVO1lBQ1YsU0FBUztZQUNULFFBQVEsRUFBRSxVQUFVO1NBQ3JCLENBQUMsQ0FBQztRQUNILElBQUksQ0FBQztZQUNILE1BQU0sSUFBQSxpQkFBUSxFQUFDLFVBQVUsRUFBRSxzREFBc0QsQ0FBQyxDQUFDO1lBQ25GLElBQUksWUFBWSxFQUFFLENBQUM7Z0JBQ2pCLE1BQU0sZUFBTSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUM7b0JBQzFCLElBQUksRUFBRTt3QkFDSixjQUFjLEVBQUUsWUFBWSxDQUFDLEVBQUU7d0JBQy9CLElBQUksRUFBRSxvQkFBVyxDQUFDLEVBQUU7d0JBQ3BCLE9BQU8sRUFBRTs0QkFDUDtnQ0FDRSxJQUFJLEVBQUUsTUFBTTtnQ0FDWixJQUFJLEVBQUUsc0RBQXNEOzZCQUM3RDt5QkFDRjt3QkFDRCxPQUFPLEVBQUUsb0JBQVcsQ0FBQyxJQUFJO3FCQUMxQjtpQkFDRixDQUFDLENBQUM7WUFDTCxDQUFDO1FBQ0gsQ0FBQztRQUFDLE9BQU8sT0FBZ0IsRUFBRSxDQUFDO1lBQzFCLElBQUEsaUJBQVEsRUFBQyxPQUFPLEVBQUU7Z0JBQ2hCLFVBQVU7Z0JBQ1YsU0FBUztnQkFDVCxRQUFRLEVBQUUsMkJBQTJCO2dCQUNyQyxhQUFhLEVBQUUsS0FBSyxDQUFDLE9BQU87YUFDN0IsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztRQUNELE1BQU0sS0FBSyxDQUFDO0lBQ2QsQ0FBQztZQUFTLENBQUM7UUFDVCxNQUFNLEdBQUcsQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDakMsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgJ2RvdGVudi9jb25maWcnO1xuXG5pbXBvcnQgeyBDb252ZXJzYXRpb24sIEdyYXBoUnVuU3RhdHVzLCBNZXNzYWdlUm9sZSwgUGVuZGluZ1R5cGUsIFByaXNtYSB9IGZyb20gJ0BwcmlzbWEvY2xpZW50JztcbmltcG9ydCB7IFN0YXRlR3JhcGggfSBmcm9tICcuLi9saWIvZ3JhcGgnO1xuaW1wb3J0IHsgcHJpc21hIH0gZnJvbSAnLi4vbGliL3ByaXNtYSc7XG5pbXBvcnQgeyByZWRpcyB9IGZyb20gJy4uL2xpYi9yZWRpcyc7XG5pbXBvcnQgeyBzZW5kVGV4dCB9IGZyb20gJy4uL2xpYi90d2lsaW8nO1xuaW1wb3J0IHsgVHdpbGlvV2ViaG9va1JlcXVlc3QgfSBmcm9tICcuLi9saWIvdHdpbGlvL3R5cGVzJztcbmltcG9ydCB7IGdldE9yQ3JlYXRlVXNlckFuZENvbnZlcnNhdGlvbiB9IGZyb20gJy4uL3V0aWxzL2NvbnRleHQnO1xuaW1wb3J0IHsgbG9nRXJyb3IgfSBmcm9tICcuLi91dGlscy9lcnJvcnMnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vdXRpbHMvbG9nZ2VyJztcbmltcG9ydCB7IGJ1aWxkQWdlbnRHcmFwaCB9IGZyb20gJy4vZ3JhcGgnO1xuaW1wb3J0IHsgR3JhcGhTdGF0ZSB9IGZyb20gJy4vc3RhdGUnO1xuXG5sZXQgY29tcGlsZWRBcHA6IFJldHVyblR5cGU8dHlwZW9mIFN0YXRlR3JhcGgucHJvdG90eXBlLmNvbXBpbGU+IHwgbnVsbCA9IG51bGw7XG5sZXQgc3Vic2NyaWJlcjogUmV0dXJuVHlwZTx0eXBlb2YgcmVkaXMuZHVwbGljYXRlPiB8IHVuZGVmaW5lZDtcblxuY29uc3QgZ2V0VXNlckFib3J0Q2hhbm5lbCA9IChpZDogc3RyaW5nKSA9PiBgdXNlcl9hYm9ydDoke2lkfWA7XG5cbmFzeW5jIGZ1bmN0aW9uIGdldFN1YnNjcmliZXIoKSB7XG4gIGlmICghc3Vic2NyaWJlciB8fCAhc3Vic2NyaWJlci5pc09wZW4pIHtcbiAgICBzdWJzY3JpYmVyID0gcmVkaXMuZHVwbGljYXRlKCk7XG4gICAgYXdhaXQgc3Vic2NyaWJlci5jb25uZWN0KCk7XG4gIH1cbiAgcmV0dXJuIHN1YnNjcmliZXI7XG59XG5cbi8qKlxuICogQnVpbGRzIGFuZCBjb21waWxlcyB0aGUgYWdlbnQncyBzdGF0ZSBncmFwaC4gVGhpcyBmdW5jdGlvbiBzaG91bGQgYmUgY2FsbGVkXG4gKiBvbmNlIGF0IGFwcGxpY2F0aW9uIHN0YXJ0dXAuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBpbml0aWFsaXplQWdlbnQoKTogUHJvbWlzZTx2b2lkPiB7XG4gIGxvZ2dlci5pbmZvKCdDb21waWxpbmcgYWdlbnQgZ3JhcGguLi4nKTtcbiAgdHJ5IHtcbiAgICBjb21waWxlZEFwcCA9IGJ1aWxkQWdlbnRHcmFwaCgpO1xuICAgIGxvZ2dlci5pbmZvKCdBZ2VudCBncmFwaCBjb21waWxlZCBzdWNjZXNzZnVsbHkuJyk7XG4gIH0gY2F0Y2ggKGVycjogdW5rbm93bikge1xuICAgIGNvbnN0IGVycm9yID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIgOiBuZXcgRXJyb3IoU3RyaW5nKGVycikpO1xuICAgIGxvZ2dlci5lcnJvcih7IGVycjogZXJyb3IubWVzc2FnZSwgc3RhY2s6IGVycm9yLnN0YWNrIH0sICdBZ2VudCBncmFwaCBjb21waWxhdGlvbiBmYWlsZWQnKTtcbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBsb2dHcmFwaFJlc3VsdChcbiAgZ3JhcGhSdW5JZDogc3RyaW5nLFxuICBzdGF0dXM6IEdyYXBoUnVuU3RhdHVzLFxuICBmaW5hbFN0YXRlOiBQYXJ0aWFsPEdyYXBoU3RhdGU+IHwgbnVsbCxcbiAgZXJyb3I/OiB1bmtub3duLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIHRyeSB7XG4gICAgY29uc3QgZ3JhcGhSdW4gPSBhd2FpdCBwcmlzbWEuZ3JhcGhSdW4uZmluZFVuaXF1ZSh7XG4gICAgICB3aGVyZTogeyBpZDogZ3JhcGhSdW5JZCB9LFxuICAgIH0pO1xuICAgIGlmICghZ3JhcGhSdW4pIHJldHVybjtcblxuICAgIGNvbnN0IGVuZFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgIGNvbnN0IGR1cmF0aW9uTXMgPSBlbmRUaW1lLmdldFRpbWUoKSAtIGdyYXBoUnVuLnN0YXJ0VGltZS5nZXRUaW1lKCk7XG5cbiAgICBpZiAoZmluYWxTdGF0ZT8udHJhY2VCdWZmZXIpIHtcbiAgICAgIGNvbnN0IHsgbm9kZVJ1bnMsIGxsbVRyYWNlcyB9ID0gZmluYWxTdGF0ZS50cmFjZUJ1ZmZlcjtcblxuICAgICAgaWYgKG5vZGVSdW5zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgYXdhaXQgcHJpc21hLm5vZGVSdW4uY3JlYXRlTWFueSh7XG4gICAgICAgICAgZGF0YTogbm9kZVJ1bnMubWFwKChuZSkgPT4gKHtcbiAgICAgICAgICAgIC4uLm5lLFxuICAgICAgICAgICAgZ3JhcGhSdW5JZCxcbiAgICAgICAgICB9KSksXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBpZiAobGxtVHJhY2VzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgYXdhaXQgcHJpc21hLmxMTVRyYWNlLmNyZWF0ZU1hbnkoe1xuICAgICAgICAgIGRhdGE6IGxsbVRyYWNlcy5tYXAoKGx0KSA9PiAoe1xuICAgICAgICAgICAgLi4ubHQsXG4gICAgICAgICAgfSkpLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgZGVsZXRlIGZpbmFsU3RhdGUudHJhY2VCdWZmZXI7XG4gICAgfVxuXG4gICAgY29uc3QgZ2V0RXJyb3JUcmFjZSA9IChlcnI6IHVua25vd24pOiBzdHJpbmcgPT4ge1xuICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIGxldCB0cmFjZSA9IGVyci5zdGFjayA/PyBlcnIubWVzc2FnZTtcbiAgICAgICAgaWYgKGVyci5jYXVzZSkge1xuICAgICAgICAgIHRyYWNlICs9IGBcXG5DYXVzZWQgYnk6ICR7Z2V0RXJyb3JUcmFjZShlcnIuY2F1c2UpfWA7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRyYWNlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIFN0cmluZyhlcnIpO1xuICAgIH07XG5cbiAgICBhd2FpdCBwcmlzbWEuZ3JhcGhSdW4udXBkYXRlKHtcbiAgICAgIHdoZXJlOiB7IGlkOiBncmFwaFJ1bklkIH0sXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGZpbmFsU3RhdGU6IGZpbmFsU3RhdGUgYXMgUHJpc21hLklucHV0SnNvblZhbHVlLFxuICAgICAgICBzdGF0dXMsXG4gICAgICAgIGVycm9yVHJhY2U6IGVycm9yID8gZ2V0RXJyb3JUcmFjZShlcnJvcikgOiBudWxsLFxuICAgICAgICBlbmRUaW1lLFxuICAgICAgICBkdXJhdGlvbk1zLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSBjYXRjaCAobG9nRXJyOiB1bmtub3duKSB7XG4gICAgbG9nZ2VyLmVycm9yKFxuICAgICAge1xuICAgICAgICBlcnI6IGxvZ0VyciBpbnN0YW5jZW9mIEVycm9yID8gbG9nRXJyLm1lc3NhZ2UgOiBTdHJpbmcobG9nRXJyKSxcbiAgICAgICAgZ3JhcGhSdW5JZCxcbiAgICAgIH0sXG4gICAgICAnRmFpbGVkIHRvIGxvZyBncmFwaCByZXN1bHQnLFxuICAgICk7XG4gIH1cbn1cblxuLyoqXG4gKiBFeGVjdXRlcyB0aGUgYWdlbnQgZ3JhcGggZm9yIGEgc2luZ2xlIG1lc3NhZ2Ugd2l0aCBwcm9wZXIgZXJyb3IgaGFuZGxpbmcgYW5kIGFib3J0IHN1cHBvcnQuXG4gKlxuICogQHBhcmFtIGlucHV0IC0gUmF3IFR3aWxpbyB3ZWJob29rIHBheWxvYWQgY29udGFpbmluZyBtZXNzYWdlIGRhdGFcbiAqIEBwYXJhbSBvcHRpb25zIC0gT3B0aW9uYWwgY29uZmlndXJhdGlvbiBpbmNsdWRpbmcgYWJvcnQgc2lnbmFsXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5BZ2VudChcbiAgdXNlcklkOiBzdHJpbmcsXG4gIG1lc3NhZ2VJZDogc3RyaW5nLFxuICBpbnB1dDogVHdpbGlvV2ViaG9va1JlcXVlc3QsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgY29uc3Qgc3ViID0gYXdhaXQgZ2V0U3Vic2NyaWJlcigpO1xuICBjb25zdCBjaGFubmVsID0gZ2V0VXNlckFib3J0Q2hhbm5lbCh1c2VySWQpO1xuXG4gIGNvbnN0IGxpc3RlbmVyID0gKG1lc3NhZ2U6IHN0cmluZykgPT4ge1xuICAgIGlmIChtZXNzYWdlID09PSBtZXNzYWdlSWQpIHtcbiAgICAgIGNvbnRyb2xsZXIuYWJvcnQoKTtcbiAgICB9XG4gIH07XG4gIHN1Yi5zdWJzY3JpYmUoY2hhbm5lbCwgbGlzdGVuZXIpO1xuXG4gIGNvbnN0IHsgV2FJZDogd2hhdHNhcHBJZCwgUHJvZmlsZU5hbWU6IHByb2ZpbGVOYW1lIH0gPSBpbnB1dDtcblxuICBpZiAoIXdoYXRzYXBwSWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1doYXRzYXBwIElEIG5vdCBmb3VuZCBpbiB3ZWJob29rIHBheWxvYWQnKTtcbiAgfVxuXG4gIGlmICghY29tcGlsZWRBcHApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0FnZW50IG5vdCBpbml0aWFsaXplZC4gQ2FsbCBpbml0aWFsaXplQWdlbnQoKSBvbiBzdGFydHVwLicpO1xuICB9XG5cbiAgbGV0IGNvbnZlcnNhdGlvbjogQ29udmVyc2F0aW9uIHwgdW5kZWZpbmVkO1xuICBsZXQgZmluYWxTdGF0ZTogUGFydGlhbDxHcmFwaFN0YXRlPiB8IG51bGwgPSBudWxsO1xuICBjb25zdCBncmFwaFJ1bklkID0gbWVzc2FnZUlkO1xuICB0cnkge1xuICAgIGNvbnN0IHsgdXNlciwgY29udmVyc2F0aW9uOiBfY29udmVyc2F0aW9uIH0gPSBhd2FpdCBnZXRPckNyZWF0ZVVzZXJBbmRDb252ZXJzYXRpb24oXG4gICAgICB3aGF0c2FwcElkLFxuICAgICAgcHJvZmlsZU5hbWUgPz8gJycsXG4gICAgKTtcbiAgICBjb252ZXJzYXRpb24gPSBfY29udmVyc2F0aW9uO1xuXG4gICAgYXdhaXQgcHJpc21hLmdyYXBoUnVuLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7XG4gICAgICAgIGlkOiBncmFwaFJ1bklkLFxuICAgICAgICB1c2VySWQ6IHVzZXIuaWQsXG4gICAgICAgIGNvbnZlcnNhdGlvbklkOiBjb252ZXJzYXRpb24uaWQsXG4gICAgICAgIGluaXRpYWxTdGF0ZTogeyBpbnB1dCwgdXNlciB9LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGZpbmFsU3RhdGUgPSBhd2FpdCBjb21waWxlZEFwcC5pbnZva2UoXG4gICAgICB7XG4gICAgICAgIGlucHV0LFxuICAgICAgICB1c2VyLFxuICAgICAgICBncmFwaFJ1bklkLFxuICAgICAgICBjb252ZXJzYXRpb25JZDogY29udmVyc2F0aW9uLmlkLFxuICAgICAgICB0cmFjZUJ1ZmZlcjogeyBub2RlUnVuczogW10sIGxsbVRyYWNlczogW10gfSxcbiAgICAgIH0sXG4gICAgICB7IHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsIHJ1bklkOiBncmFwaFJ1bklkIH0sXG4gICAgKTtcbiAgICBsb2dHcmFwaFJlc3VsdChncmFwaFJ1bklkLCAnQ09NUExFVEVEJywgZmluYWxTdGF0ZSk7XG4gIH0gY2F0Y2ggKGVycjogdW5rbm93bikge1xuICAgIGlmIChlcnIgaW5zdGFuY2VvZiBFcnJvciAmJiBlcnIubmFtZSA9PT0gJ0Fib3J0RXJyb3InKSB7XG4gICAgICBsb2dHcmFwaFJlc3VsdChncmFwaFJ1bklkLCAnQUJPUlRFRCcsIGZpbmFsU3RhdGUsIGVycik7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICAgIGxvZ0dyYXBoUmVzdWx0KGdyYXBoUnVuSWQsICdFUlJPUicsIGZpbmFsU3RhdGUsIGVycik7XG5cbiAgICBjb25zdCBlcnJvciA9IGxvZ0Vycm9yKGVyciwge1xuICAgICAgd2hhdHNhcHBJZCxcbiAgICAgIG1lc3NhZ2VJZCxcbiAgICAgIGxvY2F0aW9uOiAncnVuQWdlbnQnLFxuICAgIH0pO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzZW5kVGV4dCh3aGF0c2FwcElkLCAnU29ycnksIHNvbWV0aGluZyB3ZW50IHdyb25nLiBQbGVhc2UgdHJ5IGFnYWluIGxhdGVyLicpO1xuICAgICAgaWYgKGNvbnZlcnNhdGlvbikge1xuICAgICAgICBhd2FpdCBwcmlzbWEubWVzc2FnZS5jcmVhdGUoe1xuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIGNvbnZlcnNhdGlvbklkOiBjb252ZXJzYXRpb24uaWQsXG4gICAgICAgICAgICByb2xlOiBNZXNzYWdlUm9sZS5BSSxcbiAgICAgICAgICAgIGNvbnRlbnQ6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIHR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgICAgICB0ZXh0OiAnU29ycnksIHNvbWV0aGluZyB3ZW50IHdyb25nLiBQbGVhc2UgdHJ5IGFnYWluIGxhdGVyLicsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcGVuZGluZzogUGVuZGluZ1R5cGUuTk9ORSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChzZW5kRXJyOiB1bmtub3duKSB7XG4gICAgICBsb2dFcnJvcihzZW5kRXJyLCB7XG4gICAgICAgIHdoYXRzYXBwSWQsXG4gICAgICAgIG1lc3NhZ2VJZCxcbiAgICAgICAgbG9jYXRpb246ICdydW5BZ2VudC5zZW5kVGV4dEZhbGxiYWNrJyxcbiAgICAgICAgb3JpZ2luYWxFcnJvcjogZXJyb3IubWVzc2FnZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgICB0aHJvdyBlcnJvcjtcbiAgfSBmaW5hbGx5IHtcbiAgICBhd2FpdCBzdWIudW5zdWJzY3JpYmUoY2hhbm5lbCk7XG4gIH1cbn1cbiJdfQ==