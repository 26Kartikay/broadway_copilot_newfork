# Broadway Admin Dashboard Guide

This dashboard provides observability and administrative tools for the Broadway Copilot backend.

## Deployment

### Docker
The dashboard runs as a standalone service on port **8090**.

1. **Build and Run**:
   From the project root directory:
   ```bash
   docker-compose -f dashboard/docker-compose.yml up --build
   ```
2. **Environment Variables**:
   - `DATABASE_URL`: Connection string to the main PostgreSQL.
   - `PORT`: 8090 (host and container).
   - `ADMIN_SECRET`: Secret key for JWT authentication.

### Database Migration
After updating the schema, push the changes:
```bash
npx prisma db push
```
*(Note: Use `migrate deploy` in production as per project guidelines).*

## Operator Runbook

### 1. Filtering Logs by User
If you only know a user's **WhatsApp ID** (e.g. `91XXXXXXXXXX`):
1. Go to the **Users** page.
2. Search for the WhatsApp ID in the search bar.
3. Copy the internal **User ID** (CUID).
4. Go to the **Logs** page.
5. Filter by the copied User ID (or search for it).

### 2. Interpreting Severities
- **DEBUG**: Low-level tracing, safe to ignore unless investigating a specific request.
- **INFO**: Standard operational events (e.g., successful user creation).
- **WARNING**: Non-critical issues that don't stop the service but may need attention (e.g., rate limit approaching).
- **ERROR**: Critical failures in a request path (e.g., LLM API timeout).
- **CRITICAL**: System-wide failures (e.g., DB disconnected).

### 3. User Deletion
- **Warning**: Deleting a user will trigger a cascade delete of all their conversations, messages, and associated media per the schema definition (`ON DELETE CASCADE`).
- **Confirmation**: Always verify the `appUserId` before deleting.

### 4. Service Health
- **DB**: Shows if the Express server can ping PostgreSQL.
- **Redis**: Shows connectivity to the cache layer.
- **Version**: Displays the current deployment version.

## API Security
- All `/admin/*` routes (except `/admin/health` in some configurations) require a valid JWT.
- Rate limiting is applied to the login endpoint to prevent brute-force attacks.
- Sensitive fields (secrets, tokens) are automatically redacted from `ServiceLog.context` by the backend logger.

## Ingestion (Backend Chat API)

The main chat API should write `ServiceLog` rows using the shared Prisma schema.

### 1. Integration with Pino
Configure a custom Pino transport or an explicit `persistLog()` helper:
```typescript
import { PrismaClient, Severity } from '@prisma/client';

export const persistLog = async (params: {
  severity: Severity;
  service: string;
  message: string;
  context?: any;
  userId?: string;
  appUserId?: string;
  whatsappId?: string;
  profileNameSnapshot?: string;
}) => {
  try {
    await prisma.serviceLog.create({ data: params });
  } catch (err) {
    // Fail silently to avoid blocking the request path
    console.error('Failed to persist log:', err);
  }
};
```

### 2. High Volume Warning
- **Sampling**: For `DEBUG` logs in production, consider sampling (e.g., only 10% of requests).
- **Batching**: Use `createMany` for high-frequency logs if needed.
- **Async Queue**: Use a background task (e.g., BullMQ or simple in-memory queue) to avoid adding latency to the chat path.
