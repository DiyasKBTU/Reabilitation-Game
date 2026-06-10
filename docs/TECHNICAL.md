# RehabGame — Техническая документация

> Актуально на 2026-06-05. Стек: FastAPI + MongoDB + React + BLE (ESP32-C3).

---

## 1. Архитектура

```
ESP32-C3 + IMU
     │ BLE
     ▼
packages/ble/        ← BleService (ES-модуль, EventTarget)
     │ события data
     ▼
web/ (React SPA)     ← Vite + Tailwind + Zustand
     │ REST /api/*
     ▼
api/ (FastAPI)       ← JWT, Beanie ODM
     │
     ├── MongoDB (rehabgame)
     └── api/app/ml/  ← ML-модуль (features + anomaly + recommendations)
```

**Порты по умолчанию:**

| Сервис | Порт |
|--------|------|
| FastAPI backend | 8000 |
| React frontend (Vite dev) | 5173 |
| MongoDB | 27017 |

---

## 2. Структура проекта

```
rehabgame/
├── api/                  FastAPI backend
│   ├── app/
│   │   ├── main.py       Точка входа, CORS, lifespan
│   │   ├── config.py     pydantic-settings (.env)
│   │   ├── database.py   Beanie + Motor init
│   │   ├── auth/         JWT, bcrypt, deps (get_current_user и т.д.)
│   │   ├── models/       Beanie Documents: User, Patient, Session, Score
│   │   ├── schemas/      Pydantic схемы запросов/ответов
│   │   ├── routes/       auth, patients, sessions, insights, leaderboard,
│   │   │                  profile, admin
│   │   ├── ml/           features.py, anomaly.py, recommendations.py,
│   │   │                  router.py (/api/ml/*), models/anomaly_model.joblib
│   │   └── ingest/       firebase.py (нормализатор Firebase RTDB → структуры RehabGame)
│   ├── scripts/          import_firebase.py (CLI импорта Firebase → MongoDB)
│   ├── tests/            test_firebase_ingest.py (нормализация + ML на частичных данных)
│   ├── requirements.txt
│   ├── .env.example
│   └── Dockerfile
│
├── web/                  React SPA
│   ├── src/
│   │   ├── api/          apiFetch + api object (все эндпоинты)
│   │   ├── stores/       authStore, bleStore (BLE singleton), sessionStore
│   │   ├── components/   AppLayout, AuthLayout, BlePanel,
│   │   │                  AnomalyBadge, SessionChart
│   │   └── pages/        Login, Register, GameSelect, Game2D, Game3D (lazy),
│   │                      SessionResult, PatientList, PatientDetail,
│   │                      Leaderboard, Profile, Admin
│   ├── vite.config.js    Proxy /api→:8000, алиасы @ble @game2d @game3d, three
│   └── package.json
│
├── packages/             Framework-agnostic ES-модули (не трогать)
│   ├── ble/              BleService (EventTarget, EMA фильтр, клавиатурный fallback)
│   ├── game-2d/          Game2DEngine (Space Catcher, canvas 2D) + demo.html
│   ├── game-3d/          Game3DEngine (City Driver, Three.js) + demo.html
│   ├── api-client/       REST клиент (legacy reference)
│   └── auth/             JWT helpers (legacy reference)
│
├── ml-service/           Standalone ML: обучение + тесты + debug-UI
│   ├── app/              features.py (эталон), anomaly.py, train.py
│   ├── data/             synthetic.py, real_data_loader.py
│   ├── tests/            test_parity.py (Python ↔ api/app/ml/ паритет)
│   └── debug-ui/         HTML инструмент: IMU JSON → аналитика
│
├── tools/
│   ├── imu-simulator/    Генератор IMU-данных (без устройства)
│   └── imu-recorder/     Запись с BLE → JSON
│
├── docs/                 (этот файл + CHANGELOG.md + ML_CONTRACT.md)
├── docker-compose.yml
└── CLAUDE.md
```

---

## 3. API эндпоинты

Все эндпоинты с префиксом `/api`. Авторизация: `Authorization: Bearer <JWT>`.

### Auth
| Метод | Путь | Тело | Ответ | Роль |
|-------|------|------|-------|------|
| POST | `/auth/register` | `{username, email, password, role}` | `{access_token, user}` | — |
| POST | `/auth/login` | `{username, password}` | `{access_token, user}` | — |
| GET | `/auth/me` | — | `{id, username, email, role}` | любая |

### Patients
| Метод | Путь | Описание | Роль |
|-------|------|----------|------|
| GET | `/patients` | Список: doctor→свои, admin→все, patient→себя | любая |
| POST | `/patients` | Создать пациента | doctor/admin |
| GET | `/patients/{id}` | Карточка пациента | любая |
| PATCH | `/patients/{id}` | Обновить данные | doctor/admin |

### Sessions
| Метод | Путь | Описание | Роль |
|-------|------|----------|------|
| POST | `/sessions` | Сохранить сессию (считает features) | любая |
| GET | `/sessions?patient_id&game_type&limit` | Список сессий | любая |
| GET | `/sessions/{id}` | Одна сессия | любая |
| PATCH | `/sessions/{id}/label` | Добавить метку (боль, усталость) | любая |

### Аналитика и прочее
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/insights/{patient_id}?game_type` | ML-аналитика пациента |
| GET | `/leaderboard?game_type&limit` | Рейтинг |
| GET | `/profile` | Профиль текущего пользователя |
| PATCH | `/profile` | Обновить профиль |
| GET | `/admin/users` | Все пользователи | admin |
| PATCH | `/admin/users/{id}` | Изменить роль/доступ | admin |
| DELETE | `/admin/users/{id}` | Удалить пользователя | admin |
| GET | `/health` | Статус сервиса + версия ML-модели + `demo_mode` |

### ML (отдельный роутер, можно тестировать изолированно)
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/ml/features` | Вычислить признаки из IMU time-series |
| POST | `/ml/predict` | Полный пайплайн: features → anomaly → recommendations |
| GET | `/ml/health` | Статус модели |

---

## 4. Модели данных (MongoDB)

### User
```
username: str (unique)  email: str (unique)  password_hash: str
role: patient|doctor|admin  platform_access: bool  database_access: bool
created_at: datetime
```

### Patient
```
user_id: ObjectId?   doctor_id: ObjectId?   full_name: str
diagnosis: str?  age: int?  gender: str?  created_at: datetime
source: str?  source_id: str?     # провенанс импорта (напр. "firebase" + ключ RTDB)
```

### Session
```
patient_id: ObjectId  doctor_id: ObjectId?  game_type: str  game_name: str
score: int  max_combo: int  zone_hits: int  duration_sec: float  level: int
imu_time_series: [{t, r, p, y}]  features: dict?  label: dict?
axis_features: dict?               # multi-axis игры: {ось: features} по вторичным осям (напр. pitch в City Driver); не идут в модель
device_metrics: dict?              # агрегаты устройства из Firebase (strengthIndex, movementCount, …)
source: str?  source_id: str?      # провенанс импорта (идемпотентность); features.partial=True у импорта
created_at: datetime
```

### Score
```
patient_id: ObjectId  username: str  game_type: str  score: int  created_at: datetime
```

---

## 5. ML-модуль

Расположен в `api/app/ml/` (встроен в бэкенд). Код идентичен `ml-service/app/`.

### Признаки движения (axis=roll по умолчанию)
`rom, minAngle, maxAngle, peakVelocity, meanAbsVelocity, meanJerk, smoothnessIndex, tremorIndex, tremorFreqHz, tremorPower, symmetryIndex, pauseRatio, repetitions, activeTimeSec`

Важно: MA(3) сглаживание перед дифференцированием + dt-нормализация (исправлены ошибки вырождения v7.1).

**Частотный анализ дрожи (v8.5):** `tremorFreqHz` — доминирующая частота дрожи в полосе 3–12 Гц,
`tremorPower` — доля спектральной мощности в этой полосе (0..1). Считаются прямым ДПФ (чистый Python,
без numpy → паритет тривиален). Это два самых важных признака модели аномалий (importance 0.21/0.18).

### Модель аномалий
- `api/app/ml/models/anomaly_model.joblib` — IsolationForest + RandomForest + RobustScaler
- Версия **v6-2026-06-08-spectral-synthetic**, `validation: none`, обучена на синтетике (600 сессий),
  вектор из 14 признаков (добавлены спектральные `tremorFreqHz`/`tremorPower`)
- ROC-AUC 0.990 **посчитан на синтетике** (label = параметры генератора) → это НЕ клиническая
  метрика. До клин. валидации основной механизм аномалий — персональный z-score baseline (rule-режим).
- Статус модели: `GET /api/ml/health` (поля `validation`, `synthetic_only`, `metrics_note`).
- Переобучить (Windows, из корня): `$env:PYTHONPATH="ml-service"; $env:PYTHONIOENCODING="utf-8";`
  `venv\Scripts\python.exe -m app.train`, затем скопировать joblib в `api/app/ml/models/`.
- Тесты признаков: `venv\Scripts\python.exe -m pytest ml-service/tests/ -v` (5 проверок)

---

## 5a. Игры

Каждая игра — чистый движок (`packages/`), который принимает `canvas` и колбэки.
Никакого DOM/fetch/localStorage внутри. Контракт колбэка одинаков для всех:
`onGameOver({ score, maxCombo, zoneHits, imuTimeSeries, durationSec, level, gameType, gameName })`.

| game_type | Игра | Движок | Ось | Технология | HUD |
|-----------|------|--------|-----|------------|-----|
| `game1` | Space Catcher | `Game2DEngine` (`@game2d`) | roll | Canvas 2D | рисуется на canvas |
| `game2` | City Driver | `Game3DEngine` (`@game3d`) | roll | Three.js (WebGL) | DOM-оверлей (React) |

**Интеграция во фронте:**
- `Game2D.jsx` — статический импорт (без тяжёлых зависимостей).
- `Game3D.jsx` — **ленивый** (`React.lazy`), т.к. Three.js ~115 KB gzip. Грузится
  отдельным чанком только при заходе на `/game/3d` → стартовый бандл не раздут,
  навигация без лагов.
- Оба подписываются на `bleService` события `data` → `engine.updateInput(roll, pitch, yaw)`.
  Клавиатурный fallback (← →) идёт тем же путём через `BleService.enableKeyboard()`.
- ROM-метр в City Driver обновляется императивно через `ref` (без re-render React каждый кадр).

**Ось управления** определяется на бэкенде по `game_type` (`api/app/ml/games.py`).
`GAME_AXIS` — ПЕРВИЧНАЯ ось (на ней работает модель аномалий, нарратив, рекомендации); сейчас
обе игры — roll. `SECONDARY_AXES` — дополнительные оси multi-axis игр: City Driver пишет ещё и
`pitch` (газ/тормоз). Вторичные оси считаются тем же `extract_features`, отдаются в `/api/insights`
полем `axis_features` и показываются врачу («Вторая ось управления»), но в модель аномалий НЕ
подаются (модель обучена на одной оси). См. `docs/ML_CONTRACT.md` §4.

**Standalone-тест без бэкенда:** `packages/game-3d/demo.html` (Three.js с CDN через importmap),
`packages/game-2d/demo.html`.

---

## 6. Переменные окружения

Файл `api/.env` (создать из `api/.env.example`):

| Переменная | Описание | По умолчанию |
|-----------|----------|--------------|
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017/rehabgame` |
| `JWT_SECRET` | Секрет для JWT (мин. 32 символа) | dev-only значение |
| `JWT_EXPIRE_DAYS` | Срок жизни токена | `30` |
| `ALLOWED_ORIGINS` | CORS origins через запятую | `http://localhost:5173,...` |
| `ADMIN_USERNAME` | Логин авто-созданного admin | `admin` |
| `ADMIN_EMAIL` | Email авто-созданного admin | `admin@example.com` |
| `ADMIN_PASSWORD` | Пароль admin (пусто = не создавать) | `""` |
| `DEMO_MODE` | Демо для инвесторов: засев демо-данных + кнопки входа | `false` |
| `LLM_ENABLED` | Включить LLM-заключение (иначе шаблон) | `false` |
| `LLM_PROVIDER` | `none` \| `openai` \| `claude` | `none` |
| `LLM_MODEL` | Модель LLM | `gpt-4o-mini` |
| `LLM_API_KEY` | Ключ провайдера LLM | `""` |
| `LLM_TIMEOUT_SEC` | Таймаут запроса к LLM | `15` |

---

## 7. Запуск

### Docker (рекомендуется)
```bash
docker compose up
# Frontend: http://localhost:5173
# API:      http://localhost:8000
# Docs:     http://localhost:8000/docs
```

### Вручную (dev)
```powershell
# Terminal 1 — MongoDB
docker compose up mongo

# Terminal 2 — FastAPI
cd api
..\venv\Scripts\uvicorn app.main:app --reload --port 8000

# Terminal 3 — React
cd web
npm run dev   # http://localhost:5173
```

### Тестирование
```powershell
# ML паритет (Python ↔ api/app/ml/)
venv\Scripts\python.exe -m pytest ml-service/tests/ -v

# Frontend сборка
cd web && npm run build

# Игры standalone (без бэкенда; клавиши ← → или BLE)
start packages\game-2d\demo.html   # Space Catcher
start packages\game-3d\demo.html   # City Driver (Three.js c CDN)

# ML debug UI (нужен запущенный бэкенд)
start ml-service\debug-ui\index.html

# IMU симулятор (без устройства)
start tools\imu-simulator\index.html
```

---

## 8. BLE-устройство

**ESP32-C3 + IMU** подключается через Web Bluetooth API.  
Пакет `packages/ble/index.js` — framework-agnostic ES-модуль, не трогать без необходимости.

```js
// Использование в React
import { BleService } from '@ble/index.js';
const ble = new BleService({ alpha: 0.22 });
ble.addEventListener('data', (e) => {
  const { smooth } = e.detail;  // {roll, pitch, yaw} — отфильтрованные углы
});
await ble.connect();        // открывает браузерный диалог
ble.enableKeyboard(3);      // ← → клавиши = fallback без устройства
```

Ось управления: **roll** → game1 (Space Catcher) и game2 (City Driver, руление).
Ось на признаки выбирается по `game_type` в `api/app/ml/games.py` — для будущей игры
на pitch (сгибание/разгибание) достаточно дописать запись в `GAME_AXIS`.

---

## 9. Демо-режим (показ инвесторам)

Включается флагом `DEMO_MODE=true` в `api/.env` (перезапустить бэкенд).

- **Засев** (`api/app/demo/seed.py`, идемпотентно): демо-врач, демо-пациент и 5 пациентов с
  готовыми сессиями (11–14 каждому). Профили дают разные ML-вердикты: норма, «Внимание»
  (постинсультная асимметрия), «Критично» (тремор Паркинсона ~5 Гц и болевое обострение).
  Дашборд (KPI, аномалии, рекомендации, тренды, спектр дрожи) заполнен сразу.
- **Вход** — кнопки на странице логина (появляются, когда `GET /api/health` вернул `demo_mode: true`):
  «Войти как врач» / «Войти как пациент».

| Роль | Логин | Пароль |
|------|-------|--------|
| Врач | `demo_doctor` | `demo1234` |
| Пациент | `demo_patient` | `demo1234` |

`DEMO_MODE=false` (по умолчанию) — чистая база, без демо-данных и кнопок.
