# ML-контракт — формат данных между frontend и backend

> Актуально: v8.0 (FastAPI backend). ML встроен в `api/app/ml/`, отдельный ml-service не нужен для продакшна.

---

## 1. Вектор признаков (`features`)

Вычисляется автоматически при `POST /api/sessions` из `imu_time_series`.  
Реализация: `api/app/ml/features.py` ≡ (устарело) `backend/services/featureService.js`.  
Паритет проверяется: `venv\Scripts\python.exe -m pytest ml-service/tests/ -v`

```jsonc
{
  "sampleCount": 100,
  "durationSec": 20.0,
  "rom": 47.7,               // диапазон движения, °
  "minAngle": -23.9,
  "maxAngle": 23.8,
  "meanAbsVelocity": 41.2,   // °/с
  "peakVelocity": 88.0,      // °/с
  "meanJerk": 12.3,          // °/с³
  "smoothnessIndex": 0.94,   // 0..1 (1 = очень плавно)
  "tremorIndex": 0.10,       // 0..1 (0 = нет тремора; временной метод — смены направления)
  "tremorFreqHz": 5.0,       // доминирующая частота дрожи в полосе 3–12 Гц (FFT); 0 = дрожи нет
  "tremorPower": 0.04,       // 0..1 — доля мощности движения в полосе дрожи (частотный анализ)
  "symmetryIndex": 0.00,     // -1..1 (0 = симметрично)
  "pauseRatio": 0.12,        // 0..1
  "repetitions": 18,
  "activeTimeSec": 19.5,
  "valid": true
}
```

**Важно:** MA(3) сглаживание + dt-нормализация обязательны при fs ≥ 20 Гц (v7.1).
`tremorFreqHz`/`tremorPower` — частотный (FFT/ДПФ) анализ дрожи, добавлен в v8.5. Это два самых
важных признака обученной модели аномалий (importance 0.21 и 0.18). Требуют сырого ряда IMU
(серийные): на частичных данных Firebase = 0 («не измерено»).

---

## 2. Аномалия (`anomaly`)

Возвращается в `GET /api/insights/{patient_id}`.

```jsonc
{
  "status": "critical",       // normal | attention | critical | insufficient_baseline | no_data
  "anomalyScore": 75.9,       // 0..100
  "baselineSize": 4,          // число прошлых сессий в baseline
  "flags": [
    {
      "metric": "rom",
      "label": "Амплитуда (ROM)",
      "severity": "critical",  // warning | critical
      "z": -9.9,               // z-score
      "baseline": 35.3,        // среднее по истории
      "current": 23.3,
      "text": "Амплитуда (ROM): снижение — возможна боль/щажение (отклонение -9.9σ от нормы пациента)",
      "axis": "p",             // (опц.) ось, на которой найдено отклонение — только в multi-axis играх
      "axisLabel": "Газ/тормоз (наклон вперёд/назад)"  // (опц.) подпись оси
    }
  ],
  "mode": "ml",               // "ml" (RandomForest) | "rule" (z-score) | "none"
  "modelVersion": "v6-2026-06-08-spectral-synthetic",  // суффикс -synthetic = нет клин. валидации
  "note": "...",
  "partial": true,            // (опц.) признаки частичные (агрегаты Firebase): анализ только по ROM
  "axesAnalyzed": ["r", "p"], // (опц., multi-axis) какие оси проанализированы
  "leadAxis": "p"             // (опц., multi-axis) ось, давшая итоговый (худший) вердикт
}
```

**Multi-axis (City Driver):** вердикт `anomaly` — АГРЕГАТ по всем управляемым осям игры
(руль = roll + газ/тормоз = pitch). `status` = худший из осей, `anomalyScore` = максимум,
`flags` — объединение (каждый помечен `axis`/`axisLabel`), `leadAxis` — ось, давшая итог.
Для одноосевой игры (Space Catcher) этих полей нет — форма идентична прежней (обратная совместимость).

**partial:** появляется (`true`), когда признаки текущей сессии частичные — данные из агрегатов
Firebase без сырого ряда IMU (`features.partial=true`). В этом случае `mode` всегда `rule` (обученную
модель не кормят нулями вместо отсутствующих признаков), а флаги — только по доступным метрикам (ROM).

---

## 3. Рекомендации (`recommendations`)

Возвращается в `GET /api/insights/{patient_id}`.

```jsonc
{
  "version": "1.0",
  "weakSide": {
    "detected": true,
    "direction": "negative",  // positive | negative | none
    "severity": "attention",  // info | attention | critical
    "asymmetryPct": 35,
    "label": "Слабое направление: «минус»...",
    "evidence": "диапазон −8°..+23° → асимметрия 35%..."
  },
  "focus": "Фокус: слабое направление (35%). Увеличить акцент на слабой стороне.",
  "items": [
    {
      "id": "weak_side",
      "area": "asymmetry",     // safety | asymmetry | rom | coordination | neuro | endurance | strength | trend | progress
      "severity": "attention", // info | attention | critical
      "priority": 3,
      "finding": "Асимметрия движения ~35%...",
      "recommendation": "Делать акцент на слабом направлении..."
    }
  ],
  "sessionPlan": {
    "levelAdvice": "hold",          // increase | hold | decrease
    "targetRomDeg": 48,
    "suggestedDurationSec": 120,
    "weakSideExtraRepsPct": 10,
    "emphasizeQualityOverScore": false
  },
  "note": "Поддержка решения врача, не диагноз."
}
```

---

## 4. Полный ответ `GET /api/insights/{patient_id}`

```jsonc
{
  "features": { ... },        // §1 — последняя сессия (первичная ось управления)
  "axis_features": {          // multi-axis игры: признаки по вторичным осям. null, если игра одноосевая.
    "p": {                    // ось (p=pitch=газ/тормоз в City Driver)
      "label": "Газ/тормоз (наклон вперёд/назад)",
      "features": { ... },    // тот же вектор §1, посчитанный по этой оси
      "anomaly": { ... }      // §2 — СОБСТВЕННЫЙ вердикт этой оси (vs история пациента по ней)
    }
  },                          // эти оси ВХОДЯТ в общий anomaly (§2, leadAxis/axesAnalyzed);
                              // recommendations/narrative считаются по ОСНОВНОЙ оси (features)
  "anomaly": { ... },         // §2
  "recommendations": { ... }, // §3
  "trends": {
    "rom":   { "direction": "up|down|stable", "slope": 1.2 },
    "score": { "direction": "up|down|stable", "slope": -5.0 }
  },
  "narrative": {                // клиническое заключение (LLM-explainer / шаблон)
    "text": "Последняя сессия: амплитуда (ROM) 23.3°...",
    "source": "template",       // "template" (детерминированный) | "llm"
    "provider": "none"          // none | openai | claude
  },
  "alerts": [
    { "type": "critical|attention", "message": "..." }
  ],
  "game_type": "game1",
  "session_count": 12
}
```

---

## 5. ML роутер `/api/ml/*`

Доступен независимо от бэкенда логики — для отладки и тестирования.

| Метод | Путь | Вход | Выход |
|-------|------|------|-------|
| POST | `/api/ml/features` | `{imuTimeSeries, axis}` | §1 |
| POST | `/api/ml/predict` | `{features? \| imuTimeSeries?, history, trends, axis}` | `{features, anomaly, recommendations, modelVersion}` |
| GET | `/api/ml/health` | — | `{model_loaded, model_version, n_train, mode}` |

**Правило совместимости:** модель может менять значения внутри `anomaly`/`recommendations`, но не структуру ответа.
