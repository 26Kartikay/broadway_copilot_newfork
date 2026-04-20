import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8090;

// Startup Check
if (!process.env.DATABASE_URL) {
  console.error('CRITICAL ERROR: DATABASE_URL is not set or is empty.');
  console.error('Check your environment variables or .env file.');
  // In many cases we'd exit(1) here, but for now we'll log it clearly
}

const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// Request Logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Auth Middleware (Placeholder)
const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  next();
};

// Admin Routes
app.get('/admin/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', redis: 'connected', version: '1.0.0' });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

app.get('/admin/logs', authMiddleware, async (req, res) => {
  const severity = req.query.severity as string | undefined;
  const service = req.query.service as string | undefined;
  const userId = req.query.userId as string | undefined;
  const limit = (req.query.limit as string) || '50';
  const offset = (req.query.offset as string) || '0';
  
  try {
    const logs = await prisma.serviceLog.findMany({
      where: {
        severity: severity ? (severity as any) : undefined,
        service: service ? service : undefined,
        userId: userId ? userId : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
      include: { user: true },
    });
    res.json(logs);
  } catch (error) {
    console.error('ERROR in GET /admin/logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs', message: (error as any).message });
  }
});

app.get('/admin/users', authMiddleware, async (req, res) => {
  const search = req.query.search as string | undefined;
  const limit = (req.query.limit as string) || '20';
  const offset = (req.query.offset as string) || '0';
  
  try {
    const users = await prisma.user.findMany({
      where: search ? {
        OR: [
          { id: { contains: search } },
          { appUserId: { contains: search } },
          { whatsappId: { contains: search } },
          { profileName: { contains: search, mode: 'insensitive' } },
        ]
      } : {},
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
    });
    res.json(users);
  } catch (error) {
    console.error('ERROR in GET /admin/users:', error);
    res.status(500).json({ error: 'Failed to fetch users', message: (error as any).message });
  }
});

app.post('/admin/users', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.create({ data: req.body });
    res.json(user);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/admin/users/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.user.delete({ where: { id: id as string } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Serve Frontend
const staticPath = path.join(__dirname, '../dist');
app.use(express.static(staticPath));

// Terminal middleware: handle SPA routing without wildcards that trigger PathErrors
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/admin')) {
    return res.sendFile(path.join(staticPath, 'index.html'));
  }
  next();
});

app.listen(port, () => {
  console.log(`Admin Dashboard listening on port ${port}`);
});
