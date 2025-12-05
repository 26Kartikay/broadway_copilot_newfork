import { NextFunction, Request, Response } from 'express';
import { ChatRequest } from '../lib/chat/types';
import { prisma } from '../lib/prisma';
import { ForbiddenError, InternalServerError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * Middleware to check if a user is whitelisted.
 * In development mode, all users are allowed.
 * In production, only whitelisted users can access the API.
 */
export const whitelist = async (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'development') {
    return next();
  }

  const { userId } = req.body as ChatRequest;

  if (!userId) {
    return next(new ForbiddenError('Unauthorized'));
  }

  try {
    const user = await prisma.userWhitelist.findUnique({
      where: {
        waId: userId,
      },
    });

    if (!user) {
      logger.info(`Unauthorized access attempt by ${userId}`);
      // Return a JSON response for non-whitelisted users instead of sending via Twilio
      return res.status(403).json({
        error: 'Forbidden',
        message:
          "Hey! Thanks for your interest in Broadway. We're currently in a private beta. We'll let you know when we're ready for you!",
      });
    }

    next();
  } catch (error: unknown) {
    logger.error({ error }, 'Error in whitelist middleware');
    next(new InternalServerError('Internal Server Error'));
  }
};
