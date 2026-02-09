// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';

export const authenticateInternal = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const INTERNAL_AUTH_TOKEN = process.env.INTERNAL_AUTH_TOKEN;

  if (!INTERNAL_AUTH_TOKEN) {
    console.error('INTERNAL_AUTH_TOKEN is not set in environment variables.');
    return res.status(500).json({ error: 'Server configuration error: Internal auth token not set.' });
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided or invalid format.' });
  }

  const token = authHeader.split(' ')[1];

  if (token === INTERNAL_AUTH_TOKEN) {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden: Invalid authentication token.' });
  }
};
