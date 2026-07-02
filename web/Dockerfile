# Прод-образ фронта: Vite build → статика в nginx (~5 МБ RAM вместо dev-сервера).
# Контекст сборки — КОРЕНЬ репозитория (нужен доступ к packages/), см. docker-compose.prod.yml:
#   build: { context: ., dockerfile: web/Dockerfile }

FROM node:20-alpine AS build
WORKDIR /app

COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Алиасы vite.config.js резолвят ../packages/* относительно /app → кладём в /packages
COPY packages /packages
COPY web ./

# Ограничение кучи node: сборка должна проходить на VPS с 1 ГБ RAM (+swap)
ENV NODE_OPTIONS=--max-old-space-size=512
RUN npm run build

FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
