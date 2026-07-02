# Деплой на сервер (Linux) — шпаргалка команд

Целевой сервер — слабый VPS (~1 ГБ RAM), на котором уже работает другой проект.
Деплоим ТОЛЬКО через `docker-compose.prod.yml` (nginx со статикой + лимиты памяти).
Обычный `docker compose up` (dev-стек с Vite) на таком сервере запускать НЕЛЬЗЯ —
проверено 2026-07-01: OOM-killer убил uvicorn и mongosh, хост завис.

---

## 0. Включить swap (ОБЯЗАТЕЛЬНО, один раз)

На сервере 960 МБ RAM и нет swap — любой пик памяти валит хост. Под root:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
# сохранить после перезагрузки
echo '/swapfile none swap sw 0 0' >> /etc/fstab
# свопить только при реальной нехватке памяти
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
sysctl -p /etc/sysctl.d/99-swap.conf

free -h   # должно показать Swap: 2.0Gi
```

## 1. Deploy key (один раз)

Репозиторий приватный → серверу нужен Deploy Key (доступ только на чтение,
только к этому репо). Не используйте личный `gh auth login` на чужом/корпоративном
сервере — это отдаёт токен с доступом ко всему вашему GitHub-аккаунту.

```bash
ssh-keygen -t ed25519 -C "rehabgame-server" -f ~/.ssh/rehabgame_deploy -N ""
cat ~/.ssh/rehabgame_deploy.pub
```

Скопировать вывод (строка вида `ssh-ed25519 AAAA... rehabgame-server`) →
на GitHub: репозиторий → **Settings → Deploy keys → Add deploy key** →
вставить в поле **Key**, в **Title** — любое имя. Галку "Allow write access"
**не ставить**.

Добавить алиас в SSH-конфиг, чтобы не указывать ключ каждый раз:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-rehabgame
    HostName github.com
    User git
    IdentityFile ~/.ssh/rehabgame_deploy
    IdentitiesOnly yes
EOF
```

## 2. Клонирование репозитория

```bash
git clone git@github-rehabgame:DiyasKBTU/Reabilitation-Game.git rehabgame
cd rehabgame
```

Обновление кода позже:

```bash
cd rehabgame && git pull
```

## 3. Конфигурация окружения

Создать `.env` в корне проекта (читается `docker-compose.prod.yml`):

```bash
cat > .env <<'EOF'
JWT_SECRET=CHANGE_ME_RANDOM_32_CHARS
ADMIN_USERNAME=admin
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=CHANGE_ME
DEMO_MODE=true
WEB_PORT=8080
ALLOWED_ORIGINS=http://IP_СЕРВЕРА:8080
EOF
```

Сгенерировать случайный `JWT_SECRET`:

```bash
openssl rand -hex 32
```

Без `JWT_SECRET` prod-compose откажется стартовать — это намеренно.

## 4. Запуск стека

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Первая сборка фронта (npm ci + vite build) на слабом VPS идёт 5–15 минут —
это нормально, пик сборки уходит в swap. Дальше пересборка нужна только
после изменения кода.

Править `docker-compose.prod.yml` не нужно: MongoDB и API наружу не
публикуются вообще (только внутренняя docker-сеть), наружу смотрит один nginx.

## 5. Файрвол — открыть только фронт наружу

```bash
sudo ufw allow 8080/tcp
```

## 6. Проверка

```bash
curl -s http://localhost:8080/api/health   # API через nginx-прокси
curl -I http://localhost:8080              # SPA
```

Открыть в браузере: `http://<IP_СЕРВЕРА>:8080`

---

## Бюджет памяти (лимиты в docker-compose.prod.yml)

| Сервис | Лимит | Типично | Примечание |
|--------|-------|---------|-----------|
| mongo | 384 МБ | ~200–300 МБ | Кэш WiredTiger зажат до 256 МБ; healthcheck — TCP, не mongosh |
| api | 300 МБ | ~150–200 МБ | BLAS/OpenMP в 1 поток, uvicorn 1 worker |
| web (nginx) | 32 МБ | ~5 МБ | Только статика + прокси /api |
| **Итого** | **≤716 МБ** | **~350–450 МБ** | Соседнему проекту остаётся место |

`oom_score_adj` (api 300 > mongo 200 > web 100) — если память всё же кончится,
ядро убьёт сначала наши контейнеры (api первым — он перезапустится через
`restart: unless-stopped`), а не соседний проект.

## Диагностика, если что-то пошло не так

```bash
docker compose -f docker-compose.prod.yml logs -f --tail 100   # логи стека
dmesg -T | grep -i -E "killed process|out of memory"           # был ли OOM
docker stats --no-stream                                        # кто ест память
free -h                                                         # RAM + swap
```

## Чего НЕ делать на сервере

- Не запускать `docker compose up` без `-f docker-compose.prod.yml` — dev-стек
  с Vite dev-сервером гарантированно уложит хост в 1 ГБ.
- Не запускать `mongosh` «просто посмотреть» при загруженной памяти — это
  Node-процесс на ~150 МБ (именно его OOM-killer убивал 2026-07-01).
- Не открывать 27017/8000 наружу — в prod-конфиге они и не публикуются.

---

## Опционально: бесплатный "домен" вместо голого IP

Без регистрации, сразу работает:

```
http://<IP_СЕРВЕРА>.nip.io:8080
```

Или постоянный поддомен через DuckDNS (duckdns.org) → указывает на IP сервера,
плюс потом можно навесить бесплатный HTTPS через certbot.

---

## Остановка / пересборка

```bash
docker compose -f docker-compose.prod.yml down            # остановить
docker compose -f docker-compose.prod.yml up -d --build   # пересобрать после git pull
docker compose -f docker-compose.prod.yml logs -f api     # логи бэкенда
```
