# Production Dockerfile for Railway Worker Daemon
# Build context must be the worker/ directory (Railway Root Directory = /worker).
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/worker/dist ./worker/dist

EXPOSE 8080

CMD ["node", "dist/index.js"]
