# Stage 1: Build Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm install
COPY dashboard/ .
RUN npm run build:client

# Stage 2: Build Backend
FROM node:22-alpine AS backend-builder
WORKDIR /app/dashboard

# Build args
ARG DATABASE_URL
ARG REDIS_URL
ARG PORT=8090

ENV DATABASE_URL=$DATABASE_URL
ENV REDIS_URL=$REDIS_URL

COPY dashboard/package*.json ./
RUN npm install
COPY dashboard/ .
# Since the build context is now the repo root, prisma/ is in /app/prisma
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npx prisma generate
RUN npm run build:server

# Stage 3: Final Image
FROM node:22-alpine
WORKDIR /app/dashboard

ARG DATABASE_URL
ARG REDIS_URL
ARG PORT=8090
ENV DATABASE_URL=$DATABASE_URL
ENV REDIS_URL=$REDIS_URL
ENV PORT=$PORT
ENV NODE_ENV=production

COPY --from=frontend-builder /app/dashboard/dist ./dist
COPY --from=backend-builder /app/dashboard/dist-server ./dist-server
COPY --from=backend-builder /app/dashboard/package*.json ./
COPY --from=backend-builder /app/dashboard/node_modules ./node_modules
COPY --from=backend-builder /app/dashboard/prisma ./prisma

EXPOSE 8090
CMD ["node", "dist-server/index.js"]
