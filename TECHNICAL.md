# Техническая документация — RehabGame Platform

---

## 1. Общая архитектура

Система состоит из четырёх слоёв, которые взаимодействуют последовательно:

```
[ESP32-C3 + IMU]
      │ BLE (GATT notifications)
      ▼
[Браузер — WebBluetooth API]
      │ Raw IMU stream → EMA-сглаживание
      │ Canvas 2D / Three.js WebGL (игровой движок)
      │ IMU time-series буфер (каждые ~200ms)
      │ REST API (fetch POST при game over)
      ▼
[Node.js / Express сервер]
      │ JWT-аутентификация
      │ Вычисление метрик из time-series
      │ Rule-based аналитика (insights)
      ▼
[MongoDB Atlas]
      Коллекции: users, patients, sessions, scores
```

---

## 2. Аппаратный слой (M1 · Hardware)

### Микроконтроллер
**ESP32-C3** — компактный WiFi/BLE SoC на базе RISC-V. Используется только BLE-часть.

### IMU-сенсор
Датчик инерциальных измерений (MPU-6050 или аналог) — акселерометр + гироскоп. Прошивка вычисляет углы ориентации:
- **Yaw** — рыскание (поворот вокруг вертикальной оси)
- **Pitch** — тангаж (наклон вперёд/назад)
- **Roll** — крен (наклон влево/вправо)

Для стабилизации углов применяется фильтр Маджвика (Madgwick filter) или комплементарный фильтр на уровне прошивки.

### BLE протокол (GATT)
Устройство выступает **GATT-сервером** с одним сервисом и двумя характеристиками:

```
Service UUID:      12345678-1234-1234-1234-123456789abc

Характеристика 1 — DATA (notify):
  UUID:  abcd1234-ab12-ab12-ab12-abcdef123456
  Формат: ASCII строка "yaw,pitch,roll\n"
  Пример: "12.34,-5.67,8.90"
  Частота: ~20-50 Hz

Характеристика 2 — CALIBRATION (write):
  UUID:  abcd1235-ab12-ab12-ab12-abcdef123456
  Команды:
    "CALIB"     — сохранить текущую позицию как нулевую
    "RESET_YAW" — сбросить накопленный дрейф по оси yaw
```

---

## 3. Фронтенд — игровой движок (M2 · Game SDK)

### Web Bluetooth API
Браузер подключается к ESP32 через `navigator.bluetooth.requestDevice()`. Это **экспериментальный API**, доступный только в Chrome/Edge и только на HTTPS или localhost.

```javascript
// Запрос устройства с фильтром по имени
bleDevice = await navigator.bluetooth.requestDevice({
  filters: [{ name: "ESP32-C3-IMU" }],
  optionalServices: [SERVICE_UUID]
});

// Подписка на нотификации
const dataChar = await service.getCharacteristic(DATA_UUID);
await dataChar.startNotifications();
dataChar.addEventListener("characteristicvaluechanged", handleIMUData);
```

### EMA-сглаживание (Exponential Moving Average)
Сырые данные с IMU содержат дрожание (jitter). Применяется низкочастотный фильтр с коэффициентом `α = 0.22`:

```javascript
ble.smoothRoll = ble.smoothRoll * 0.78 + ble.roll * 0.22;
// 0.78 — вес истории (инерция)
// 0.22 — вес нового значения (отклик)
```

Чем меньше `α`, тем плавнее движение, но тем больше задержка. `0.22` — компромисс для реабилитационного устройства.

### IMU Time-Series запись
Каждые ~200ms (каждые 12 кадров при 60fps) во время игры записывается точка:

```javascript
imuTimeSeries.push({
  t: Date.now() - gameStartTime,  // ms от старта
  r: parseFloat(ble.smoothRoll.toFixed(2)),
  p: parseFloat(ble.smoothPitch.toFixed(2)),
  y: parseFloat(ble.smoothYaw.toFixed(2))
});
```

За 5-минутную сессию это ~1500 точек ≈ 45 KB. Массив отправляется на сервер при сохранении сессии.

### Игра 1 — Space Catcher (Canvas 2D)
- Рендеринг через `canvas.getContext("2d")`, requestAnimationFrame-цикл
- Физика: шары с синусоидальным боковым смещением, столкновение AABB
- Терапевтические механики:
  - **Зональные шары** (25% spawn): появляются в левой или правой четверти экрана, со стрелкой-подсказкой `←/→`, вынуждая пациента двигаться в нужную сторону
  - **ROM-метр**: отображает текущий `smoothRoll` как позицию курсора на шкале ±45°, цвет зависит от амплитуды
  - **Комбо**: ×2 с 7 подряд, ×3 с 15 подряд
  - **Золотой шар**: каждые ~30 сек в крайней зоне, требует максимального движения
- Управление: `Roll` оси → смещение платформы; клавиши A/D как фоллбэк без устройства

### Игра 2 — ESP Car (Three.js WebGL)
- 3D-рендеринг через Three.js r160
- Загружаются GLB-модели: машина (`w124.glb`), городская сцена (`city.glb`)
- Управление: `Pitch` → скорость/торможение, `Roll` → поворот колёс
- Используется тот же BLE-менеджер и EMA-фильтр что и в игре 1

---

## 4. Бэкенд (M3 · Backend API)

### Стек
- **Node.js** + **Express 5** — HTTP-сервер
- **MongoDB Atlas** — облачная база данных, подключение через Mongoose
- **JWT** (jsonwebtoken) — stateless-аутентификация
- **bcryptjs** — хэширование паролей (соль rounds=10)

### Middleware цепочка

```
Запрос
  → corsMiddleware        (CORS: только разрешённые origins)
  → express.json          (парсинг JSON, лимит 2mb для time-series)
  → authMiddleware        (JWT verify → req.currentUserDoc)
  → databaseAccessMiddleware  (проверка поля databaseAccess у User)
  → route handler
```

### MongoDB схемы

**User** — основная учётная запись:
```
username, email, password (hash)
role: admin | doctor | patient | user
fullName, phone, specialty, workplace, bio, avatar
platformAccess, databaseAccess, blocked
```

**Patient** — пациент, привязан к врачу:
```
fullName, age, diagnosis, notes
doctorId → ref: User
createdBy → ref: User
```

**Session** — одна игровая сессия:
```
patientId → ref: Patient
doctorId  → ref: User

# Агрегированные метрики (вычисляются из imuTimeSeries):
yaw, pitch, roll         — финальные значения
minAngle, maxAngle       — реальный диапазон за сессию
rangeOfMotion            — maxAngle - minAngle (°)
strengthIndex            — maxAbsRoll / 45° → [0..1]
enduranceSec             — время когда |roll| > 5° (активность)
movementCount            — кол-во значимых смен направления

# Геймплей:
score, level, durationSec
maxCombo, zoneHits       — новые метрики
gameType, gameName

# Raw data для ML:
imuTimeSeries: [{t, r, p, y}, ...]  — 200ms выборка
```

### Вычисление метрик на сервере

```javascript
// При POST /api/session с imuTimeSeries:
const rolls = imuTimeSeries.map(p => p.r);

computedMin       = Math.min(...rolls);
computedMax       = Math.max(...rolls);
computedROM       = computedMax - computedMin;
computedStrength  = Math.min(1, maxAbsRoll / 45);
computedEndurance = activeSamples * 0.2;  // 0.2с на каждую точку
computedMoveCount = countDirectionChanges(rolls, threshold=1.5);
```

---

## 5. AI / Аналитический модуль (M4 · AI Service)

### Текущая реализация — Rule-Based + Linear Regression

Эндпоинт `GET /api/insights/:patientId` анализирует последние 10 сессий пациента.

#### Пороговые значения

| Метрика | Критично | Внимание | Норма |
|---------|---------|---------|-------|
| ROM (rangeOfMotion) | < 10° | 10–20° | > 20° |
| Сила (strengthIndex) | < 0.2 | 0.2–0.4 | > 0.4 |
| Выносливость (enduranceSec) | < 20с | 20–60с | > 60с |
| Движений (movementCount) | < 15 | 15–35 | > 35 |
| Зональные хиты (zoneHits) | 0 | 1–2 | ≥ 3 |

#### Линейная регрессия для трендов

```javascript
function linearSlope(values) {
  // метод наименьших квадратов по индексам [0, 1, 2, ..., n-1]
  const meanX = (n - 1) / 2;
  const meanY = values.reduce(...) / n;
  return Σ[(i - meanX)(y_i - meanY)] / Σ[(i - meanX)²];
}
// slope > 0.3  → тренд "вверх" (улучшение)
// slope < -0.3 → тренд "вниз" (ухудшение)
```

Дополнительные алерты на основе трендов:
- ROM slope < -0.8 при avgROM < 30° → "Амплитуда снижается"
- Score slope < -2 при ≥ 3 сессиях → "Результаты падают, возможна усталость или боль"

#### Ответ `/api/insights`

```json
{
  "summary": {
    "avgROM": 18.2,
    "avgStrength": 0.38,
    "avgEndurance": 52,
    "avgMovementCount": 28,
    "avgScore": 45,
    "lastROM": 15.3,
    "sessionCount": 7
  },
  "alerts": [
    {
      "id": "avg_rom",
      "severity": "warning",
      "metric": "Амплитуда движения (ROM)",
      "text": "Слабая амплитуда движений: 18.2°. Стремиться к > 20°",
      "value": 18.2,
      "threshold": 20,
      "unit": "°"
    }
  ],
  "trends": {
    "rom": { "direction": "down", "slope": -0.9, "avg": 18.2, "last": 15.3, "values": [...] },
    "score": { "direction": "up", "slope": 3.1, "avg": 45, "last": 58 }
  },
  "overallStatus": "needs_attention"
}
```

### Roadmap ML (следующий этап)

Когда накопится достаточно `imuTimeSeries` данных:

| Задача | Метод | Входные данные |
|--------|-------|---------------|
| Классификация качества движений | LSTM / CNN-1D | time-series roll/pitch |
| Детектор аномалий (боль, усталость) | Isolation Forest | статистики series |
| Адаптивная сложность (RL) | Q-learning / правила | ROM vs targetROM |
| Прогноз восстановления | Linear / SVR | история ROM по сессиям |
| Рекомендации упражнений | Content-based filtering | профиль пациента + история |

Планируемый стек для ML-сервиса: **Python / FastAPI** + **scikit-learn** + **TensorFlow Lite** (для простых моделей — TF.js в браузере).

---

## 6. Аутентификация и безопасность

### JWT Flow
```
1. POST /api/auth/login  →  сервер возвращает { token: "eyJ..." }
2. Клиент сохраняет токен в localStorage
3. Каждый запрос: заголовок  Authorization: Bearer eyJ...
4. authMiddleware: jwt.verify(token, JWT_SECRET) → req.currentUserDoc
```

Токен содержит: `{ id, username, role, platformAccess, databaseAccess }`.
Время жизни: `7d` по умолчанию.

### CORS политика
```javascript
// Разрешены только перечисленные origins
const allowedOrigins = process.env.ALLOWED_ORIGINS.split(",");
// file:// и запросы без origin (Postman, мобильные) разрешены
```

### Двухуровневое разграничение доступа
1. **`authMiddleware`** — проверяет JWT, загружает `req.currentUserDoc` из БД
2. **`databaseAccessMiddleware`** — проверяет `user.databaseAccess === true` (выдаётся администратором)

Врач видит **только своих** пациентов — проверка `patient.doctorId === req.currentUserDoc._id`.

---

## 7. Data Flow — полный цикл

```
1. Пациент надевает устройство и открывает игру в Chrome

2. [Браузер] navigator.bluetooth.requestDevice()
   → пользователь выбирает "ESP32-C3-IMU" в системном диалоге

3. [BLE] ESP32 отправляет нотификации: "12.3,-5.1,8.7"
   → handleIMUData() парсит строку
   → EMA-сглаживание обновляет smoothRoll, smoothPitch, smoothYaw

4. [Игровой цикл 60fps]
   → updateCatcher(): catcher.x += smoothRoll * 0.65
   → каждые 12 кадров: imuTimeSeries.push({t, r, p, y})
   → ROM-метр отображает smoothRoll на шкале ±45°

5. [Game Over]
   → saveSession() вызывается один раз (sessionSaved флаг)
   → POST /api/session с телом: { patientId, score, imuTimeSeries, maxCombo, zoneHits, ... }

6. [Сервер — sessionRoutes]
   → JWT verify → role check → patient ownership check
   → вычисление из imuTimeSeries: minAngle, maxAngle, ROM, strength, endurance, movementCount
   → Session.create() → сохранение в MongoDB

7. [Врач открывает кабинет]
   → GET /api/patient → список пациентов
   → GET /api/session/:id → сессии каждого пациента
   → GET /api/insights/:id → аналитика: алерты + тренды

8. [Insights endpoint]
   → выборка последних 10 сессий
   → вычисление средних по каждой метрике
   → сравнение с порогами → генерация алертов
   → линейная регрессия → тренды
   → overallStatus: good / needs_attention / critical
```

---

## 8. Переменные окружения

| Переменная | Описание | Пример |
|-----------|---------|--------|
| `PORT` | Порт сервера | `5000` |
| `JWT_SECRET` | Секрет для подписи токенов | Минимум 32 символа |
| `MONGO_URI` | Строка подключения MongoDB | `mongodb+srv://...` |
| `ALLOWED_ORIGINS` | Разрешённые CORS origins (через запятую) | `http://localhost:3000,http://127.0.0.1:5500` |

---

## 9. Известные ограничения MVP

- **WebBluetooth** работает только в Chrome/Edge на HTTPS или localhost. На iOS не поддерживается
- **Один файл — один BLE менеджер**: в game1 и game2 код BLE дублируется, рефакторинг запланирован в M2
- **`strengthIndex`** до появления time-series вычислялся вручную на устройстве; теперь вычисляется на сервере автоматически
- **Нет WebSocket**: IMU данные не стримятся на сервер в реальном времени, только POST при окончании сессии
- **Нет Treatment Plan**: врач пока не может назначать целевые параметры (targetROM) — в roadmap
