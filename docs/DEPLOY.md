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

## 7. HTTPS — обязателен для подключения устройства (BLE)

Web Bluetooth (подключение ESP32 из браузера) работает ТОЛЬКО по `https://` или на
`localhost`. По `http://<IP>:8080` кнопка подключения не сработает: браузер не даёт
`navigator.bluetooth`. Значит для теста с пациентами нужен HTTPS. Два пути:

### Вариант A. Cloudflare Tunnel — быстрый HTTPS без домена (для теста сейчас)

Даёт временный адрес `https://<random>.trycloudflare.com` с доверенным сертификатом
(без предупреждений), проксирующий на наш nginx. Домен и открытые порты не нужны —
`cloudflared` соединяется с Cloudflare исходящим соединением.

```bash
# запустить стек ВМЕСТЕ с туннелем (профиль tunnel)
docker compose -f docker-compose.prod.yml --profile tunnel up -d --build

# узнать выданный URL (искать строку https://...trycloudflare.com)
docker compose -f docker-compose.prod.yml logs cloudflared | grep -i trycloudflare
```

Открывать пациентам именно этот `https://...trycloudflare.com` — тогда подключение
устройства заработает.

Особенности:
- URL меняется при каждом рестарте контейнера `cloudflared` (для постоянного нужен домен — вариант B).
- Приложение становится доступно из интернета (за экраном логина/JWT). Для медданных
  это осознанный компромисс на время теста — не оставлять туннель включённым постоянно.
- Открывать только в Chrome/Edge (desktop или Android). На iPhone/iPad Web Bluetooth нет вообще.
- Остановить только туннель, оставив стек:
  `docker compose -f docker-compose.prod.yml stop cloudflared`

### Вариант B. Домен + общий Caddy сервера — постоянный HTTPS ✅ так работает прод

Постоянный адрес, доверенный сертификат Let's Encrypt, трафик не идёт через третью сторону.

Порт 443 на сервере один на все проекты, поэтому HTTPS даёт общий Caddy в `/opt/caddy`
(контейнер `caddy`). Он не принадлежит ни одному проекту: остановка, обновление или `down`
нашего стека не задевает соседние сайты, и наоборот. У каждого проекта свой файл с доменом
в `/opt/caddy/conf/sites/`, наш — `rehabgame.caddy`. `docker-compose.tls.yml` только
подключает наш web к сети Caddy `edge`. Как устроен сам Caddy — `/opt/caddy/README.md`
на сервере.

**Проверено на практике (2026-07):**
- ✅ **Работает: sslip.io** — «домен без регистрации»: `<IP-через-дефисы>.sslip.io`
  (например `203-0-113-7.sslip.io`) сам резолвится в этот IP, ничего заводить не нужно.
  Именно так сейчас поднят прод.
- ❌ **DuckDNS не сработал**: Let's Encrypt при выпуске сертификата делает CAA-проверку
  DNS, и на `duckdns.org` она стабильно падала с SERVFAIL → сертификат не выдавался.
  Не тратить время.
- ⚠️ DNS-резолвер хостера нестабилен → общему Caddy в `/opt/caddy/compose.yml` прописаны
  публичные DNS `1.1.1.1`/`8.8.8.8` (без этого Caddy не достукивался до Let's Encrypt).
  Docker-имена (rehabgame-web и др.) при этом продолжают резолвиться внутренним DNS.

**Шаг 1. «Завести» домен**
1. Узнать ПУБЛИЧНЫЙ IP сервера — выполнить НА сервере: `curl -s ifconfig.me`.
2. Домен = `<IP с дефисами>.sslip.io`. Проверить: `nslookup <домен>` → должен вернуть IP.

IP у VPS обычно статический. Если появится нормальный платный домен ($1–10/год: Cloudflare
Registrar, Porkbun, Namecheap) — просто заменить домен в `/opt/caddy/conf/sites/rehabgame.caddy`
и сделать reload Caddy (как в шаге 2), остальное не меняется.

**Шаг 2. Подключить домен к общему Caddy** (домен уже должен резолвиться в IP сервера;
общий Caddy и сеть `edge` уже должны быть на сервере — `/opt/caddy/README.md`):

```bash
# файл с нашим доменом (пример для sslip.io; подставь свой домен)
cat > /opt/caddy/conf/sites/rehabgame.caddy <<'EOF'
# rehabgame (Axis): /var/www/axis/rehabgame, контейнер rehabgame-web в сети edge
203-0-113-7.sslip.io {
    reverse_proxy rehabgame-web:80
}
EOF

# остановить туннель (если запускался) и поднять стек с подключением к edge
docker compose -f docker-compose.prod.yml stop cloudflared
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d

# проверить конфиг Caddy и применить без остановки (соседние сайты не прерываются)
docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

# смотреть, как Caddy получает сертификат (ждём "certificate obtained")
docker logs -f caddy
```

**Проверка:** `curl -I https://<домен>` → HTTP-ответ; открыть в Chrome — замок без
предупреждений, подключение устройства работает. Порт 8080 наружу можно закрыть:
`WEB_PORT=127.0.0.1:8080` в `.env` и снова `up -d`. Через `ufw` его не закрыть —
Docker публикует порты в обход ufw.

**Если сертификат не выдался** — по опыту этого сервера, в порядке вероятности:
домен не резолвится в IP сервера (`nslookup`); порт 443 закрыт (файрвол хостера);
CAA-проверка падает SERVFAIL (симптом DuckDNS — сменить домен на sslip.io); резолвер
хостера глючит (лечится `dns: 1.1.1.1` у общего Caddy — уже в `/opt/caddy/compose.yml`).
Caddy повторяет попытки сам — как исправишь причину, подхватит без перезапуска.

**Порт 80 на сервере занят host-nginx** соседних проектов: общий Caddy за него не воюет,
публикует только `443` и выпускает сертификаты через **TLS-ALPN-01** (валидация по 443,
порт 80 не нужен). Минус — нет автоматического http→https редиректа, поэтому пациентам
давать сразу полный `https://…`.

---

## Остановка / пересборка

```bash
docker compose -f docker-compose.prod.yml down            # остановить
docker compose -f docker-compose.prod.yml up -d --build   # пересобрать после git pull
docker compose -f docker-compose.prod.yml logs -f api     # логи бэкенда
```
