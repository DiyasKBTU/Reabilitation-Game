# Axis

Реабилитационная платформа для детей с ДЦП. Пациент управляет игрой движением кисти
(браслет ESP32-C3 + IMU, подключение из браузера по Bluetooth), врач получает
ML-аналитику движений: амплитуда, плавность, тремор, паттерн, динамика к личной норме.

```
ESP32-C3 + IMU  →BLE→  React SPA (web/)  →REST→  FastAPI (api/) + MongoDB
                                                      └── ML встроен (api/app/ml/)
```

---

## Документация — с чего начать

| Документ | Для кого / зачем |
|----------|------------------|
| **docs/HOW_IT_WORKS.md** | Для новичка: как всё устроено «на пальцах» — экраны, путь данных, словарь терминов |
| **docs/TECHNICAL.md** | Для разработчика: архитектура, API, схема БД, ML, учётные данные, запуск |
| **docs/ML_CONTRACT.md** | Формат данных ML: признаки, аномалия, рекомендации, паттерн, ответ `/api/insights` |
| **docs/ML_PIPELINE.md** | Регламент «от сырых данных до модели»: роли, ритм, команды, ворота качества и промоута |
| **docs/DEPLOY.md** | Деплой на прод-сервер (VPS 1 ГБ): docker-compose.prod, swap, HTTPS для BLE |
| **docs/CHANGELOG.md** | История изменений |
| **docs/WORK_PLAN.md** | Живой план работ (6-недельный трекинг ML) |
| **docs/BACKLOG.md** | Известные слабости, баги, возможности |
| **docs/RISK_REGISTER.md** | Реестр рисков: оценка, владелец, митигация, триггер |
| **docs/SECURITY.md** | Безопасность и приватность: классификация данных, меры, чек-лист усиления |
| **docs/RESEARCH_DCP.md** | Доказательная база: формы ДЦП, MACS, литература |

---

## Быстрый старт

### Вариант 1 — Docker (локальная разработка)

```bash
cp api/.env.example api/.env   # заполни JWT_SECRET (и ADMIN_PASSWORD, если нужен админ)
docker compose up
```

| Сервис | URL |
|--------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| API docs (Swagger) | http://localhost:8000/docs |

> На прод-сервере (слабый VPS) — ТОЛЬКО `docker compose -f docker-compose.prod.yml up -d --build`.
> Dev-стек кладёт сервер с 1 ГБ RAM (см. docs/DEPLOY.md).

### Вариант 2 — Вручную

**Требования:** Python 3.10+, Node.js 18+, MongoDB, Chrome/Edge (для Web Bluetooth)

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

### Первый вход

Три пути (подробно — docs/TECHNICAL.md §10):

1. **Самостоятельная регистрация пациента** — `/register` (логин = ИИН ребёнка, 12 цифр).
2. **Тестовые данные** — засеять базу врачами/пациентами с известными паролями:
   `venv\Scripts\python.exe api\scripts\seed_test_data.py` (напечатает все логины/пароли:
   `admin/admin1234`, `doctor1..3/doctor1234`, `patient1..3/patient1234`).
3. **Демо-режим** — `DEMO_MODE=true` в `api/.env`: на странице входа появятся кнопки
   «Войти как врач / как пациент» (`demo_doctor` и `demo_patient`, пароль `demo1234`).

---

## Игры

| game_type | Игра | Управление | Технология |
|-----------|------|-----------|------------|
| `game1` | Space Catcher — ловить шары платформой | roll (наклон кисти вбок) | Canvas 2D |
| `game2` | City Driver — вождение с испытаниями | roll = руль, pitch = газ/тормоз | Three.js (WebGL) |

Без устройства обе игры работают от клавиатуры (← →) — для теста и разработки.

---

## Структура проекта

```
rehabgame/
├── api/              FastAPI backend: auth (JWT), данные, ML (api/app/ml/)
│   └── scripts/      seed_test_data.py (тест-данные), import_firebase.py (импорт истории)
├── web/              React SPA (Vite + Tailwind + Zustand)
├── packages/         Framework-agnostic ES-модули (без React/DOM):
│   ├── ble/          BleService — Web Bluetooth, EMA-фильтр, клавиатурный fallback
│   ├── game-2d/      Game2DEngine (Space Catcher) + demo.html
│   └── game-3d/      Game3DEngine (City Driver, Three.js) + demo.html
├── ml-service/       «Лаборатория» ML: обучение моделей + тесты паритета + debug-UI
├── tools/            imu-simulator (генератор данных), imu-recorder (запись с BLE → JSON)
├── docs/             вся документация (карта выше)
├── docker-compose.yml        dev-стек
├── docker-compose.prod.yml   прод-стек (nginx-статика, лимиты памяти)
└── docker-compose.tls.yml    HTTPS-оверлей: подключает web к общему Caddy сервера — нужен для BLE на проде
```

---

## Тестирование

```powershell
# ML-паритет (api/app/ml/features.py ≡ ml-service/app/features.py)
venv\Scripts\python.exe -m pytest ml-service/tests/ -v

# Бэкенд: импорт Firebase, паттерн, валидность
venv\Scripts\python.exe -m pytest api/tests/ -v

# Фронтенд: тесты и сборка
cd web && npm run test && npm run build

# Игры без бэкенда и BLE (клавиши ← →)
start packages\game-2d\demo.html
start packages\game-3d\demo.html

# ML Debug UI (нужен запущенный бэкенд)
start ml-service\debug-ui\index.html
```

Полная таблица команд — в `CLAUDE.md` и docs/TECHNICAL.md §7.

---

## Переменные окружения (`api/.env`)

| Переменная | Описание |
|-----------|----------|
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Секрет JWT (мин. 32 символа) |
| `ALLOWED_ORIGINS` | CORS origins через запятую |
| `ADMIN_PASSWORD` | Пароль авто-создаваемого admin (пусто = не создавать) |
| `DEMO_MODE` | `true` = засев демо-данных + кнопки быстрого входа |

Полный список — docs/TECHNICAL.md §6.
