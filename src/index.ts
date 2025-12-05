import 'dotenv/config';

import cors from 'cors';
import { randomUUID } from 'crypto';
import express, { NextFunction, Request, Response } from 'express';

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
    origin: [/http:\/\/localhost:\d+/, /http:\/\/127\.0\.0\.1:\d+/],
    credentials: true,
  }),
);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use('/uploads', express.static(staticUploadsMount()));
app.use(express.static('public'));

/**
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Main chat endpoint for the app.
 * Accepts messages and returns AI responses in the HTTP response.
 */
app.post('/api/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const chatRequest = req.body as ChatRequest;
    const { userId, messageId } = chatRequest;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const sid = String(messageId || `msg_${randomUUID()}`);

    // Convert ChatRequest to internal MessageInput format
    const messageInput = chatRequestToMessageInput(chatRequest, sid);

    logger.info({ userId, messageId: sid }, 'Received chat message');

    const { replies, pending } = await runAgentForHttp(String(userId), sid, messageInput);
    return res.status(200).json({ replies, pending });
  } catch (err: unknown) {
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
