#Build stage
FROM node:22 AS build

WORKDIR /app

COPY package*.json .

RUN npm ci --legacy-peer-deps

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

#Production stage
FROM node:22 AS production

WORKDIR /app

COPY package*.json .

RUN npm ci --legacy-peer-deps --only=production

COPY --from=build /app/dist ./dist
COPY --from=build /app/prompts ./prompts
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma/client ./node_modules/.prisma/client
COPY --from=build /app/scripts ./scripts   
EXPOSE 8080

CMD ["node", "dist/index.js"]