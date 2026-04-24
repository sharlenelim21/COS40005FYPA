# Multi-stage build for LOCAL deployment - Frontend + Backend in one container
FROM node:18-alpine AS base

# Install system dependencies and pnpm
RUN apk add --no-cache python3 py3-pip make g++ libc6-compat curl && \
    npm install -g pnpm

# ============================================
# Frontend builder stage
# ============================================
FROM base AS frontend-builder
WORKDIR /app/frontend

# Copy frontend package files
COPY visheart-frontend/package.json ./
COPY visheart-frontend/pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Copy frontend source
COPY visheart-frontend/ ./

# Set environment variables for LOCAL build
ENV NEXT_PUBLIC_API_URL=http://localhost:5000
ENV NEXT_PUBLIC_ENV=development
ENV NODE_ENV=production

# Build frontend
RUN pnpm run build

# ============================================
# Backend builder stage  
# ============================================
FROM base AS backend-builder
WORKDIR /app/backend

# Copy backend package files
COPY Cardiac_Segmentation_FYP_Server/package.json ./
COPY Cardiac_Segmentation_FYP_Server/pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Copy backend source
COPY Cardiac_Segmentation_FYP_Server/ ./

# Build backend
RUN pnpm run build

# Install Python dependencies if requirements.txt exists
RUN if [ -f src/python/requirements.txt ]; then \
    pip3 install --no-cache-dir --break-system-packages -r src/python/requirements.txt; \
    fi

# ============================================
# Final production image - Combined
# ============================================
FROM node:18-alpine AS production

# Install runtime dependencies (including curl for healthcheck)
RUN apk add --no-cache python3 py3-pip dumb-init curl && \
    npm install -g pm2 pnpm

# Set working directory
WORKDIR /app

# ============================================
# Copy Frontend build artifacts
# ============================================
COPY --from=frontend-builder /app/frontend/.next ./frontend/.next
COPY --from=frontend-builder /app/frontend/public ./frontend/public
COPY --from=frontend-builder /app/frontend/package.json ./frontend/package.json
COPY --from=frontend-builder /app/frontend/next.config.ts ./frontend/next.config.ts

# ============================================
# Copy Backend build artifacts
# ============================================
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/package.json ./backend/package.json
COPY --from=backend-builder /app/backend/src/python ./backend/src/python
COPY --from=backend-builder /app/backend/public ./backend/public

# ============================================
# Install production dependencies
# ============================================
# Frontend dependencies
WORKDIR /app/frontend
COPY visheart-frontend/pnpm-lock.yaml ./
RUN pnpm install --prod --no-frozen-lockfile --shamefully-hoist

# Backend dependencies
WORKDIR /app/backend
COPY Cardiac_Segmentation_FYP_Server/pnpm-lock.yaml ./
RUN pnpm install --prod --no-frozen-lockfile --shamefully-hoist

# Install Python requirements in final image
RUN if [ -f src/python/requirements.txt ]; then \
    pip3 install --no-cache-dir --break-system-packages -r src/python/requirements.txt; \
    fi

# ============================================
# Setup PM2 ecosystem config for LOCAL
# ============================================
WORKDIR /app
COPY visheart-local-deployment/ecosystem.config.js ./ecosystem.config.js

# Create necessary directories
RUN mkdir -p /app/logs backend/src/temp_upload backend/src/temp_jpeg backend/src/temp_mesh

# Set runtime environment variables for LOCAL deployment
ENV NODE_ENV=development
ENV NEXT_PUBLIC_API_URL=http://localhost:5000
ENV NEXT_PUBLIC_ENV=development

# Expose both ports
EXPOSE 3000 5000

# Health check - check both services
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/ && curl -f http://localhost:5000/ || exit 1

# Start both frontend and backend with PM2
CMD ["pm2-runtime", "start", "ecosystem.config.js"]
