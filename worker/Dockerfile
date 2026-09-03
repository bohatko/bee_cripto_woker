# Production Dockerfile for Railway Worker Daemon
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency definitions
COPY package*.json tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY src/ ./src/

# Compile TypeScript
RUN npm run build

# Production runtime stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy built artifacts and production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Start the autonomous daemon
CMD ["node", "dist/index.js"]
