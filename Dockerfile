# ── Build stage: compile TypeScript ──
FROM node:22-slim AS builder

WORKDIR /build

# Copy package files first for layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDeps for tsc)
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN npm run build

# Run tests to verify the build
RUN npm test

# ── Runtime stage: minimal image ──
FROM node:22-slim AS runtime

LABEL org.opencontainers.image.title="Mnemosyne OpenClaw Plugin"
LABEL org.opencontainers.image.description="100% offline, local SQLite memory plugin for OpenClaw"
LABEL org.opencontainers.image.source="https://github.com/smfworks/mnemosyne-openclaw"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Copy package files and install ONLY production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /build/dist/ ./dist/
COPY --from=builder /build/scripts/ ./scripts/
COPY openclaw.plugin.json ./
COPY README.md CHANGELOG.md ./

# Create data directory for SQLite database
RUN mkdir -p /data

# Default environment — override via docker run -e or compose
ENV MNEMOSYNE_DB_PATH=/data/mnemosyne.db

# Health check: verify the native binding loads and SQLite is functional
HEALTHCHECK --interval=60s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const D=require('better-sqlite3');const d=new D(':memory:');d.close();process.exit(0)" || exit 1

# Non-root user for security
USER node

# No ENTRYPOINT — this image is meant to be volume-mounted into an OpenClaw
# gateway container or used as a base image. The plugin is loaded by OpenClaw
# via: openclaw plugin load /app