# CHANGELOG — RehabGame

---

## v8.6 — Multi-axis: вторая ось управления (pitch) в аналитике (2026-06-10)

### City Driver: газ/тормоз (pitch) попадает в дашборд врача
- City Driver пишет в `imu_time_series` две оси (roll=руль, pitch=газ/тормоз), но live-аналитика
  считала признаки только по roll. Теперь признаки считаются и по вторичной оси.
- `api/app/ml/games.py`: добавлен `SECONDARY_AXES` (`game2 → {"p": "Газ/тормоз …"}`) +
  `secondary_axes_for_game()`. `GAME_AXIS` остаётся ПЕРВИЧНОЙ осью (на ней работает модель).
- `Session.axis_features` (опционально) — признаки по вторичным осям: `{ось: features-словарь}`.
  Считаются в `POST /sessions` (`_secondary_features`), бэкфилл старых сессий в `/insights`.
- `GET /api/insights` отдаёт `axis_features: {ось: {label, features}}`; дашборд
  (`PatientDetail.jsx`) показывает карточку «Вторая ось управления» (ROM/скорость/плавность/тремор).
- **Без переобучения модели:** вторичная ось НЕ подаётся в anomaly/recommendations/narrative
  (модель обучена на одной оси). `extract_features` не менялся → паритет сохранён (5 тестов зелёные).
  Полный 2-осевой ML (объединённый вектор + переобучение) — следующий шаг.
- Доки: `docs/ML_CONTRACT.md` §4 (поле `axis_features`), `docs/TECHNICAL.md` §4/§5.

---

## v8.5 — Спектральный анализ дрожи (FFT) + демо-режим для инвесторов (2026-06-08)

### Новые признаки движения: частотный анализ дрожи
- `api/app/ml/features.py` ≡ `ml-service/app/features.py` (паритет, байт-в-байт): добавлены
  `tremorFreqHz` (доминирующая частота дрожи в полосе 3–12 Гц) и `tremorPower` (доля спектральной
  мощности в полосе, 0..1). Реализация — прямое ДПФ (чистый Python, без numpy) по сетке частот,
  взвешенное по реальным временам t_i. Раньше тремор оценивался только во временной области
  (`tremorIndex` — смены направления); теперь добавлен частотный («по быстрым и коротким
  колебаниям координаты определяется дрожь»).
- `ml-service/tests/test_parity.py`: golden-значения новых признаков + проверка диапазона и
  дискриминации (норма vs патология). Все 5 тестов зелёные.

### Модель аномалий переобучена на 14 признаках
- `FEATURE_KEYS` (+`tremorFreqHz`, `tremorPower`) в `train.py` и обоих `anomaly.py`; `tremorPower`
  добавлен в z-score `RULES` для объяснений. Версия модели **v6-2026-06-08-spectral-synthetic**.
- ROC-AUC 0.984 (test), CV 0.990. **Новые признаки — два самых важных**: `tremorPower` 0.21,
  `tremorFreqHz` 0.18. Метрики на синтетике (`validation: none`) — не клинические.
- Дашборд: `tremorPower` добавлен в KPI (`web/src/lib/clinical.js` + `PatientDetail.jsx`),
  частота дрожи показана подписью; рекомендация по тремору обогащена частотой/мощностью.

### Демо-режим для показа инвесторам
- Флаг `DEMO_MODE` (`api/app/config.py`, `.env.example`). При `true` `api/app/demo/seed.py`
  идемпотентно засевает демо-врача, демо-пациента и 5 пациентов с 11–14 сессиями. Клинические
  траектории дают полный спред ML-вердиктов: норма / «Внимание» / «Критично» (тремор 5 Гц, боль).
- `GET /api/health` отдаёт `demo_mode`; страница входа (`web/src/pages/Login.jsx`) при этом
  показывает кнопки быстрого входа «Войти как врач/пациент». Учётки: `demo_doctor`/`demo_patient`,
  пароль `demo1234`. Навигация после входа — по роли (врач → дашборд, пациент → игры).

---

## v8.4 — Мост Firebase → MongoDB: реальные данные уходят в ML (2026-06-08)

### Импорт Firebase RTDB → MongoDB (приоритет ML_SPEC §5/§7, п.2)
- `api/app/ingest/firebase.py` — чистый нормализатор экспорта RTDB (или ответа REST `<db>/.json`)
  в пациентов/сессии RehabGame. Из агрегатов строит ЧАСТИЧНЫЕ признаки (rom/minAngle/maxAngle,
  `partial=True`, `missing[...]`); сессии game1 с ROM=0 помечаются `valid=False`. Понимает плоскую
  (`rehab_sessions`/`app_sessions`) и вложенную (`rehab_sessions_by_patient`) формы.
- `api/scripts/import_firebase.py` — CLI: импорт из файла-экспорта ИЛИ live-URL базы, идемпотентно
  (ключ `source`+`source_id` — повторный запуск не плодит дубли). Флаги `--dry-run` (предпросмотр
  без БД) и `--doctor-id` (привязка пациентов к врачу — при повторном запуске обновляет привязку
  уже существующего пациента, чтобы связать данные с врачом постфактум). Чтение через utf-8-sig (снимает BOM).
- Модели: `Session` получил `device_metrics` (strengthIndex/movementCount/enduranceSec/снимок углов)
  и `source`/`source_id`; `Patient` — `source`/`source_id`. Поля опциональны → существующие данные не ломаются.

### Реальный импорт выполнен и проверен end-to-end
- Импортирован реальный экспорт `esp-project-fca3d-default-rtdb-export.json`: 1 пациент (Serjan, 20),
  3 сессии (2 валидные game2 ROM 73.6°/60.3°, 1 невалидная game1 ROM=0). Дубли в экспорте
  (`app_sessions`/`rehab_sessions`/`..._by_patient`) НЕ задваиваются — нормализатор берёт один источник.
- Идемпотентность подтверждена на реальных данных (повтор → +0 пациентов, +0 сессий).
- ML-путь `/api/insights` прогнан на импортированных данных: `mode=rule`, `partial=True`,
  `status=insufficient_baseline` (2<3 валидных), `sessionPlan.levelAdvice=hold` (без ложного «decrease»),
  narrative показывает только ROM и помечает «сырой ряд не записан».

### Корректное отображение частичных данных на фронтенде (баг-фикс, зеркало backend)
- `web/src/lib/clinical.js`: `SERIES_DEPENDENT` + `isMeasured()`/`measuredValue()` — зеркало
  `api/app/ingest/firebase.py`. На частичных (Firebase) сессиях признаки, требующие сырого ряда
  (плавность, тремор, скорость, паузы, активное время), = 0 означают «не измерено», а не реальный ноль.
- `web/src/pages/PatientDetail.jsx`: KPI-карточки таких признаков показывают «не измерено · нет сырого
  ряда» (а не «0%» с ложной клинической подсветкой); личная норма и блок «Прогресс» считаются только по
  измеренным значениям; таблица сессий — «—» вместо «0»; добавлена пометка «оценка по амплитуде».
- `web/src/components/SessionChart.jsx`: точки неизмеренных признаков на частичных сессиях не рисуются
  (раньше график плавности/тремора падал в ложный 0). Сборка чистая (`npm run build`).
- Проверено в браузере на реальном Serjan (game2): ROM=60° реален, плавность/тремор/скорость = «не измерено»,
  заключение «Мало данных · персональная норма», план «Сохранить уровень». Скриншот подтверждён.

### Фиксы зависимостей (ломали старт API и авторизацию)
- `api/requirements.txt`: `beanie>=1.26` → `beanie>=1.26,<2`, `motor>=3.6` → `motor>=3.6,<4`. Pip без
  верхней границы ставил Beanie 2.x, который ушёл с Motor на нативный async-драйвер PyMongo →
  `init_beanie` падал (`MotorDatabase object is not callable`). Весь бэкенд написан под Beanie 1.x + Motor.
- `api/requirements.txt`: добавлен пин `bcrypt>=4.0.1,<4.1`. passlib 1.7.4 (последний релиз) несовместим
  с bcrypt≥4.1/5.x — при инициализации backend шлёт тестовый пароль >72 байт, новый bcrypt кидает
  `ValueError` вместо обрезки → падали `_seed_admin`, логин и регистрация. В venv стоит bcrypt 4.0.1.

### Корректная деградация ML на частичных признаках (баг-фикс)
- `api/app/ml/anomaly.py`: при `features.partial` — ПРИНУДИТЕЛЬНО rule-режим (z-score по ROM). Раньше
  model-режим подставлял нули вместо 9 отсутствующих признаков в RandomForest → мусорный anomalyScore.
  Зеркалено в `ml-service/app/anomaly.py` (паритет).
- `api/app/ml/recommendations.py` `_session_plan`: при `partial` плавность (=0) больше не тянет ложно в
  «decrease»/«качество>очков» — консервативно `hold`, `decrease` только при anomaly=critical. Зеркалено.
- Контракт: `anomaly` получил опциональное поле `partial: true` (`ML_CONTRACT.md` §2).

### Тесты
- `api/tests/test_firebase_ingest.py` — 11 проверок (нормализация, частичные признаки, провенанс,
  вложенная форма by_patient, rule-режим и флаг ROM на частичных данных, narrative скрывает
  неизмеренные метрики). `pytest api/tests/ -v` → 11 passed.
- Паритет признаков не затронут: `pytest ml-service/tests/ -v` → 5 passed.

> Запуск импорта (из корня репо): `venv\Scripts\python.exe api\scripts\import_firebase.py <export.json | URL>`
> Предпросмотр без БД: добавить `--dry-run`. Полный вектор из 12 признаков разблокируется логированием
> сырого ряда `[{t,r,p,y}]` в `web_game_esp32` (см. `ML_SPEC.md` §5).

---

## v8.3 — LLM-explainer + фикс захвата угла в Space Catcher (2026-06-08)

### LLM-explainer (клиническое заключение)
- `api/app/ml/narrative.py` — слой «заключения» поверх ПОСЧИТАННЫХ метрик. Детерминированный
  шаблон (по умолчанию, без сети/ключа) + провайдеры OpenAI/Claude (stdlib `urllib`, без новых
  зависимостей). LLM только перефразирует числа, не вводит новых; при ошибке/выключении → шаблон.
- Конфиг: `LLM_ENABLED|LLM_PROVIDER|LLM_MODEL|LLM_API_KEY|LLM_TIMEOUT_SEC` (`config.py`, `.env.example`).
- Ответ `GET /api/insights` получил поле `narrative {text, source, provider}` (схема + `ML_CONTRACT.md` §4).
- Фронт: карточка «Клиническое заключение» вверху вкладки «Обзор» (`PatientDetail.jsx`).
- Проверено: шаблон даёт связное заключение из чисел; сборка чистая; консоль без ошибок.

### Finding #4 — Space Catcher теперь пишет угол без устройства
- `packages/game-2d/index.js`: при игре без внешнего входа платформа синтезирует виртуальный roll
  из своей позиции (как City Driver) → `imuTimeSeries` и ROM-метр осмысленны (раньше ROM=0,
  что подтвердилось на реальных Firebase-данных). Гейт управления — по флагу `_bleInput`.

---

## v8.2 — Инвестиционный аудит, редизайн врачебной части, фиксы due diligence (2026-06-08)

### Аудит core-функций (для инвестраунда)
- `docs/INVESTOR_AUDIT.md` — аудит игр и ML/AI, диаграммы, рынок/конкуренты (со ссылками),
  находки due diligence, готовые блоки питч-дека.
- `docs/ML_SPEC.md` — ML/AI спецификация: детерминированное ядро + опциональный LLM-explainer,
  план интеграции реальных данных Firebase.
- `ml-service/analyze_pitch.py` — воспроизводимый прогон: дискриминация признаков + поведение модели.

### Редизайн врачебной части (UI/UX, без эмодзи)
- `web/src/components/icons.jsx` — собственный inline-SVG набор иконок (замена эмодзи).
- `web/src/lib/clinical.js` — клинические нормы (пороги синхронны с `recommendations.py`).
- Переписаны: `PatientDetail.jsx` (KPI vs норма + Δ к личной норме, объяснённый детектор
  с σ-флагами, прогресс «до/после», тренды с коридорами нормы, план сессии, печать PDF-отчёта),
  `PatientList.jsx`, `AnomalyBadge.jsx`, `SessionChart.jsx`, `AppLayout.jsx`, `AuthLayout.jsx`.
- Прод-сборка чистая (872 модуля), приложение стартует без ошибок консоли.

### P1 — Валидация признаков вместо мёртвого теста паритета
- `ml-service/tests/test_parity.py` ссылался на удалённый (в v8.0) `backend/services/featureService.js`
  → JS-ветка молча пропускалась, «зелёный» статус был обманчив.
- Переписан в 5 реальных проверок: валидность+диапазоны, детерминизм, клиническая дискриминация
  (норма vs патология), робастность (пустой/мусорный вход), golden-регрессия признаков.
- `pytest ml-service/tests/ -v` → **5 passed**.

### P2+P3 — Честная версия модели и маркировка
- Был рассинхрон: доки заявляли `v4-2026-06-05`, в репо лежал `v3-2026-06-04`. Модель переобучена.
- `train.py` теперь маркирует модель честно: версия **v5-2026-06-08-synthetic** (суффикс `-synthetic`,
  когда реальных данных не было), поля `validation: "none"`, `synthetic_only: true`, `metrics_note`.
- ROC-AUC 0.990 (test) / 0.991 (CV) сохраняется, но явно помечен как метрика **на синтетике**,
  а не клиническая. joblib скопирован в прод (`api/app/ml/models/`).
- `GET /api/ml/health` теперь отдаёт `validation`, `synthetic_only`, `metrics_note`.
- Убраны эмодзи из вывода `train.py` (чинит краш под cp1251 на Windows + правило «без эмодзи»).
- Доки синхронизированы: `TECHNICAL.md` §5, `ML_CONTRACT.md` §2.

> Запуск переобучения (Windows, из корня репо):
> `$env:PYTHONPATH="ml-service"; $env:PYTHONIOENCODING="utf-8"; venv\Scripts\python.exe -m app.train`
> затем `Copy-Item ml-service\app\models\anomaly_model.joblib api\app\ml\models\ -Force`

### Firebase — адаптер реальных данных + критическая находка
- `ml-service/data/firebase_loader.py` — парсит экспорт RTDB → нормализованные пациенты/сессии.
  Проверен на реальном экспорте (Serjan, 3 сессии).
- **Находка:** в экспорте НЕТ сырого ряда IMU — только агрегаты. Вычислимы лишь `rom/minAngle/maxAngle`;
  9 признаков (smoothness/tremor/velocity/jerk/…) требуют ряда `[{t,r,p,y}]` и помечены как `missing`.
- **Следствие:** чтобы получить богатые признаки и реальную модель — логировать полный ряд на устройстве
  (`movementCount≈58 Гц` поток есть, но не сохраняется). Подробности и план — `docs/ML_SPEC.md` §5.
- Подтверждена finding #4: прод-сессия game1 (Space Catcher) пишет ROM=0 (угол не захватывается).

---

## v8.1 — Вторая игра: City Driver (3D, Three.js) (2026-06-05)

### Новая игра `game2` — City Driver
- **Движок** `packages/game-3d/index.js` — `Game3DEngine` на Three.js. Тот же контракт,
  что у `Game2DEngine`: чистый класс, принимает `canvas` + колбэки, без DOM/fetch.
  3D-сцена: дорога с разметкой, город по бокам, встречные машины (препятствия),
  монеты (обычные + зональные у краёв для тренировки полного ROM).
- **Управление** — roll кисти (руление наклоном), как и Space Catcher. Клавиши ← →.
- **Геймплей** — delta-time физика (независимость от FPS), 3 жизни, комбо ×2/×3,
  рост скорости по уровням, IMU-запись 5 Гц, пулинг объектов (без аллокаций в кадре).
- **HUD** — DOM-оверлей в React (score/lives/combo/level), ROM-метр руля обновляется
  императивно через ref (без re-render каждый кадр).

### Интеграция
- `web/src/pages/Game3D.jsx` — **ленивая** загрузка (`React.lazy`): Three.js (~115 KB gzip)
  выносится в отдельный чанк, грузится только при заходе на `/game/3d`. Стартовый бандл
  не вырос, навигация без лагов.
- `GameSelect` — City Driver теперь рабочая карточка (была заглушка «Скоро»).
- `Leaderboard`, `PatientDetail` — переключатель game1/game2.
- `SessionResult` — «Играть снова» ведёт на нужную игру по `game_type`.
- Бэкенд: `api/app/ml/games.py` (`GAME_AXIS`) — ось признаков по типу игры
  (game1, game2 → roll). `sessions`/`insights` используют `axis_for_game()`.
- `vite.config.js` — алиас `@game3d` + `three` (на ESM-сборку, т.к. движок вне `web/`).

### Проверено
- Сборка фронта без предупреждений; three и Game3D — отдельные ленивые чанки.
- Рантайм-смоук в браузере (standalone demo): WebGL2-контекст, цикл старт→игра→
  коллизия→game over→рестарт, score/lives/HUD/колбэки — всё работает, ошибок нет.

---

## v8.0 — Полная перестройка стека (2026-06-05)

### Что изменилось
- **Backend:** Node.js + Express → **FastAPI** (Python, `api/`)
  - JWT авторизация (HS256), Beanie ODM, Motor (async MongoDB)
  - ML-модуль встроен в `api/app/ml/` — работает без внешнего сервиса
  - Standalone роутер `/api/ml/*` для отдельного тестирования
- **Frontend:** MPA + frontend-v2 → единый **React + Vite + Tailwind** (`web/`)
  - Zustand: authStore, bleStore (BLE singleton), sessionStore
  - BLE singleton не рвётся при навигации между страницами
  - Страницы: Login, Register, GameSelect, Game2D, SessionResult, PatientList, PatientDetail, Leaderboard, Profile, Admin
- **Удалено:** `backend/`, `frontend/`, `frontend-v2/`, root `node_modules/`
- **Сохранено без изменений:** `packages/ble/`, `packages/game-2d/`, `tools/`, `ml-service/`

### Порты
| Сервис | Старый | Новый |
|--------|--------|-------|
| Backend | 5000 (Node) | 8000 (FastAPI) |
| Frontend | 5173 (Vite) | 5173 (Vite) — без изменений |
| MongoDB | 27017 | 27017 — без изменений |

---

## v7.1 — Исправление вырождения признаков smoothnessIndex / tremorIndex (2026-06-05)

### Критический баг

`smoothnessIndex = 0.0` и `tremorIndex = 1.0` для ВСЕХ сессий при частоте дискретизации ≥ 20 Гц.

**Причина:** формулы были откалиброваны под 5 Гц. При 25 Гц шум датчика усиливается в ~(25/5)² = 25× через трёхуровневое дифференцирование.

### Исправления (паритет JS ↔ Python сохранён)

1. **MA(3) сглаживание** перед дифференцированием — снижает шум в ~5× в jerk.
2. **dt-нормализация jerkScale** — `jerkScale *= max(1, (200/dt_avg_ms)²)`.
3. **Новый tremorIndex** — смены направления скорости с адаптивным порогом, оба соседних сэмпла должны превышать порог.

### Результат

| Признак | До (норма/аномалия) | После (норма/аномалия) |
|---------|---------------------|------------------------|
| smoothnessIndex | 0.000 / 0.000 | **0.848 / 0.800** |
| tremorIndex | 1.000 / 1.000 | **0.048 / 0.499** |

### Модель → v4-2026-06-05
- ROC-AUC test: **0.990**, CV: **0.991 ± 0.003**
- tremorIndex importance: 0.000 → **0.130**
- smoothnessIndex importance: 0.000 → **0.033**

---

## v7.0 — ML-интеграция, безопасность, исправления (2026-06-04)

- ML-сервис подключён к продукту: `insightsRoutes` проксирует на `ML_SERVICE_URL` с fallback на JS-сервисы
- Ось признаков выбирается по типу игры (game1 → roll, game2 → pitch)
- Самостоятельная регистрация пациента исправлена (`platformAccess/databaseAccess = true`)
- Добавлен `recommendationService.js` (слабая сторона, план сессии)
- Переобучена ML-модель v3 на синтетических данных v2 (600 сессий, ROC-AUC 0.994)

---

## v6.x — packages/, game-2d, frontend-v2 (2026-05 — 2026-06)

- `packages/ble/` — BleService EventTarget, EMA-фильтр, клавиатурный fallback
- `packages/game-2d/` — Game2DEngine (Space Catcher), чистый класс без DOM
- `frontend-v2/` — React SPA (Zustand, Vite, proxy /api)
- `ml-service/` — FastAPI, IsolationForest + RandomForest, parity tests
