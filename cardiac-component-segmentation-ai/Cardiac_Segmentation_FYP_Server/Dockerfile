# =========================
# Stage 1: Builder
# =========================
FROM node:18-alpine AS builder
WORKDIR /app

# Install system dependencies (git for pnpm Git-based deps)
RUN apk add --no-cache python3 py3-pip git

# Install pnpm globally
RUN npm install -g pnpm

# Copy dependency files
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (dev included for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application (TypeScript → JS)
RUN pnpm run build


# =========================
# Stage 2: Production
# =========================
FROM node:18-alpine
WORKDIR /app

# Install lightweight runtime dependencies
RUN apk add --no-cache python3 py3-pip libgomp

# Install pnpm globally
RUN npm install -g pnpm

# Copy dependency files
COPY package.json pnpm-lock.yaml ./

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy and install Python dependencies
COPY src/python/requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Copy built app and static assets from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY src/python/*.py ./dist/python/

# Expose the backend port
EXPOSE 5000

# Run the server
CMD ["node", "dist/index.js"]
