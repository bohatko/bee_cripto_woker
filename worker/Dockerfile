# Production Dockerfile for Railway Worker Daemon
# Build context is expected to be the monorepo root.
FROM node:22-alpine AS builder

WORKDIR /app

# Copy monorepo root manifest for npm workspaces lookup
COPY package*.json ./

# Copy worker workspace dependency definitions
COPY worker/package*.json worker/tsconfig.json ./worker/

# Install dependencies for the worker workspace
RUN npm ci --workspace=worker

# Copy worker source files
COPY worker/src/ ./worker/src/

# Compile TypeScript for the worker workspace
RUN npm run build --workspace=worker

# Production runtime stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy monorepo root manifest and worker workspace manifest
COPY package*.json ./
COPY worker/package*.json ./worker/
RUN npm ci --workspace=worker --omit=dev

COPY --from=builder /app/worker/dist ./worker/dist

# Start the autonomous daemon
CMD ["node", "worker/dist/index.js"]
