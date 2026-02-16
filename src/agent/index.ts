import 'dotenv/config';

import { Conversation, GraphRunStatus, MessageRole, PendingType, Prisma } from '@prisma/client';
import { MessageInput } from '../lib/chat/types';
import { StateGraph } from '../lib/graph';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { getOrCreateUserAndConversation } from '../utils/context';
import { logError } from '../utils/errors';
import { logger } from '../utils/logger';
import { buildAgentGraph } from './graph';
import { GraphState } from './state';

let compiledApp: ReturnType<typeof StateGraph.prototype.compile> | null = null;
let subscriber: ReturnType<typeof redis.duplicate> | undefined;

const getUserAbortChannel = (id: string) => `user_abort:${id}`;

async function getSubscriber() {
  if (!subscriber || !subscriber.isOpen) {
    subscriber = redis.duplicate();
    await subscriber.connect();
  }
  return subscriber;
}

/**
 * Builds and compiles the agent's state graph. This function should be called
 * once at application startup.
 */
export async function initializeAgent(): Promise<void> {
  logger.info('Compiling agent graph...');
  try {
    compiledApp = buildAgentGraph();
    logger.info('Agent graph compiled successfully.');
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ err: error.message, stack: error.stack }, 'Agent graph compilation failed');
    throw error;
  }
}

async function loadPreviousConversationState(
  conversationId: string,
): Promise<Partial<GraphState> | null> {
  try {
    // Get the last successful graph run for this conversation
    const lastSuccessfulRun = await prisma.graphRun.findFirst({
      where: {
        conversationId,
        status: 'COMPLETED',
      },
      orderBy: {
        endTime: 'desc',
      },
    });

    if (!lastSuccessfulRun?.finalState) {
      return null;
    }

    // Return the final state, but exclude traceBuffer and httpResponse as they're not needed
    const state = lastSuccessfulRun.finalState as Partial<GraphState>;
    delete state.traceBuffer;
    delete state.httpResponse;

    // Reconstruct Date objects from serialized state (they come back as strings from JSON)
    if (state.user) {
      if (typeof state.user.lastVibeCheckAt === 'string') {
        state.user.lastVibeCheckAt = new Date(state.user.lastVibeCheckAt);
      }
      if (typeof state.user.lastColorAnalysisAt === 'string') {
        state.user.lastColorAnalysisAt = new Date(state.user.lastColorAnalysisAt);
      }
    }

    logger.debug(
      { conversationId, hasPreviousState: !!state.quizQuestions },
      'Loaded previous conversation state',
    );
    return state;
  } catch (err: unknown) {
    logger.error({ err, conversationId }, 'Failed to load previous conversation state');
    return null;
  }
}

async function logGraphResult(
  graphRunId: string,
  status: GraphRunStatus,
  finalState: Partial<GraphState> | null,
  error?: unknown,
): Promise<void> {
  try {
    const graphRun = await prisma.graphRun.findUnique({
      where: { id: graphRunId },
    });
    if (!graphRun) return;

    const endTime = new Date();
    const durationMs = endTime.getTime() - graphRun.startTime.getTime();

    if (finalState?.traceBuffer) {
      const { nodeRuns, llmTraces } = finalState.traceBuffer;

      if (nodeRuns.length > 0) {
        await prisma.nodeRun.createMany({
          data: nodeRuns.map((ne) => ({
            ...ne,
            graphRunId,
          })),
        });
      }

      if (llmTraces.length > 0) {
        await prisma.lLMTrace.createMany({
          data: llmTraces.map((lt) => ({
            ...lt,
          })),
        });
      }

      delete finalState.traceBuffer;
    }

    const getErrorTrace = (err: unknown): string => {
      if (err instanceof Error) {
        let trace = err.stack ?? err.message;
        if (err.cause) {
          trace += `\nCaused by: ${getErrorTrace(err.cause)}`;
        }
        return trace;
      }
      return String(err);
    };

    await prisma.graphRun.update({
      where: { id: graphRunId },
      data: {
        finalState: finalState as Prisma.InputJsonValue,
        status,
        errorTrace: error ? getErrorTrace(error) : null,
        endTime,
        durationMs,
      },
    });
  } catch (logErr: unknown) {
    logger.error(
      {
        err: logErr instanceof Error ? logErr.message : String(logErr),
        graphRunId,
      },
      'Failed to log graph result',
    );
  }
}

/**
 * Executes the agent graph for HTTP delivery. Returns replies and pending state.
 *
 * @param userId - The user identifier
 * @param messageId - The message identifier
 * @param input - The normalized message input
 */
export async function runAgentForHttp(
  userId: string,
  messageId: string,
  input: MessageInput,
): Promise<{ replies: NonNullable<GraphState['httpResponse']>; pending: GraphState['pending'] }> {
  const controller = new AbortController();
  const sub = await getSubscriber();
  const channel = getUserAbortChannel(userId);

  const listener = (message: string) => {
    if (message === messageId) {
      controller.abort();
    }
  };
  sub.subscribe(channel, listener);

  const { WaId: identifierId, ProfileName: profileName } = input;

  if (!identifierId) {
    throw new Error('User ID not found in message input');
  }

  if (!compiledApp) {
    throw new Error('Agent not initialized. Call initializeAgent() on startup.');
  }

  let conversation: Conversation | undefined;
  let finalState: Partial<GraphState> | null = null;
  const graphRunId = messageId;
  try {
    // In production, profileName is ignored - database values are never updated
    // Only pass it for development mode compatibility
    const { user, conversation: _conversation } = await getOrCreateUserAndConversation(
      identifierId,
      profileName ?? '',
      identifierId, // appUserId is the same as identifierId for initial user creation
    );
    conversation = _conversation;

    // Load previous conversation state
    const previousState = await loadPreviousConversationState(conversation.id);

    // Create serializable initial state (exclude non-serializable properties)
    const serializablePreviousState = previousState
      ? {
          quizQuestions: previousState.quizQuestions,
          quizAnswers: previousState.quizAnswers,
          currentQuestionIndex: previousState.currentQuestionIndex,
          pending: previousState.pending,
          selectedTonality: previousState.selectedTonality,
          intent: previousState.intent,
          subIntent: previousState.subIntent,
          assistantReply: previousState.assistantReply,
        }
      : {};

    await prisma.graphRun.create({
      data: {
        id: graphRunId,
        userId: user.id,
        conversationId: conversation.id,
        initialState: { input, user, ...serializablePreviousState } as Prisma.InputJsonValue,
      },
    });

    // Create initial state with input, merging only persistent data from previous state
    const initialState: GraphState = {
      input,
      user,
      graphRunId,
      conversationId: conversation.id,
      traceBuffer: { nodeRuns: [], llmTraces: [] },
      // Required properties with defaults
      conversationHistoryWithImages: [],
      conversationHistoryTextOnly: [],
      intent: null,
      stylingIntent: null,
      generalIntent: null,
      missingProfileField: null,
      availableServices: [],
      assistantReply: null,
      pending: null,
      selectedTonality: null,
      // Only merge persistent game state, not routing decisions
      ...(previousState
        ? {
            quizQuestions: previousState.quizQuestions,
            quizAnswers: previousState.quizAnswers,
            currentQuestionIndex: previousState.currentQuestionIndex,
          }
        : {}),
    };

    finalState = await compiledApp.invoke(initialState, {
      signal: controller.signal,
      runId: graphRunId,
    });
    logGraphResult(graphRunId, 'COMPLETED', finalState);

    const replies = (finalState?.httpResponse ?? []) as NonNullable<GraphState['httpResponse']>;
    return { replies, pending: finalState?.pending ?? null };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      logGraphResult(graphRunId, 'ABORTED', finalState, err);
      throw err;
    }

    logGraphResult(graphRunId, 'ERROR', finalState, err);

    const error = logError(err, {
      userId: identifierId,
      messageId,
      location: 'runAgentForHttp',
    });

    // For HTTP mode, we don't send error messages via external service
    // The error will be returned in the HTTP response
    if (conversation) {
      try {
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: MessageRole.AI,
            content: [
              {
                type: 'text',
                text: 'Sorry, something went wrong. Please try again later.',
              },
            ],
            pending: PendingType.NONE,
          },
        });
      } catch (dbErr: unknown) {
        logError(dbErr, {
          userId: identifierId,
          messageId,
          location: 'runAgentForHttp.saveErrorMessage',
          originalError: error.message,
        });
      }
    }
    throw error;
  } finally {
    await sub.unsubscribe(channel);
  }
}
