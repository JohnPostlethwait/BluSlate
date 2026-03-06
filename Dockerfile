FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

# Enable pnpm
RUN corepack enable pnpm

# Copy workspace config and lockfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy only the packages needed for the web build (skip cli/gui)
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/

# Install dependencies (only core + web workspaces)
RUN pnpm install --frozen-lockfile --filter @bluslate/core --filter @bluslate/web

# Copy source code
COPY packages/core/ packages/core/
COPY packages/web/ packages/web/
COPY tsconfig.json ./

# Build core first, then web (client + server)
RUN pnpm --filter @bluslate/core run build
RUN pnpm --filter @bluslate/web run build

# --- Production stage ---
FROM node:22-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

RUN corepack enable pnpm

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --filter @bluslate/core --filter @bluslate/web --prod

# Copy built output from builder stage
COPY --from=builder /app/packages/core/dist/ packages/core/dist/
COPY --from=builder /app/packages/web/dist/ packages/web/dist/

EXPOSE 3000

ENV MEDIA_ROOT=/media
ENV BLUSLATE_DATA=/data
ENV BLUSLATE_LANGUAGE=en-US
ENV BLUSLATE_MIN_CONFIDENCE=85
# Minimum confidence threshold — matches at or above are pre-approved for review

CMD ["node", "packages/web/dist/server/index.js"]
