# Многоступенчатая сборка: в итоговый образ не попадают ни исходники
# TypeScript, ни инструменты сборки — только собранный код и рабочие зависимости.

# ---------- Этап 1: сборка ----------
FROM node:22-alpine AS builder

WORKDIR /app

# Сначала только манифесты: слой с зависимостями пересобирается лишь
# когда меняются сами зависимости, а не при каждой правке кода.
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci

COPY shared ./shared
COPY backend ./backend
COPY frontend ./frontend


# Удаляем старый кэш TypeScript, чтобы сборка не использовала
# информацию от предыдущей компиляции.
RUN rm -f shared/tsconfig.tsbuildinfo \
          backend/tsconfig.tsbuildinfo \
          frontend/tsconfig.tsbuildinfo \
 && npm run build -w shared \
 && npm run build -w backend \
 && npm run build -w frontend


# Оставляем только рабочие зависимости.
RUN npm prune --omit=dev

# ---------- Этап 2: рабочий образ ----------
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Приложение не работает от root: если его удастся скомпрометировать,
# права внутри контейнера будут минимальными.
RUN addgroup -S tbedu && adduser -S tbedu -G tbedu

COPY --from=builder --chown=tbedu:tbedu /app/node_modules ./node_modules
COPY --from=builder --chown=tbedu:tbedu /app/package.json ./package.json
COPY --from=builder --chown=tbedu:tbedu /app/shared/dist ./shared/dist
COPY --from=builder --chown=tbedu:tbedu /app/shared/package.json ./shared/package.json
COPY --from=builder --chown=tbedu:tbedu /app/backend/dist ./backend/dist
COPY --from=builder --chown=tbedu:tbedu /app/backend/package.json ./backend/package.json
COPY --from=builder --chown=tbedu:tbedu /app/backend/src/db/migrations ./backend/src/db/migrations
COPY --from=builder --chown=tbedu:tbedu /app/frontend/dist ./frontend/dist

# Каталог для загруженных файлов при FILE_STORAGE=local.
RUN mkdir -p /app/storage-data && chown tbedu:tbedu /app/storage-data
VOLUME /app/storage-data

USER tbedu
EXPOSE 3000

# Платформа деплоя опрашивает этот адрес, чтобы понять, поднялось приложение или нет.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"


CMD ["sh", "-c", "node backend/dist/scripts/migrate.js && node backend/dist/scripts/seed.js && exec node backend/dist/main.js"]

