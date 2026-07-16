# Axis (RehabGame) — Техническая документация

> Актуально на 2026-07-11. Стек: FastAPI + MongoDB + React + BLE (ESP32-C3).
> Назначение документа: **полная техническая картина для разработчика** — архитектура,
> API, схема БД, ML, данные и учётки, запуск. Если вы новичок в проекте или в IT —
> начните с `HOW_IT_WORKS.md`: там то же самое объяснено «на пальцах», с глоссарием.

### Карта документации (что где искать)
| Документ | Назначение |
|----------|-----------|
| **TECHNICAL.md** (этот) | Полная техническая картина: архитектура, API, схема БД, ML, данные, запуск |
| **HOW_IT_WORKS.md** | То же для новичка: глоссарий, путь движения по системе, экраны и ситуации |
| **ML_CONTRACT.md** | Контракт ответа ML (признаки, аномалия, паттерн, рекомендации) — формат данных |
| **DEPLOY.md** | Деплой на прод-сервер (VPS 1 ГБ): prod-компоуз, swap, HTTPS (Caddy) для BLE |
| **CHANGELOG.md** | История изменений по версиям/датам |
| **WORK_PLAN.md** | Живой resumable-план (6-недельный трекинг ML): что сделано / что дальше |
| **BACKLOG.md** | Слабости/баги/возможности — для дальнейших исправлений |
| **RESEARCH_DCP.md** | Доказательная база ДЦП (формы, MACS, литература) |
| **ML_SPEC.md** | Историко-референсные ML-заметки (Firebase-схема, LLM-принцип) |

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
│   │   ├── components/   AppLayout, AuthLayout, BlePanel, GameIntro (pre-game экран),
│   │   │                  AnomalyBadge, SessionChart, MovementTrace, Disclaimer
│   │   └── pages/        Landing (публичная титульная), Login, Register (пациент, ИИН),
│   │                      RegisterDoctor (по коду приглашения), GameSelect, Calibration,
│   │                      Game2D, Game3D (lazy), SessionResult, DeviceSetup,
│   │                      Dashboard (врач), PatientList, PatientDetail,
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

**Контроль доступа (владение).** Роуты, работающие с конкретным пациентом/сессией
(`/patients/{id}`, `/sessions`, `/insights/{id}`), проверяют владение через
`auth/deps.py: verify_patient_access`: admin → все; doctor → только свои (`doctor_id`); patient →
только своя карточка (`user_id`). Защита от чтения чужих медданных по ID (IDOR).

### Auth
| Метод | Путь | Тело | Ответ | Роль |
|-------|------|------|-------|------|
| POST | `/auth/register` | `{iin, password, consent, full_name?, diagnosis?, age?, gender?}` (ИИН=логин; email синтезируется, если не задан) | `{access_token, user}` | — (только пациент; медданные → карта `patients`) |
| POST | `/auth/register-doctor` | `{username, email, password, invite_code, consent}` | `{access_token, user}` | — (роль doctor; только по коду от админа, B2B-онбординг) |
| POST | `/auth/login` | `{username, password}` (username = ИИН для пациента) | `{access_token, user}`; 429 при переборе (8 неудач/логин или 30/IP за 15 мин, `auth/ratelimit.py`) | — |
| GET | `/auth/me` | — | `{id, username, email, role}` | любая |

### Patients
| Метод | Путь | Описание | Роль |
|-------|------|----------|------|
| GET | `/patients` | Список: doctor→свои, admin→все, patient→себя | любая |
| POST | `/patients` | Создать пациента; с `create_login`+`iin` заводит вход (ИИН=логин, авто-ПИН возвращается один раз) | doctor/admin |
| GET | `/patients/unattached` | Самозарегистрированные пациенты без врача (кандидаты на прикрепление) | doctor/admin |
| GET | `/patients/{id}` | Карточка пациента | любая |
| PATCH | `/patients/{id}` | Обновить данные | doctor/admin |
| POST | `/patients/{id}/attach` | Прикрепить неприкреплённого пациента к себе (пациент сам — не может) | doctor/admin |

### Sessions
| Метод | Путь | Описание | Роль |
|-------|------|----------|------|
| POST | `/sessions` | Сохранить сессию (считает features, гард валидности; `is_calibration=true` → перезапись baseline). Принимает `input_source` (ble/keyboard/mixed/none): не-датчик → без baseline и без записи в рейтинг; ряд > 200 тыс. сэмплов → 422 | любая |
| GET | `/sessions?patient_id&game_type&limit` | Список сессий | любая |
| GET | `/sessions/{id}` | Одна сессия | любая |
| GET | `/sessions/{id}/trace?max_points` | Сырой ряд движения (downsampled) для графика траектории | любая |
| PATCH | `/sessions/{id}/label` | Добавить метку: пациент — `pain` 0–2, `fatigue` 1–10; врач/админ — ещё `quality` 1–5 (качество выполнения движения: 1 — очень плохо, 5 — отлично; экспертный сигнал, в выгрузку датасета) | любая |
| GET | `/sessions/calibration/status?game_type&patient_id` | Откалиброван ли пациент в игре (есть ли baseline) | любая |

**Гард качества сессии (`POST /sessions`).** «Пустой прогон» — игру запустили и не
управляли, машина/платформа разбилась, сработал `onGameOver` → сохраняется сессия с
ROM≈0 и почти нулевыми признаками. Такая сессия помечается `features.valid=False`
(`api/app/ml/validity.py`: `ROM < 5°` ИЛИ `sampleCount < 10` ИЛИ `durationSec < 3` →
невалидна). Сырой `imu_time_series` НЕ удаляется (CLAUDE.md) — невалидна только аналитика.
Зеркалит логику `ingest/firebase.py` (game1 с ROM=0 → `valid=False`). Отдельный слой
поверх вектора признаков → паритет `features.py` не затрагивается.

**Калибровка / персональный baseline (`api/app/calibration.py`).** Первая аналитически
пригодная сессия пациента в каждой игре фиксируется как «калибровочная»
(`Session.is_calibration=True`), её признаки сохраняются как стартовая точка в
`Patient.baselines[game_type]`. Прогресс считается ОТНОСИТЕЛЬНО неё (важно для ДЦП —
«норма» индивидуальна). `ensure_baseline()` идемпотентна и бэкфиллит baseline существующим
карточкам из самой ранней пригодной сессии (миграция данных не нужна). `compute_deltas()`
даёт изменение текущей сессии vs baseline по ключевым метрикам → `/insights.delta_vs_baseline`.

### Аналитика и прочее
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/insights/{patient_id}?game_type` | ML-аналитика по последней ВАЛИДНОЙ сессии: признаки, аномалия, рекомендации, нарратив, **паттерн движения** (`pattern`) |
| GET | `/leaderboard?game_type&limit` | Рейтинг. Отдаёт `display_name` (не username: логин пациента = ИИН, светить его нельзя): своё имя + `is_me`, врач видит имена своих пациентов, остальные — псевдоним «Игрок ····XXXX». Тестовые пациенты исключены; `patient_id` — только врачу/админу |
| GET | `/profile` | Профиль пользователя; для пациента включает медкарту (`patient`: full_name, diagnosis, age, gender) |
| PATCH | `/profile` | Обновить профиль (email + для пациента — своя медкарта) |
| GET | `/admin/users` | Все пользователи | admin |
| PATCH | `/admin/users/{id}` | Изменить роль/доступ (`platform_access=false` теперь реально блокирует вход — проверяется в `get_current_user`; свою учётку админ заблокировать не может) | admin |
| DELETE | `/admin/users/{id}` | Удалить пользователя: тестовый → каскад (карта+сессии+очки); реальный → удаляется только вход, карта и сессии остаются (медданные ценны) | admin |
| GET | `/admin/export/ml-dataset?game_type&include_series&skip&limit` | Выгрузка обучающего датасета: сессии реальных пациентов (без тестовых/демо/клавиатурных), признаки + метки + контекст (диагноз/возраст/пол), личность псевдонимизирована (`patient_key`) | admin |
| GET | `/admin/dataset-stats` | Прогресс сбора ML-данных: реальные пациенты, сессии с датчика/valid, размечено пациентом/врачом, готово к обучению (норма/аномалия по правилу `mongo_loader`) | admin |
| GET | `/admin/doctor-invites` | Список кодов-приглашений для врачей | admin |
| POST | `/admin/doctor-invites` | Сгенерировать одноразовый код врача | admin |
| DELETE | `/admin/doctor-invites/{id}` | Удалить код | admin |
| GET | `/health` | Статус сервиса + версия ML-модели + `demo_mode` |

### ML (отдельный роутер, можно тестировать изолированно)
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/ml/features` | Вычислить признаки из IMU time-series (требует авторизацию — вычисления не для анонимов) |
| POST | `/ml/predict` | Полный пайплайн: features → anomaly → recommendations (требует авторизацию) |
| GET | `/ml/health` | Статус модели (открыт) |

---

## 4. Модели данных (MongoDB)

### User
```
username: str (unique)  email: str (unique)  password_hash: str
role: patient|doctor|admin  platform_access: bool  database_access: bool
consent: bool          # согласие на обработку ПДн (дано при регистрации; обязательно)
created_at: datetime
```

### Patient
```
user_id: ObjectId?   doctor_id: ObjectId?   full_name: str
iin: str?                          # ИИН (12 цифр) = логин пациента (User.username = iin)
diagnosis: str?  age: int?  gender: str?  created_at: datetime
source: str?  source_id: str?     # провенанс импорта (напр. "firebase" + ключ RTDB)
baselines: dict                    # калибровка: {game_type: {session_id, features, calibrated_at, game_name}}
```

### Session
```
patient_id: ObjectId  doctor_id: ObjectId?  game_type: str  game_name: str
score: int  max_combo: int  zone_hits: int  duration_sec: float  level: int
is_calibration: bool               # калибровочная (первая пригодная) сессия → персональный baseline
input_source: str?                 # "ble"|"keyboard"|"mixed"|"none" — источник управления; None = старый клиент.
                                   # Не-датчик: сессия хранится, но НЕ идёт в baseline/рейтинг/ML-датасет
calibration: dict?                 # метрики направляемой калибровки 2 осей: {rollMin/Max/Rom, pitchMin/Max/Rom, targets:{total,hit,avgMs}}
imu_time_series: [{t, r, p, y}]    # ряд углов, 25 Гц, НЕсглаженный (calib) — покрывает полосу тремора 3–12 Гц
features: dict?  label: dict?
performance: dict?                 # реакция на препятствия (City Driver): {reactionMs, avoidanceRate, hazardCount}; навык для врача, не в модель
axis_features: dict?               # multi-axis игры: {ось: features} по вторичным осям (напр. pitch в City Driver); не идут в модель
device_metrics: dict?              # агрегаты устройства из Firebase (strengthIndex, movementCount, …)
source: str?  source_id: str?      # провенанс импорта (идемпотентность); features.partial=True у импорта
created_at: datetime
```

### Score
```
patient_id: ObjectId  username: str  game_type: str  score: int  created_at: datetime
```

### DoctorInvite
```
code: str (unique)   created_by: ObjectId    # админ, выпустивший код
used_by: ObjectId?   used_at: datetime?       # врач, использовавший код (одноразовый)
created_at: datetime
```
Одноразовый код для регистрации врача (B2B). Генерит админ (`POST /admin/doctor-invites`),
врач регистрируется по нему (`POST /auth/register-doctor`) → роль doctor.

---

## 5. ML-модуль

Расположен в `api/app/ml/` (встроен в бэкенд). Код идентичен `ml-service/app/`.

### Признаки движения (axis=roll по умолчанию)
`rom, minAngle, maxAngle, peakVelocity, meanAbsVelocity, meanJerk, smoothnessIndex, tremorIndex, tremorFreqHz, tremorPower, symmetryIndex, pauseRatio, repetitions, activeTimeSec`

Важно: MA(3) сглаживание перед дифференцированием + dt-нормализация (исправлены ошибки вырождения v7.1).

**Частотный анализ дрожи (v8.5):** `tremorFreqHz` — доминирующая частота дрожи в полосе 3–12 Гц,
`tremorPower` — доля спектральной мощности в этой полосе (0..1). Считаются прямым ДПФ (чистый Python,
без numpy → паритет тривиален). Это два самых важных признака модели аномалий (importance 0.21/0.18).

### Валидность сессии (гард пустых прогонов)
`api/app/ml/validity.py` — слой поверх вектора признаков (`features.py` не трогает, паритет цел):
- `mark_validity(features)` — на записи (`POST /sessions`) снимает `valid` у сессий без реального
  движения (ROM < 5° / sampleCount < 10 / durationSec < 3).
- `is_analyzable(features)` — на чтении (`GET /insights`): `latest` выбирается как **первая
  валидная** сессия (а не просто `sessions[0]`), baseline аномалий и тренды считаются только по
  валидным сессиям. Если валидных нет — `/insights` отдаёт пустой ответ (дашборд: «нет данных»).
- Частичные признаки Firebase (ROM-only, `sampleCount=0`, `partial=True`) гард по семплам/длительности
  НЕ трогает — для них валидность определяется их собственным флагом (ROM=0 → `valid=False`, как в
  `ingest/firebase.py`). Срабатывает и ретроспективно на старых сессиях с `valid=True`, ROM≈0.

### Модель аномалий
- `api/app/ml/models/anomaly_model.joblib` — IsolationForest + RandomForest(калибр.) + RobustScaler
- Версия **v7-2026-06-10-realdata-mixed**, `validation: none`, обучена на Mendeley (154 реальные
  сессии-нормы) + синтетика ДЦП (445), всего 599. **Вектор из 6 признаков** (rom, peakVelocity,
  smoothnessIndex, tremorPower, pauseRatio, activeTimeSec) — урезано с 14 (убраны дубли; см. ML_CONTRACT §1).
- ROC-AUC 0.998 **посчитан на синтетике** (label = параметры генератора) → это НЕ клиническая
  метрика. До клин. валидации основной механизм аномалий — персональный z-score baseline (rule-режим).
- Статус модели: `GET /api/ml/health` и `/api/health` (поля `validation`, `synthetic_only`, `metrics_note`).
- Переобучить (Windows, из корня): `$env:PYTHONPATH="ml-service"; $env:PYTHONIOENCODING="utf-8";`
  `venv\Scripts\python.exe -m app.train`, затем скопировать joblib в `api/app/ml/models/`.
- Тесты: `pytest ml-service/tests/ -v` (10) + `cd api && pytest tests/ -v` (20).

### Классификатор паттерна движения
- `api/app/ml/models/pattern_model.joblib` — мультиклассовый RandomForest(калибр.) + RobustScaler.
  Инференс: `api/app/ml/pattern.py`; обучение: `ml-service/app/train_pattern.py`.
- Отдельная задача от аномалий: не «хуже личной нормы», а «на какой ПАТТЕРН похоже движение».
  4 класса: `normal` / `spastic` / `asymmetric` (гемипарез) / `tremor` (дискинезия+атаксия).
- Версия **pattern-v1-2026-06-30-synthetic**, `validation: none`. Метрики (синтетика): accuracy 95%,
  macro F1 0.95, ROC-AUC OvR 0.996. **Подсказка паттерна, НЕ диагноз.**
- Отдаётся в `/api/insights.pattern` (см. ML_CONTRACT §6); `null` для partial/невалидных сессий.
  Переобучить: `cd ml-service && ../venv/Scripts/python.exe -m app.train_pattern` → копировать joblib в `api/`.
- Тесты: `api/tests/test_pattern.py` (5).

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

**Оси управления** определяются на бэкенде по `game_type` (`api/app/ml/games.py`, единый источник
`ANALYZED_AXES`). ОСНОВНАЯ ось (первая) — на ней рекомендации и нарратив, её признаки в
`Session.features`. Остальные оси (City Driver: ещё и `pitch` = газ/тормоз) анализируются ТЕМ ЖЕ
детектором (`extract_features`/модель axis-agnostic) и агрегируются в общий вердикт
(`api/app/ml/multiaxis.py`): `status` = худшая ось, флаги помечены осью, `leadAxis` = ведущая.
Признаки неосновных осей лежат в `Session.axis_features`, отдаются в `/api/insights` полем
`axis_features` (с собственным пер-осевым `anomaly`) и показываются врачу («Вторая ось управления»).
Модель НЕ переобучалась — она axis-agnostic. См. `docs/ML_CONTRACT.md` §2/§4.

**Standalone-тест без бэкенда:** `packages/game-3d/demo.html` (Three.js с CDN через importmap),
`packages/game-2d/demo.html`.

---

## 6. Переменные окружения

Файл `api/.env` (создать из `api/.env.example`):

| Переменная | Описание | По умолчанию |
|-----------|----------|--------------|
| `APP_ENV` | Окружение: `dev` \| `staging` \| `prod`. В `prod` — fail-fast на небезопасную конфигурацию (дефолтный/короткий `JWT_SECRET`, `DEMO_MODE=true`) | `dev` |
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017/rehabgame` |
| `JWT_SECRET` | Секрет для JWT (мин. 32 символа; в `prod` обязателен) | dev-only значение |
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

### Docker (рекомендуется, локальная разработка)
```bash
docker compose up
# Frontend: http://localhost:5173
# API:      http://localhost:8000
# Docs:     http://localhost:8000/docs
```

### Docker (production, слабый VPS ~1 ГБ RAM)
```bash
docker compose -f docker-compose.prod.yml up -d --build
# Всё через nginx: http://<сервер>:8080 (порт — WEB_PORT в .env)
```
Статическая сборка фронта + nginx, лимиты памяти, mongo/api наружу не публикуются.
Перед первым запуском включить swap — полная инструкция в `docs/DEPLOY.md`.
Для подключения устройства (Web Bluetooth) нужен HTTPS: временно — Cloudflare Tunnel
(`--profile tunnel`), постоянно — свой домен + Let's Encrypt (`docker-compose.tls.yml`).
См. `docs/DEPLOY.md`, раздел 7.

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
  const { smooth, calib, raw } = e.detail;  // все {roll, pitch, yaw}
  // smooth — калибр.+сглаж. (EMA) → УПРАВЛЕНИЕ игрой (без джиттера)
  // calib  — калибр., но НЕсглаж.   → ЗАПИСЬ в imu_time_series для ML (сохраняет тремор)
  // raw    — сырые показания датчика (для zeroNow/диагностики)
});
await ble.connect();        // открывает браузерный диалог
ble.enableKeyboard(3);      // ← → клавиши = fallback без устройства
ble.setInvert({ roll: true });   // исправить зеркальное управление (вправо → влево)
```

**Калибровка и направление** (сохраняются в браузере, `web/src/stores/bleStore.js` → localStorage):
- **Инверсия осей** (`setInvert`) — фикс «наклон вправо → объект едет влево» (зависит от крепления
  датчика). Применяется только к данным устройства, не к клавиатуре. Тумблеры на странице `/device`.
- **Нейтраль по умолчанию** (`setOffsets`/`getOffsets`, кнопка «Зафиксировать» на `/device`) — поза,
  которую пользователь один раз фиксирует как ноль; восстанавливается на старте каждой игры
  (`bleStore.applyNeutralOrZero` в `GameIntro`).

Оси управления: game1 (Space Catcher) — **roll**; game2 (City Driver) — **roll** (руль) +
**pitch** (газ/тормоз). Анализируемые оси выбираются по `game_type` в `api/app/ml/games.py`
(`ANALYZED_AXES`) — для новой игры/оси достаточно дописать запись туда, роуты подхватят.

---

## 9. Демо-режим (показ инвесторам)

Включается флагом `DEMO_MODE=true` в `api/.env` (перезапустить бэкенд).

- **Засев** (`api/app/demo/seed.py`, идемпотентно): демо-врач, демо-пациент и 5 детей с ДЦП с
  готовыми сессиями (11–14 каждому). Профили (формы ДЦП) дают разные ML-вердикты: норма
  (лёгкая спастическая с прогрессом), «Внимание» (спастический гемипарез/асимметрия),
  «Критично» (атаксическая форма с обострением; дискинетическая форма с гиперкинезами ~4 Гц).
  Дашборд (KPI, аномалии, рекомендации, тренды, спектр дрожи) заполнен сразу.
- **Вход** — кнопки на странице логина (появляются, когда `GET /api/health` вернул `demo_mode: true`):
  «Войти как врач» / «Войти как пациент».

| Роль | Логин | Пароль |
|------|-------|--------|
| Врач | `demo_doctor` | `demo1234` |
| Пациент | `demo_patient` | `demo1234` |

`DEMO_MODE=false` (по умолчанию) — чистая база, без демо-данных и кнопок.

---

## 10. Существующие данные и учётные записи

### 10.1 Происхождение данных (`source`)

Каждый пациент/сессия несёт поле `source` — по нему видно, откуда данные, и можно
выборочно удалять:

| `source` | Откуда | Признаки | Как удалить |
|----------|--------|----------|-------------|
| `None` (нет поля) | Живые данные: реальная регистрация и реальные игры | Полные (сырой ряд 25 Гц) | Только вручную/админкой |
| `"test"` | `api/scripts/seed_test_data.py` — тест-данные для разработки | Полные (сгенерированный ряд) | `seed_test_data.py --reset` |
| `"demo"` | `api/app/demo/seed.py` — демо для показа (`DEMO_MODE=true`) | Полные (сгенерированный ряд) | `seed_test_data.py --clear-demo` |
| `"firebase"` | `api/scripts/import_firebase.py` — импорт истории старого прототипа | **Частичные** (`partial=true`: только ROM/min/max, без сырого ряда) | По `source` в Mongo |

### 10.2 Учётные записи

**Админ.** Создаётся автоматически на старте API из `api/.env`
(`ADMIN_USERNAME`/`ADMIN_PASSWORD`; пустой пароль = не создавать). На проде — свой
пароль из серверного `.env`. Скрипт тест-данных дополнительно гарантирует локального
админа `admin / admin1234` (и перезапишет ему пароль!) — поэтому скрипт **только для
dev-базы**, на проде не запускать.

**Тест-данные** (`venv\Scripts\python.exe api\scripts\seed_test_data.py`, идемпотентно;
`--reset` пересоздать). 3 врача × 3–4 ребёнка с ДЦП × 11–13 сессий, `source="test"`:

| Роль | Логин | Пароль | Примечание |
|------|-------|--------|-----------|
| Админ | `admin` | `admin1234` | создаёт/обновляет скрипт |
| Врач | `doctor1` / `doctor2` / `doctor3` | `doctor1234` | Жанна Абаева / Марат Сейтов / Айгуль Бекова |
| Пациент | `patient1` / `patient2` / `patient3` | `patient1234` | по одному «играющему» пациенту на врача; остальные дети — карточки без учётки |

**Демо-режим** (`DEMO_MODE=true`): `demo_doctor` и `demo_patient`, пароль `demo1234`
(§9). На прод-сервере демо-режим сейчас включён — эти учётки там живые.

**Реальные пациенты** регистрируются сами: логин = ИИН ребёнка (12 цифр), пароль (ПИН)
задают при регистрации. Пароли хранятся только как bcrypt-хэш — «посмотреть пароль»
нельзя, только сбросить (админка или врач выпускает новый ПИН при `create_login`).

⚠️ Все перечисленные пароли — заведомо слабые и известные, это осознанно: они для
разработки и показа. Не использовать на открытом проде без смены; rate-limiting логина
пока нет (BACKLOG §2).

### 10.3 Записи с устройства (сырые данные движения)

- **`Session.imu_time_series`** — главное хранилище: несглаженный (calib) ряд углов
  `[{t, r, p, y}]` с частотой 25 Гц за всю игровую сессию. Пишется при каждом
  `POST /sessions` и **никогда не удаляется** (правило CLAUDE.md) — это сырьё для
  будущего обучения моделей. Даже у невалидных сессий (`features.valid=false`) ряд
  сохраняется — невалидна только аналитика.
- **`tools/imu-recorder/index.html`** — автономная запись с BLE-устройства в JSON-файл
  (без бэкенда): для отладки прошивки и набора сырых записей вне игр.
- **`tools/imu-simulator/index.html`** — генератор синтетических рядов (без устройства).
- **Mendeley Smartwatch IMU Dataset** (папка `Smartwatch IMU Dataset for Upper-Limb
  Movement Ana (1)` в корне репо) — открытый датасет запястья (CC BY 4.0), 154 реальные
  сессии-нормы из него вошли в обучение модели аномалий v7
  (`ml-service/data/real_data_loader.py`).
- **Firebase-экспорт** старого прототипа — только агрегаты (ROM/min/max/число движений),
  сырого ряда там нет; после импорта такие сессии живут с `features.partial=true`.
