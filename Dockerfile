# syntax=docker/dockerfile:1

# ---- base: shared Node image ----
FROM node:22-alpine AS base
WORKDIR /app

# ---- deps: all dependencies (incl. dev) for building and local dev ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- dev: used by docker-compose, runs tsx in watch mode ----
FROM deps AS dev
COPY . .
ENV NODE_ENV=development
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- build: compile TypeScript to dist/ ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps: production dependencies only ----
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime: small final image, no compiler, no dev deps, non-root user ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" || exit 1
CMD ["node", "dist/server.js"]
