# Build stage
FROM node:22 AS build

# Install native dependencies needed by canvas (build tools included)
RUN apt-get update && apt-get install -y \
    build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm ci --legacy-peer-deps

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# Production stage
FROM node:22 AS production

# Install native runtime dependencies needed by canvas (no build tools here)
# plus cron + psql client for guest-user cleanup jobs.
RUN apt-get update && apt-get install -y \
    cron postgresql-client \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Align with compose bind mount ...:/app/uploads so express.static and media I/O share one directory.
ENV UPLOADS_ROOT=/app/uploads

COPY package*.json ./

RUN npm ci --legacy-peer-deps --only=production

COPY --from=build /app/dist ./dist
COPY --from=build /app/prompts ./prompts
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public
COPY --from=build /app/files ./files
COPY --from=build /app/templates ./templates
COPY --from=build /app/node_modules/.prisma/client ./node_modules/.prisma/client
COPY --from=build /app/package*.json ./
# From build stage — only whitelisted loose scripts (not the whole repo scripts/ tree).
COPY --from=build /app/scripts/clear-uploads.mjs ./scripts/clear-uploads.mjs
COPY --from=build /app/scripts/preflight-db-push.sql ./scripts/preflight-db-push.sql
COPY --from=build /app/scripts/bulk-tag-embed-10k.sh ./scripts/bulk-tag-embed-10k.sh
RUN chmod +x ./scripts/bulk-tag-embed-10k.sh
# TS automation entrypoints live under dist/automation/scripts/ (see npm run build).

EXPOSE 8080

CMD ["node", "dist/index.js"]
