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
import { ProductSearchService } from './services/productSearchService';
import { ProductSearchIntentSchema } from './types/productSearch';

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
app.use(express.static('public'));

/**
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Product search endpoint using new structured search approach
 * Optional endpoint for testing and external integrations
 */
app.post('/api/products/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const searchIntent = ProductSearchIntentSchema.parse(req.body);

    const productSearchService = new ProductSearchService();
    const result = await productSearchService.searchProducts(searchIntent);

    res.status(200).json(result);
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      body: req.body
    }, 'Product search API error');

    if (error instanceof Error && error.name === 'ZodError') {
      return res.status(400).json({
        error: 'Invalid search intent format',
        details: error.message
      });
    }

    return next(error);
  }
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
