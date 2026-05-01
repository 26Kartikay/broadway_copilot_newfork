import { Prisma, PrismaClient, type Severity } from '@prisma/client';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import Papa from 'papaparse';
import path from 'path';
import { fileURLToPath } from 'url';

import { createProxyMiddleware } from 'http-proxy-middleware';
import { normalizeCsvHeader, parseBulkUserRow, upsertBulkUser } from './bulkUsers.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8090;

const upload = multer({ dest: '/tmp/uploads/' });

// Ensure upload directory exists
if (!fs.existsSync('/tmp/uploads/')) {
  fs.mkdirSync('/tmp/uploads/', { recursive: true });
}

// Startup Check
if (!process.env.DATABASE_URL) {
  console.error('CRITICAL ERROR: DATABASE_URL is not set or is empty.');
  console.error('Check your environment variables or .env file.');
  // In many cases we'd exit(1) here, but for now we'll log it clearly
}

const prisma = new PrismaClient();

function parseCreatedAfterBefore(req: express.Request): {
  createdAfter?: Date;
  createdBefore?: Date;
} {
  const a = (req.query.createdAfter as string | undefined)?.trim();
  const b = (req.query.createdBefore as string | undefined)?.trim();
  const out: { createdAfter?: Date; createdBefore?: Date } = {};
  if (a) {
    const d = new Date(a);
    if (!Number.isNaN(d.getTime())) out.createdAfter = d;
  }
  if (b) {
    const d = new Date(b);
    if (!Number.isNaN(d.getTime())) out.createdBefore = d;
  }
  return out;
}

app.use(cors());

// Analytics API proxy — MUST be registered BEFORE express.json(). Otherwise body-parser
// consumes the request stream and proxied POSTs (e.g. /query) hang or send an empty body.
// http-proxy-middleware v3 rewrites paths relative to the Express mount; mount at /analytics-api
// and prefix /api so /analytics-api/schema → /api/schema on the Python service.
const analyticsApiUrl = process.env.ANALYTICS_API_URL || 'http://localhost:8000';
app.use(
  '/analytics-api',
  createProxyMiddleware({
    target: analyticsApiUrl,
    changeOrigin: true,
    pathRewrite: (pathname) => (pathname.startsWith('/api') ? pathname : `/api${pathname}`),
    // NL→SQL can exceed default proxy timeouts; avoids 504 on slow /api/query.
    proxyTimeout: 120_000,
    timeout: 120_000,
  }),
);

app.use(express.json({ limit: '10mb' }));

// Request Logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Auth Middleware (Placeholder)
const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  next();
};

// Public config for SPA (no secrets)
app.get('/admin/config', (_req, res) => {
  const chatApiUrl = process.env.CHAT_API_URL || process.env.SERVER_URL || '';
  res.json({
    chatApiUrl,
    nodeEnv: process.env.NODE_ENV || 'production',
  });
});

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
  const severity = (req.query.severity as string | undefined)?.trim();
  const service = (req.query.service as string | undefined)?.trim();
  const userId = (req.query.userId as string | undefined)?.trim();
  const search = (req.query.search as string | undefined)?.trim();

  const limit = (req.query.limit as string) || '50';
  const offset = (req.query.offset as string) || '0';

  try {
    const parts: Prisma.ServiceLogWhereInput[] = [];

    if (severity && severity !== 'ALL') {
      parts.push({ severity: severity as Severity });
    }
    if (service) {
      parts.push({ service });
    }
    if (userId) {
      parts.push({
        OR: [{ userId }, { appUserId: userId }, { whatsappId: userId }],
      });
    }
    if (search) {
      parts.push({
        OR: [
          { message: { contains: search, mode: 'insensitive' } },
          { appUserId: { contains: search, mode: 'insensitive' } },
          { whatsappId: { contains: search, mode: 'insensitive' } },
          { profileNameSnapshot: { contains: search, mode: 'insensitive' } },
          { traceId: { contains: search, mode: 'insensitive' } },
          { userId: { contains: search } },
        ],
      });
    }

    const { createdAfter, createdBefore } = parseCreatedAfterBefore(req);
    if (createdAfter) {
      parts.push({ createdAt: { gte: createdAfter } });
    }
    if (createdBefore) {
      parts.push({ createdAt: { lte: createdBefore } });
    }

    const where: Prisma.ServiceLogWhereInput = parts.length ? { AND: parts } : {};

    const logs = await prisma.serviceLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
      skip: parseInt(offset, 10),
      include: { user: true },
    });
    res.json(logs);
  } catch (error) {
    console.error('ERROR in GET /admin/logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs', message: (error as any).message });
  }
});

app.get('/admin/api-request-logs', authMiddleware, async (req, res) => {
  const severity = (req.query.severity as string | undefined)?.trim();
  const userId = (req.query.userId as string | undefined)?.trim();
  const endpoint = (req.query.endpoint as string | undefined)?.trim();
  const search = (req.query.search as string | undefined)?.trim();
  const httpStatusRaw = (req.query.httpStatus as string | undefined)?.trim();

  const limit = (req.query.limit as string) || '100';
  const offset = (req.query.offset as string) || '0';

  try {
    const parts: Prisma.ApiRequestLogWhereInput[] = [];

    if (severity && severity !== 'ALL') {
      parts.push({ severity: severity as Severity });
    }
    if (userId) {
      parts.push({
        OR: [
          { userId },
          { userName: { contains: userId, mode: 'insensitive' } },
          { user: { appUserId: userId } },
          { user: { whatsappId: userId } },
        ],
      });
    }
    if (endpoint) {
      parts.push({ endpoint: { contains: endpoint, mode: 'insensitive' } });
    }
    if (httpStatusRaw && /^\d{3}$/.test(httpStatusRaw)) {
      parts.push({ httpStatus: parseInt(httpStatusRaw, 10) });
    }
    if (search) {
      parts.push({
        OR: [
          { intent: { contains: search, mode: 'insensitive' } },
          { intentV2: { contains: search, mode: 'insensitive' } },
          { endpoint: { contains: search, mode: 'insensitive' } },
          { error: { contains: search, mode: 'insensitive' } },
          { requestId: { contains: search, mode: 'insensitive' } },
          { userName: { contains: search, mode: 'insensitive' } },
          { userId: { contains: search } },
        ],
      });
    }

    const { createdAfter, createdBefore } = parseCreatedAfterBefore(req);
    if (createdAfter) {
      parts.push({ createdAt: { gte: createdAfter } });
    }
    if (createdBefore) {
      parts.push({ createdAt: { lte: createdBefore } });
    }

    const where: Prisma.ApiRequestLogWhereInput = parts.length ? { AND: parts } : {};

    const logs = await prisma.apiRequestLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
      skip: parseInt(offset, 10),
      include: {
        user: { select: { id: true, profileName: true, appUserId: true, whatsappId: true } },
      },
    });
    res.json(logs);
  } catch (error) {
    console.error('ERROR in GET /admin/api-request-logs:', error);
    res.status(500).json({ error: 'Failed to fetch API request logs', message: (error as any).message });
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

app.post('/admin/users/bulk', authMiddleware, upload.single('file'), (req, res) => {
  const uploaded = req.file;
  if (!uploaded) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = uploaded.path;
  const fileContent = fs.readFileSync(filePath, 'utf8');

  Papa.parse<Record<string, unknown>>(fileContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeCsvHeader,
    complete: (results) => {
      void (async () => {
        const resultsSummary = {
          total: 0,
          succeeded: 0,
          /** @deprecated use succeeded */
          created: 0,
          errors: 0,
          details: [] as { user: string; error: string }[],
        };

        try {
          const parseErrors = results.errors ?? [];
          if (parseErrors.length > 0) {
            const first = parseErrors[0];
            return res.status(400).json({
              error: 'CSV parse error',
              message: first.message ?? 'Unknown parse error',
            });
          }

          const rows = results.data.filter((row) =>
            Object.values(row).some((v) => v !== undefined && v !== null && String(v).trim() !== ''),
          );
          resultsSummary.total = rows.length;

          for (const userData of rows) {
            const parsed = parseBulkUserRow(userData);
            if (!parsed.ok) {
              resultsSummary.errors++;
              resultsSummary.details.push({
                user: pickAppUserIdForError(userData),
                error: parsed.error,
              });
              continue;
            }

            try {
              await upsertBulkUser(prisma, parsed);
              resultsSummary.succeeded++;
            } catch (error: unknown) {
              resultsSummary.errors++;
              const message = error instanceof Error ? error.message : String(error);
              resultsSummary.details.push({ user: parsed.appUserId, error: message });
            }
          }

          resultsSummary.created = resultsSummary.succeeded;

          try {
            await prisma.adminAuditLog.create({
              data: {
                action: 'users_bulk_csv',
                details: {
                  total: resultsSummary.total,
                  succeeded: resultsSummary.succeeded,
                  errors: resultsSummary.errors,
                },
              },
            });
          } catch (e) {
            console.warn('AdminAuditLog write skipped:', e);
          }

          res.json(resultsSummary);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          res.status(500).json({ error: 'Bulk import failed', message });
        } finally {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      })();
    },
    error: (error: { message?: string }) => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      res.status(500).json({ error: 'CSV parsing failed', message: error.message });
    },
  });
});

function pickAppUserIdForError(row: Record<string, unknown>): string {
  const v =
    row.app_user_id ??
    row.appuserid ??
    row.user_id ??
    row.userid ??
    row.appUserId;
  return v !== undefined && v !== null ? String(v) : 'unknown row';
}

app.delete('/admin/users/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.user.delete({ where: { id: id as string } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Serve Frontend (avoid stale UI after deploy: never cache index.html; hashed /assets are immutable)
const staticPath = path.join(__dirname, '../dist');
app.use(
  express.static(staticPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }),
);

// Terminal middleware: handle SPA routing without wildcards that trigger PathErrors
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/admin')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res.sendFile(path.join(staticPath, 'index.html'));
  }
  next();
});

app.listen(port, () => {
  console.log(`Admin Dashboard listening on port ${port}`);
});
