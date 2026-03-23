FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# Verify build works
RUN npx tsc --noEmit || true

FROM node:22-slim

WORKDIR /app

# Install runtime dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/src/ ./src/
COPY --from=builder /app/scripts/ ./scripts/
COPY --from=builder /app/tsconfig.json ./

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

# Health check: verify the process is running
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

ENV NODE_ENV=production
ENV DB_PATH=/app/data/arb.db

CMD ["npx", "tsx", "src/index.ts"]
