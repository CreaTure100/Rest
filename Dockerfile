# syntax=docker/dockerfile:1
ARG NODE_VERSION=22

# --- все зависимости (сборка фронтенда и тесты) ---
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# --- только production-зависимости (для backend) ---
FROM node:${NODE_VERSION}-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN (npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund) && npm cache clean --force

# --- сборка frontend ---
FROM deps AS web-build
COPY . .
ARG VITE_BASE=/
ENV VITE_BASE=${VITE_BASE}
RUN npm run build

# --- frontend: nginx отдаёт статику и проксирует /api в backend ---
FROM nginx:1.27-alpine AS frontend
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

# --- backend: миграции (+ seed в development) и запуск API ---
FROM node:${NODE_VERSION}-slim AS backend
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json knexfile.js server.js ./
COPY server ./server
COPY db ./db
COPY scripts ./scripts
COPY public ./public
USER node
EXPOSE 3001
CMD ["sh", "-c", "node scripts/db-init.js && node server.js"]

# --- тесты (docker compose --profile test run --rm tests) ---
FROM deps AS test
COPY . .
ENV NODE_ENV=test
CMD ["npm", "run", "test:all"]
