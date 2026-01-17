# Multi-stage build для оптимизации размера образа
FROM node:20-alpine AS base

# Установка pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Этап установки зависимостей
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Этап сборки
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Генерация Prisma Client
RUN pnpm db:generate

# Компиляция TypeScript
RUN pnpm build

# Проверка что dist создан
RUN ls -la dist/ || (echo "ERROR: dist directory not found after build" && exit 1)
RUN echo "=== Contents of dist/ ===" && ls -la dist/ | head -20
RUN echo "=== Looking for server.js ===" && find dist -name "server.js" -type f
RUN if [ -f "dist/src/server.js" ]; then echo "Found dist/src/server.js"; else echo "ERROR: dist/src/server.js not found after build" && exit 1; fi

# Production образ
FROM base AS runner

ENV NODE_ENV=production

WORKDIR /app

# Создаем непривилегированного пользователя
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Копируем только необходимые файлы
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist
COPY --from=build --chown=nodejs:nodejs /app/generated ./generated
COPY --from=build --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/package.json ./package.json
COPY --from=build --chown=nodejs:nodejs /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nodejs:nodejs /app/prisma.config.ts ./prisma.config.ts

USER nodejs

EXPOSE 4444

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4444/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Запуск приложения
CMD ["node", "dist/src/server.js"]

