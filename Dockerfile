# Compatible with classic `docker build` (no BuildKit required). Optional: export DOCKER_BUILDKIT=1
# for faster rebuilds locally; omit --mount directives so prod hosts without BuildKit still build.

# ── Build (full devDependencies for tsc / prisma generate) ───────────────────
FROM node:22-bookworm AS build

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

# ── Production — reuse node_modules from build, prune devDeps (skip 2nd npm ci) ─
FROM node:22-bookworm AS production

RUN apt-get update && apt-get install -y \
    cron postgresql-client \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV UPLOADS_ROOT=/app/uploads

COPY package*.json ./

RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

# Restore the prisma-generated client (built in the build stage)
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client

COPY --from=build /app/dist ./dist
COPY --from=build /app/prompts ./prompts
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public
COPY --from=build /app/files ./files
COPY --from=build /app/templates ./templates

COPY --from=build /app/scripts/clear-uploads.mjs ./scripts/clear-uploads.mjs
COPY --from=build /app/scripts/preflight-db-push.sql ./scripts/preflight-db-push.sql
COPY --from=build /app/scripts/bulk-tag-embed-10k.sh ./scripts/bulk-tag-embed-10k.sh

RUN chmod +x ./scripts/bulk-tag-embed-10k.sh

EXPOSE 8080

CMD ["node", "dist/index.js"]
