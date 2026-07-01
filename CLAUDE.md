# CLAUDE.md — Инструкции для AI-ассистента

> Читается при каждом старте сессии. Содержит правила работы с проектом.

---

## Проект за 30 секунд

**Axis** — реабилитационная платформа. Пациент управляет игрой движением кисти
(ESP32-C3 + IMU через BLE). Врач видит ML-аналитику движений.

**Целевая аудитория — дети с ДЦП** (детский церебральный паралич): тренировка крупной моторики
руки. Демо/тест-данные используют формы ДЦП (спастическая, гемипарез, дискинетическая, атаксическая).

```
tools/imu-*  →  packages/ble  →  web/ (React)  →  api/ (FastAPI)  →  MongoDB
                                                        └── api/app/ml/  (ML встроен)
```

**Документация:** `docs/TECHNICAL.md` — полная техническая картина.

---

## Структура проекта

| Директория | Назначение |
|-----------|-----------|
| `api/` | FastAPI backend — авторизация, данные, ML |
| `web/` | React + Vite + Tailwind SPA |
| `packages/ble/` | BleService ES-модуль — **не трогать** |
| `packages/game-2d/` | Game2DEngine (Space Catcher, Canvas 2D) — **не трогать** |
| `packages/game-3d/` | Game3DEngine (City Driver, Three.js) — **не трогать** |
| `ml-service/` | Обучение модели + тесты паритета + debug-UI |
| `tools/` | IMU симулятор/рекордер (автономно, без бэкенда) |
| `docs/` | TECHNICAL.md, CHANGELOG.md, ML_CONTRACT.md |

---

## Правила при изменении `api/`

1. **Новый роут** → добавить в таблицу API в `docs/TECHNICAL.md` (раздел 3)
2. **Изменение MongoDB-схемы** → обновить раздел 4 в `docs/TECHNICAL.md`
3. **Изменение `api/app/ml/features.py`** → ОБЯЗАТЕЛЬНО запустить `ml-service/tests/test_parity.py` — паритет с `ml-service/app/features.py` должен сохраняться
4. **Изменение `api/app/ml/anomaly.py`** → проверить что `ml-service/app/anomaly.py` ведёт себя аналогично
5. **Изменение ответа `/api/insights`** → обновить `docs/ML_CONTRACT.md` (раздел 4)
6. **Новая env-переменная** → добавить в таблицу в `docs/TECHNICAL.md` (раздел 6) И в `api/.env.example`
7. **Изменение CORS origins** → обновить `api/.env.example`

## Правила при изменении `web/`

1. **BleService** — импортировать только из `@ble/index.js`, singleton уже в `bleStore.js`
2. **Game2DEngine** — импортировать из `@game2d/index.js`, передавать `canvas` снаружи
3. **Game3DEngine** — импортировать из `@game3d/index.js`; страница `Game3D` грузится **лениво** (`React.lazy`), т.к. тянет Three.js — не делать статический импорт
4. **Никакого** `document.getElementById` в stores или компонентах — всё через пропсы/ref
5. **Новая страница** → добавить в `App.jsx` + навигацию в `AppLayout.jsx`
6. **Новая игра** → движок в `packages/game-N/`, ось в `api/app/ml/games.py` (`GAME_AXIS`), карточка в `GameSelect.jsx`, переключатель в `Leaderboard`/`PatientDetail`

## Правила при изменении `packages/`

1. **Золотое правило**: никакого `document.getElementById`, `window.location`, `import React` внутри пакетов
2. **`packages/ble`** — если меняешь UUID или API (методы, события): синхронизировать с прошивкой ESP32
3. **`packages/game-2d`** — проверить что `demo.html` работает без бэкенда после изменений
4. **`packages/game-3d`** — импортирует `three` (bare specifier); в `web/` резолвится алиасом в `vite.config.js`. Проверить `demo.html` (Three.js с CDN через importmap)

## Правила при изменении `ml-service/`

1. **Изменение `features.py`** → зеркально обновить `api/app/ml/features.py` + запустить `test_parity.py`
2. **Обновление модели** → записать в `docs/CHANGELOG.md`: версию, метрики, источник данных
3. **Изменение формата `/api/ml/predict` ответа** → обновить `docs/ML_CONTRACT.md`

## При добавлении новой фичи

1. Записать изменение в `docs/CHANGELOG.md`
2. Обновить `docs/TECHNICAL.md` если затронута архитектура или API

---

## Что НЕ делать

- **Не трогать `packages/ble/` и `packages/game-2d/`** без явной задачи
- **Не писать метрики на клиенте** — всё на сервере (`api/`)
- **Не хардкодить порты** — всегда из `.env` или vite proxy
- **Не удалять `imu_time_series` из сессии** — сырые данные для будущего обучения модели
- **Не объединять Patient и User** — это критическое изменение схемы

---

## Тестирование

| Область | Команда |
|---------|---------|
| ML-паритет (Python ↔ api/app/ml) | `venv\Scripts\python.exe -m pytest ml-service/tests/ -v` |
| Импорт Firebase (нормализация + ML на частичных) | `venv\Scripts\python.exe -m pytest api/tests/ -v` |
| ML полный пайплайн | `ml-service/debug-ui/index.html` → пример "Норма" → features.valid=true |
| BLE без устройства | `packages/game-2d/demo.html` → keyboard fallback должен работать |
| IMU симулятор | `tools/imu-simulator/` → сгенерировать → "Открыть в ML Debug" |
| Frontend сборка | `cd web && npm run build` |
| Frontend тесты (vitest + RTL) | `cd web && npm run test` |
| Бэкенд синтаксис | `venv\Scripts\python.exe -m py_compile api/app/main.py` |
| Тест-данные ДЦП (не демо; нужна Mongo) | `venv\Scripts\python.exe api/scripts/seed_test_data.py [--reset]` |

---

## Соглашения по коду

- **Backend** (`api/`): Python 3.10+, Pydantic v2, async/await, type hints везде
- **Frontend** (`web/`): ES Modules, JSX (не TypeScript), Tailwind utility classes
- **Packages**: ES Modules, никаких CommonJS, никаких React/DOM зависимостей
- **ML-сервис**: Python 3.10+, Pydantic v2
- **Комментарии**: на русском (проект русскоязычный), код — английские имена
- **Числа в признаках**: всегда `round(v, 3)` — не больше 3 знаков

---

## Порты по умолчанию

| Сервис | Порт |
|--------|------|
| FastAPI backend (`api/`) | 8000 |
| React frontend (`web/`) | 5173 |
| MongoDB | 27017 |

---

## Структура памяти (memory/)

В `~/.claude/projects/.../memory/` хранятся записи контекста. При работе читать:
- `project_overview.md` — суть проекта и статус
- `tech_stack.md` — стек и ключевые решения
- `ml_feature_bug_fix.md` — критический баг признаков (исправлен)

При обнаружении новой проблемы или решения — записывать в нужный файл.
