import 'dotenv/config';

import cors from 'cors';
import { randomUUID } from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import path from 'path';

import { initializeAgent, runAgentForHttp } from './agent';
import { ChatRequest, chatRequestToMessageInput } from './lib/chat/types';
import { connectPrisma } from './lib/prisma';
import { connectRedis } from './lib/redis';
import { errorHandler } from './middleware/errors';
import { logger } from './utils/logger';
import { staticUploadsMount } from './utils/paths';

const app = express();
app.set('trust proxy', true);

app.use(
  cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) {
        callback(null, true);
        return;
      }
      
      // Allow localhost for development
      if (/^http:\/\/localhost(:\d+)?$/.test(origin) || /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
        callback(null, true);
        return;
      }
      
      // Allow Cloud Run URLs and custom domains
      const serverUrl = process.env.SERVER_URL;
      if (serverUrl && origin) {
        // Extract origin from serverUrl (protocol + hostname + port)
        const serverOriginMatch = serverUrl.match(/^(https?:\/\/[^\/]+)/);
        if (serverOriginMatch && origin === serverOriginMatch[1]) {
          callback(null, true);
          return;
        }
      }
      
      // Allow *.run.app domains (Cloud Run default)
      if (/^https:\/\/[^\.]+-[^\.]+\.a\.run\.app$/.test(origin) || 
          /^https:\/\/[^\.]+\.run\.app$/.test(origin)) {
        callback(null, true);
        return;
      }
      
      // Default: allow same-origin requests (frontend served from same domain)
      callback(null, true);
    },
    credentials: true,
  }),
);
app.use(express.urlencoded({ extended: false, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

app.use('/uploads', express.static(staticUploadsMount()));
app.use(express.static(path.join(process.cwd(), 'public')));

/**
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
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
 *     "reply_type": "text_only",
 *     "reply_text": "Hi! I'd love to help with styling...",
 *     "expected_action": "input_required"
 *   }],
 *   "pending": null
 * }
 */
app.post('/api/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const chatRequest = req.body as ChatRequest;
    const { userId, messageId } = chatRequest;

    // Basic validation
    if (!userId) {
      return res.status(400).json({
        error: 'userId is required',
        code: 'MISSING_USER_ID'
      });
    }

    const sid = String(messageId || `msg_${randomUUID()}`);

    // Convert ChatRequest to internal MessageInput format
    const messageInput = chatRequestToMessageInput(chatRequest, sid);

    logger.info({ userId, messageId: sid }, 'Received chat message');

    const { replies, pending } = await runAgentForHttp(String(userId), sid, messageInput);

    // Response without metadata
    const response = {
      replies,
      pending
    };

    return res.status(200).json(response);
  } catch (err: unknown) {
    logger.error({
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    }, 'Chat endpoint error');
    return next(err);
  }
});

app.use(errorHandler);

/**
 * Bootstrap function to initialize the server and connect to services.
 * Sets up Redis connection and starts the Express server.
 */
void (async function bootstrap() {
  try {
    await connectRedis();
    await connectPrisma();
    initializeAgent();
    const PORT = Number(process.env.PORT || 8080);
    app.listen(PORT, '0.0.0.0', () => {
      logger.info({ port: PORT }, 'Broadway Chat Bot server started');
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
