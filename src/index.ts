import 'dotenv/config';

import { registerProcessGuards } from './lib/processGuards';

registerProcessGuards();

import cors from 'cors';
import { randomUUID } from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import path from 'path';

import { initializeAgent, runAgentForHttp } from './agent';
import { ChatRequest, chatRequestToMessageInput } from './lib/chat/types';
import { connectPrisma, prisma } from './lib/prisma';
import { connectRedis, getRedisHealthSnapshot } from './lib/redis';
import { errorHandler } from './middleware/errors';
import { requestLogger } from './middleware/requestLogger';
import { sanitizeChatRequestForLog, sanitizeChatResponseForLog } from './utils/apiLogPayload';
import { clearUploadsDirectory } from './utils/clearUploads';
import { getOrCreateUserAndConversation } from './utils/context';
import { dbLog } from './utils/dbLogger';
import { logger } from './utils/logger';
import { ensureDir, staticUploadsMount } from './utils/paths';
import { getServerUrlBase } from './utils/serverUrl';
import analyticsRouter from './routes/analytics';
import { analyticsService } from './services/analyticsService';

/** Purge container-local upload files periodically (see scripts/clear-uploads.mjs for manual run). */
const UPLOADS_PURGE_INTERVAL_MS = 30 * 60 * 1000;

const app = express();
app.set('trust proxy', true);

app.use(requestLogger);

app.use(
  cors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ): void => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) {
        callback(null, true);
        return;
      }
      if (
        /^http:\/\/localhost(:\d+)?$/.test(origin) ||
        /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)
      ) {
        callback(null, true);
        return;
      }
      const serverUrl = getServerUrlBase();
      if (serverUrl && origin) {
        // Extract origin from serverUrl (protocol + hostname + port)
        const serverOriginMatch = serverUrl.match(/^(https?:\/\/[^\/]+)/);
        if (serverOriginMatch && origin === serverOriginMatch[1]) {
          callback(null, true);
          return;
        }
      }
      if (
        /^https:\/\/[^\.]+-[^\.]+\.a\.run\.app$/.test(origin) ||
        /^https:\/\/[^\.]+\.run\.app$/.test(origin)
      ) {
        callback(null, true);
        return;
      }
      callback(null, true);
    },
    credentials: true,
  }),
);
app.use(express.urlencoded({ extended: false, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

app.use('/uploads', express.static(staticUploadsMount()));

app.get('/health', async (_req: Request, res: Response) => {
  const redisHealth = await getRedisHealthSnapshot();
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    redis: redisHealth.status,
    redisPingMs: redisHealth.pingMs,
    redisDetail: redisHealth.detail,
    redisObservability: {
      disconnectEvents: redisHealth.metrics.disconnectEvents,
      readyEvents: redisHealth.metrics.readyEvents,
      lastReconnectDurationMs: redisHealth.metrics.lastReconnectDurationMs,
      connectionErrorEvents: redisHealth.metrics.connectionErrorEvents,
      lastReconnectStrategy: redisHealth.metrics.lastReconnectStrategyLog,
    },
  });
});

/**
 * Main chat endpoint for the app.
 *
 * Request format: Send ChatRequest with userId and one of: text, media, or button
 * Response format: ChatResponse with replies array
 *
 * Frontend should render each reply based on reply_type:
 * - 'text_only': Simple text message bubble
 * - 'text_with_buttons': Text with button grid below
 * - 'buttons_only': Quick reply buttons (floating/suggested)
 * - 'image_with_caption': Media message with caption
 *
 * @example
 * POST /api/chat
 * {
 *   "userId": "user123",
 *   "text": "Hello, I need styling advice"
 * }
 *
 * Response:
 * {
 *   "replies": [{
 *     "reply_type": "text",
 *     "reply_text": "Hi! I'd love to help with styling..."
 *   }],
 *   "pending": null
 * }
 */
app.post('/api/chat', async (req: Request, res: Response, next: NextFunction) => {
  let requestLogUserId: string | undefined;
  let requestLogUserName: string | undefined;

  res.locals.apiLogRequestPayload = sanitizeChatRequestForLog(req.body);

  try {
    const chatRequest = req.body as ChatRequest;
    const { userId, messageId } = chatRequest;

    // Basic validation
    if (!userId) {
      res.locals.apiLogResponsePayload = sanitizeChatResponseForLog({
        error: 'userId is required',
        code: 'MISSING_USER_ID',
      });
      return res.status(400).json({
        error: 'userId is required',
        code: 'MISSING_USER_ID',
      });
    }

    const sid = String(messageId || `msg_${randomUUID()}`);

    // Convert ChatRequest to internal MessageInput format
    const messageInput = chatRequestToMessageInput(chatRequest, sid);
    const waId = messageInput.WaId;
    if (!waId) {
      res.locals.apiLogResponsePayload = sanitizeChatResponseForLog({
        error: 'Invalid message input',
        code: 'INVALID_INPUT',
      });
      return res.status(400).json({ error: 'Invalid message input', code: 'INVALID_INPUT' });
    }

    // Same user resolution as the agent so ServiceLog.userId is the real Prisma User.id
    // (ChatRequest.userId is the client app user id / WaId, not the internal cuid.)
    const { user, conversation } = await getOrCreateUserAndConversation(
      waId,
      messageInput.ProfileName ?? chatRequest.profileName ?? '',
      String(userId),
    );

    // Track style_chat_initiated if this is a fresh conversation (within last 30 seconds)
    if (Date.now() - conversation.createdAt.getTime() < 30000) {
      analyticsService.track({
        eventName: 'style_chat_initiated',
        userId: user.appUserId,
        sessionId: sid,
        vibeSessionId: sid,
        flowType: 'home',
        platform: 'web',
        properties: {
          entry_flow: 'home',
          has_prior_result: !!(user.lastColorAnalysisAt || user.lastVibeCheckAt),
        },
      });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    requestLogUserId = user.id;
    requestLogUserName = (user.profileName?.trim() || user.appUserId) ?? undefined;
    res.locals.requestLogUserId = requestLogUserId;
    res.locals.requestLogUserName = requestLogUserName;

    logger.info(
      { userId: user.id, appUserId: user.appUserId, messageId: sid },
      'Received chat message',
    );
    const traceId = typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined;
    void dbLog(
      'INFO',
      'api',
      'Received chat message',
      { prismaUserId: user.id, appUserId: user.appUserId, messageId: sid },
      {
        userId: user.id,
        appUserId: user.appUserId,
        whatsappId: user.whatsappId,
        profileNameSnapshot: user.profileName,
        ...(traceId !== undefined ? { traceId } : {}),
      },
    );

    const { replies, pending, intentV2, intent } = await runAgentForHttp(user.id, sid, messageInput);
    if (intent !== undefined && String(intent).trim().length > 0) {
      res.locals.intent = String(intent).trim();
    }
    if (intentV2 !== undefined && String(intentV2).trim().length > 0) {
      res.locals.intentV2 = String(intentV2).trim();
    }
    // Snapshot on req so ApiRequestLog always sees values on response `finish` (same request scope).
    req.apiLogIntent = res.locals.intent ?? null;
    req.apiLogIntentV2 = res.locals.intentV2 ?? null;

    // Response without metadata
    const response = {
      replies,
      pending,
    };

    res.locals.apiLogResponsePayload = sanitizeChatResponseForLog(response);
    return res.status(200).json(response);
  } catch (err: unknown) {
    if (requestLogUserId !== undefined) {
      res.locals.requestLogUserId = requestLogUserId;
    }
    if (requestLogUserName !== undefined) {
      res.locals.requestLogUserName = requestLogUserName;
    }
    res.locals.requestLogError = err instanceof Error ? err.message : String(err);
    res.locals.apiLogResponsePayload = sanitizeChatResponseForLog({
      error: err instanceof Error ? err.message : String(err),
    });
    return next(err);
  }
});

// Static file serving should come AFTER API routes
app.use(express.static(path.join(process.cwd(), 'public')));

app.use(errorHandler);

/**
 * Bootstrap function to initialize the server and connect to services.
 * Sets up Redis connection and starts the Express server.
 */
void (async function bootstrap() {
  try {
    await connectRedis();
    await connectPrisma();
    await ensureDir(staticUploadsMount());
    logger.info(
      {
        uploadsRoot: staticUploadsMount(),
        cwd: process.cwd(),
        UPLOADS_ROOT: process.env.UPLOADS_ROOT ?? '(default: cwd/uploads)',
      },
      'Serving GET /uploads/* from uploadsRoot',
    );
    initializeAgent();
    const PORT = Number(process.env.PORT || 8080);
    app.listen(PORT, '0.0.0.0', () => {
      logger.info({ port: PORT }, 'Broadway Chat Bot server started');
      void dbLog('INFO', 'api', 'Broadway Chat Bot server started', { port: PORT });
    });

    setInterval(() => {
      void clearUploadsDirectory().catch((err: unknown) => {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'Scheduled uploads purge failed',
        );
      });
    }, UPLOADS_PURGE_INTERVAL_MS);

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');
      await analyticsService.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', () => {
      void shutdown();
    });
    process.on('SIGTERM', () => {
      void shutdown();
    });
  } catch (err: unknown) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      'Server bootstrap failed',
    );
    process.exit(1);
  }
})();
