# Broadway Admin Dashboard & Service Management

This guide explains how to manage the Broadway stack: **AI chatbot (`app`)** and **admin dashboard (`dashboard`)** with Docker. **All commands assume your shell’s current directory is the repository root.**

## Compose files (repo root only)

| File | Purpose |
| :--- | :--- |
| **`docker-compose.stack.yml`** | Full local stack: bot + dashboard + Postgres + Redis (+ optional ngrok profile). |
| **`docker-compose.bot.yml`** | Bot only: `app` + `db` + `redis` (+ optional ngrok). No dashboard. |
| **`docker-compose.dashboard.yml`** | Dashboard only. Set `DATABASE_URL` to a reachable Postgres (e.g. `host.docker.internal:5433` if the bot stack publishes Postgres on the host). |
| **`docker-compose.bot.prod.yml`** | Production-style bot: built `Dockerfile` image + `db` + `redis` (no bind-mounted source). |
| **`docker-compose.yml`** | Includes `docker-compose.stack.yml`, so plain `docker compose up` runs the **full** stack. |

Examples (always from repo root):

```bash
docker compose -f docker-compose.stack.yml --env-file .env up -d --build
docker compose -f docker-compose.bot.yml --env-file .env up -d --build
docker compose -f docker-compose.dashboard.yml --env-file .env up -d --build
docker compose -f docker-compose.bot.prod.yml --env-file .env up -d --build
```

Default full stack (same as `stack`):

```bash
docker compose --env-file .env up -d --build
```

## Architecture
- **Chatbot API (`app`)**: Port **`${PORT:-8080}`** (default 8080).
- **Admin Dashboard (`dashboard`)**: Port **`${DASHBOARD_PORT:-8090}`** (default 8090).
- **Shared infrastructure**: In **stack** / **bot** files, `app` and `dashboard` use the same **`db`** and **`redis`** on Docker network **`broadway-network`**.
- **Environment**: Use root **`.env`** (or `--env-file` / `ENV_FILE`).

---

## Service management (stack or bot file)

When using **`docker-compose.stack.yml`**, you can start or stop individual services by name:

### Starting
| Scenario | Command |
| :--- | :--- |
| **Full stack** | `docker compose -f docker-compose.stack.yml up -d --build` |
| **Bot only (same file, services subset)** | `docker compose -f docker-compose.stack.yml up -d app db redis` |
| **Dashboard only (same file)** | `docker compose -f docker-compose.stack.yml up -d dashboard db` |

Or use the **dedicated** files **`docker-compose.bot.yml`** / **`docker-compose.dashboard.yml`** so only those services exist in the project.

### Stopping & logs
| Scenario | Command |
| :--- | :--- |
| **Stop bot, keep dashboard** | `docker compose -f docker-compose.stack.yml stop app` |
| **Stop dashboard, keep bot** | `docker compose -f docker-compose.stack.yml stop dashboard` |
| **Logs (dashboard)** | `docker compose -f docker-compose.stack.yml logs -f dashboard` |
| **Logs (bot)** | `docker compose -f docker-compose.stack.yml logs -f app` |

Use the same `-f docker-compose.<name>.yml` flag you used for `up`.

### Rebuild one service (stack file)
```bash
docker compose -f docker-compose.stack.yml up -d --build dashboard
docker compose -f docker-compose.stack.yml up -d --build app
```

---

## Dashboard features

### Observability (logs)
- Browse logs in the `ServiceLog` table.
- Filter by severity, service, user, search text (see app and server routes).

### User operations
- Search users; create/delete with care (cascade).

### Service health
- Dashboard health endpoint and DB connectivity checks.

---

## Operator runbook

### 500 / blank UI
1. `docker compose -f docker-compose.stack.yml logs -f dashboard` (or the file you used).
2. If `ServiceLog` is missing: apply schema (`npx prisma db push` or migrations) against the same `DATABASE_URL`.
3. Ensure `DATABASE_URL` is set for the dashboard container.

### Security
- Do not expose port **8090** publicly without VPN / auth (e.g. Nginx basic auth, Cloudflare Access).

---

## Ingestion (developers)
```typescript
await prisma.serviceLog.create({
  data: {
    severity: 'ERROR',
    service: 'agent',
    message: 'LLM Timeout',
    context: { duration: 5000, model: 'gpt-4' },
    userId: user.id,
  },
});
```
