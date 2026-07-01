# Axis

Геймифицированная реабилитационная платформа. Пациент управляет игрой движением кисти (ESP32-C3 + IMU через BLE). Врач получает ML-аналитику движений.

```
ESP32-C3 + IMU  →BLE→  React SPA  →REST→  FastAPI + MongoDB
                                               └── ML встроен
```

---

## Быстрый старт

### Вариант 1 — Docker

```bash
cp api/.env.example api/.env   # заполни JWT_SECRET и ADMIN_PASSWORD
docker compose up
```

| Сервис | URL |
|--------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| API docs (Swagger) | http://localhost:8000/docs |

### Вариант 2 — Вручную

**Требования:** Python 3.10+, Node.js 18+, MongoDB, Chrome/Edge (для BLE)

```powershell
# Terminal 1 — MongoDB
docker compose up mongo

# Terminal 2 — FastAPI backend
cd api
cp .env.example .env           # заполни JWT_SECRET
..\venv\Scripts\pip install -r requirements.txt
..\venv\Scripts\uvicorn app.main:app --reload --port 8000

# Terminal 3 — React frontend
cd web
npm install
npm run dev                    # → http://localhost:5173
```

**Первый вход:** зарегистрируйся через `/register`. Для admin-аккаунта задай `ADMIN_PASSWORD` в `api/.env`.

---

## Структура проекта

```
rehabgame/
├── api/              FastAPI backend (Python)
│   ├── app/
│   │   ├── main.py   Точка входа, CORS, lifespan
│   │   ├── auth/     JWT, bcrypt, deps
│   │   ├── models/   User, Patient, Session, Score (Beanie)
│   │   ├── routes/   auth, patients, sessions, insights, leaderboard, profile, admin
│   │   └── ml/       features.py, anomaly.py, recommendations.py, router.py
│   └── Dockerfile
│
├── web/              React SPA (Vite + Tailwind)
│   └── src/
│       ├── stores/   authStore, bleStore (BLE singleton), sessionStore
│       ├── components/ AppLayout, BlePanel, AnomalyBadge, SessionChart
│       └── pages/    Login, Register, GameSelect, Game2D, SessionResult,
│                      PatientList, PatientDetail, Leaderboard, Profile, Admin
│
├── packages/         Framework-agnostic ES-модули
│   ├── ble/          BleService (EventTarget, EMA, keyboard fallback)
│   └── game-2d/      Game2DEngine (Space Catcher) + demo.html
│
├── ml-service/       Обучение модели + тесты паритета + debug-UI
├── tools/            IMU симулятор и рекордер
├── docs/             TECHNICAL.md, CHANGELOG.md, ML_CONTRACT.md
└── docker-compose.yml
```

---

## Архитектура

**BLE singleton** — `bleStore.js` держит один `BleService` на всё время SPA. Соединение не рвётся при навигации между страницами.

**Игровой движок изолирован** — `packages/game-2d/index.js` это чистый класс `Game2DEngine(canvas, opts)`. Принимает canvas снаружи, вызывает `onGameOver(data)` по завершении.

**ML встроен в бэкенд** — `api/app/ml/` содержит тот же код, что `ml-service/`. Отдельный сервис не нужен. Для изолированного тестирования: `POST /api/ml/predict`.

---

## Тестирование

```powershell
# ML паритет (убедиться что api/app/ml/features.py ≡ ml-service/app/features.py)
venv\Scripts\python.exe -m pytest ml-service/tests/ -v

# Game 2D без backend и BLE
start packages\game-2d\demo.html

# ML Debug UI (нужен запущенный бэкенд)
start ml-service\debug-ui\index.html

# Переобучение модели
cd ml-service
..\venv\Scripts\python.exe -m app.train
```

---

## Переменные окружения (`api/.env`)

| Переменная | Описание |
|-----------|----------|
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Секрет JWT (мин. 32 символа) |
| `ALLOWED_ORIGINS` | CORS origins через запятую |
| `ADMIN_PASSWORD` | Пароль admin (пусто = не создавать) |

Полный список — `docs/TECHNICAL.md` §6.
