# Broadway Admin Dashboard & Service Management

This guide explains how to manage the unified Broadway stack, which includes the **AI Chatbot** and the **Admin Dashboard** running on the same VM using Docker.

## Architecture
- **Chatbot API (`app`)**: Runs on port `8080`.
- **Admin Dashboard (`dashboard`)**: Runs on port `8090`.
- **Shared Infrastructure**: Both services share the same PostgreSQL (`db`) and Redis (`redis`) containers via the `broadway-network`.
- **Environment**: Both services load configuration from the root `.env` file.

---

## Service Management Commands

You can manage the chatbot and the dashboard together or independently using the service names defined in `docker-compose.yml`.

### 1. Starting the Stack
| Scenario | Command |
| :--- | :--- |
| **Start Everything** | `docker-compose up -d --build` |
| **Start Bot Only** | `docker-compose up -d app` |
| **Start Dashboard Only** | `docker-compose up -d dashboard` |

### 2. Stopping & Restarting
| Scenario | Command |
| :--- | :--- |
| **Stop Bot (Keep Dashboard up)** | `docker-compose stop app` |
| **Stop Dashboard (Keep Bot up)** | `docker-compose stop dashboard` |
| **Restart Dashboard Only** | `docker-compose restart dashboard` |
| **Shut Down Everything** | `docker-compose down` |

### 3. Monitoring & Logs
| Scenario | Command |
| :--- | :--- |
| **View All Logs** | `docker-compose logs -f` |
| **View Dashboard Logs Only** | `docker-compose logs -f dashboard` |
| **View Bot Logs Only** | `docker-compose logs -f app` |

### 4. Rebuilding After Changes
If you modify the Dashboard code or the Chatbot code, you can rebuild just that container:
```bash
# Rebuild and restart only the dashboard
docker-compose up -d --build dashboard

# Rebuild and restart only the chatbot
docker-compose up -d --build app
```

---

## Dashboard Features

### 1. Observability (Logs)
- **Real-time Browsing**: View application logs stored in the `ServiceLog` table.
- **Filtering**: Filter by Severity (`ERROR`, `WARN`, `INFO`), Service (`api`, `agent`), or `userId`.
- **Context**: Deep-dive into structured JSON context (trace IDs, LLM latencies, etc.).

### 2. User Operations
- **Search**: Find users by WhatsApp ID, Internal ID, or Profile Name.
- **Management**: Create new admin-whitelisted users or delete existing users (with cascade delete confirmation).
- **Details**: View user activity and specific logs linked to their account.

### 3. Service Health
- **Connectivity**: Instant status of PostgreSQL and Redis connections.
- **Version Tracking**: Displays the current build version and environment (`production`/`staging`).

---

## Operator Runbook

### Troubleshooting "500 Internal Server Error"
If the dashboard UI shows an error or disappears on refresh:
1. **Check Logs**: Run `docker-compose logs -f dashboard`.
2. **Database Sync**: If you see `Table "ServiceLog" does not exist`, run the schema push:
   ```bash
   npx prisma db push
   ```
3. **Env Check**: Ensure `DATABASE_URL` is correctly set in the root `.env`. The dashboard log will say `CRITICAL ERROR: DATABASE_URL is not set` if it's missing.

### Security Note
- The dashboard is accessible on port `8090`.
- **Production Warning**: Do not expose port 8090 to the public internet without a VPN or an additional Auth layer (e.g., Nginx Basic Auth or Cloudflare Access).

---

## Ingestion (For Developers)
To send logs from the Chatbot to the Dashboard, use the `ServiceLog` model in Prisma.
```typescript
await prisma.serviceLog.create({
  data: {
    severity: 'ERROR',
    service: 'agent',
    message: 'LLM Timeout',
    context: { duration: 5000, model: 'gpt-4' },
    userId: user.id
  }
});
```
