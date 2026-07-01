"""
ML Этап 2 — детектор аномалий (возможная боль/усталость), Python-порт.

Два режима работы (переключаются автоматически):

  A. MODEL-режим (если загружена anomaly_model.joblib):
     - IsolationForest  → бинарное решение (нормально/аномально)
     - RandomForest     → вероятность аномалии (0..1) → anomalyScore
     - Z-score baseline → объяснение: ЧТО именно отклонилось (flags)
     Таким образом: ML решает, z-score объясняет.

  B. RULE-режим (fallback, нет модели / нет признаков):
     Только z-score vs персональный baseline пациента.
     Идентичен исходной версии anomalyService.js.

Интерфейс ответа одинаков в обоих режимах (ML_CONTRACT.md §2).
"""
from __future__ import annotations
import math
import os
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# ─── Конфигурация ─────────────────────────────────────────────────────────────
# НЕ поднимать пороги до реальных данных ДЦП. Развёртка на Mendeley (validate_baseline.py)
# даёт «лучшую» точку 3.0σ/4.0σ, НО: (1) откалибровано на здоровых взрослых, не на детях с ДЦП;
# (2) при 3.0σ/4.0σ мягкий регресс (ROM×0.85) ловится лишь на 38% — для реабилитации это
# пропуск раннего спада; (3) корректнее чинить множественность (≥2 метрик/поправка), а не порог.
# Поэтому держим чувствительные дефолты. Подробности — память baseline-threshold-calibration.
Z_WARNING    = 1.5
Z_CRITICAL   = 2.5
MIN_BASELINE = 3     # минимум прошлых сессий для z-score

# Поправка на множественность (ЭКСПЕРИМЕНТ, по умолчанию ВЫКЛ). Идея: одиночный 1.5σ-флаг при
# 5 метриках вероятно случаен → требовать подтверждения ≥2 метриками. НО валидация на реальной
# норме (validate_baseline.py, политика B) дала РОВНО те же специфичность/чувствительность, что и
# простое «любой флаг»: ложные тревоги здесь НЕ одиночные шумовые, а коррелированные многометричные
# (реальная вариативность двигает ROM+скорость+плавность вместе) — подтверждение их не отсекает.
# Поэтому в прод НЕ включаем (нулевая польза = лишняя сложность). Флаг оставлен для воспроизводимого
# эксперимента и перепроверки, когда появятся реальные размеченные данные ДЦП. См. [[baseline-threshold-calibration]].
REQUIRE_CORROBORATION = False

# Пороги для MODEL-режима
PROB_ATTENTION = 0.45   # RF prob ≥ 0.45 → attention
PROB_CRITICAL  = 0.70   # RF prob ≥ 0.70 → critical
ISO_WEIGHT     = 0.25   # вес IsolationForest в итоговом счёте

MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "anomaly_model.joblib")

# Правила z-score объяснений выровнены с 6 признаками модели (FEATURE_KEYS). tremorIndex
# намеренно НЕ здесь: это временной дубликат спектрального tremorPower (см. train.py) — держать
# оба = задвоить тремор в anomalyScore. tremorIndex по-прежнему считается в features.py и
# показывается врачу как отдельный KPI, но в детектор аномалий идёт только tremorPower.
RULES = [
    {"key": "rom",            "bad": "down", "label": "Амплитуда (ROM)",       "hint": "снижение — возможна боль/щажение"},
    {"key": "peakVelocity",   "bad": "down", "label": "Скорость движений",     "hint": "замедление — возможна усталость"},
    {"key": "smoothnessIndex","bad": "down", "label": "Плавность движений",    "hint": "рывковость — возможна боль/усталость"},
    {"key": "tremorPower",    "bad": "up",   "label": "Спектральная дрожь",    "hint": "рост доли мощности в полосе дрожи — усталость/неврология"},
    {"key": "pauseRatio",     "bad": "up",   "label": "Паузы в движении",      "hint": "больше пауз — возможна усталость"},
]

# Ядро из 6 признаков модели (урезано с 14; зеркало train.py.FEATURE_KEYS). Порядок и состав
# ОБЯЗАНЫ совпадать с тем, на чём обучена модель — иначе вектор инференса не сойдётся.
# При наличии загруженной модели берутся её сохранённые feature_keys (см. _predict_with_model).
FEATURE_KEYS = [
    "rom", "peakVelocity", "smoothnessIndex",
    "tremorPower", "pauseRatio", "activeTimeSec",
]


# ─── Ленивая загрузка модели ──────────────────────────────────────────────────

_model: Optional[Dict] = None
_model_loaded: bool = False


def _load_model() -> Optional[Dict]:
    """Загружает модель один раз при первом вызове."""
    global _model, _model_loaded
    if _model_loaded:
        return _model
    _model_loaded = True
    if not os.path.exists(MODEL_PATH):
        logger.info("anomaly_model.joblib не найден — используется rule-based режим")
        return None
    try:
        import joblib
        obj = joblib.load(MODEL_PATH)
        _model = obj
        logger.info("Модель аномалий загружена: %s (обучено на %d сессиях, версия %s)",
                    MODEL_PATH,
                    obj.get("n_train", "?"),
                    obj.get("model_version", "?"))
        return _model
    except Exception as e:
        logger.warning("Не удалось загрузить модель: %s — fallback на rule-based", e)
        return None


def preload_model() -> bool:
    """Явная предзагрузка (вызывается из main.py при старте FastAPI)."""
    m = _load_model()
    return m is not None


# ─── Вспомогательные функции ─────────────────────────────────────────────────

def _mean(a: List[float]) -> float:
    return sum(a) / len(a) if a else 0.0


def _std(a: List[float], m: float) -> float:
    if len(a) < 2:
        return 0.0
    return math.sqrt(sum((x - m) ** 2 for x in a) / (len(a) - 1))


def _zscore_flags(current: Dict, history: List[Dict]) -> List[Dict]:
    """Z-score анализ — формирует список flags для объяснения решения модели."""
    flags = []
    score = 0.0
    for rule in RULES:
        series = [float(f.get(rule["key"]) or 0) for f in history]
        m = _mean(series)
        sd = _std(series, m)
        if sd == 0:
            continue
        val = float(current.get(rule["key"]) or 0)
        z = (val - m) / sd
        adverse = (rule["bad"] == "down" and z < 0) or (rule["bad"] == "up" and z > 0)
        abs_z = abs(z)
        if not adverse or abs_z < Z_WARNING:
            continue
        severity = "critical" if abs_z >= Z_CRITICAL else "warning"
        score += abs_z
        flags.append({
            "metric":   rule["key"],
            "label":    rule["label"],
            "severity": severity,
            "z":        round(z * 100) / 100,
            "baseline": round(m * 1000) / 1000,
            "current":  round(val * 1000) / 1000,
            "text":     f'{rule["label"]}: {rule["hint"]} (отклонение {z:.1f}σ от нормы пациента)',
        })
    return flags, score


# ─── MODEL-режим ─────────────────────────────────────────────────────────────

def _predict_with_model(current: Dict, history: List[Dict], model: Dict) -> Dict:
    """Аномалия через обученную модель + z-score для объяснения."""
    try:
        import numpy as np
        scaler = model["scaler"]
        clf    = model["clf"]
        iso    = model["iso"]
        keys   = model.get("feature_keys", FEATURE_KEYS)

        vec = np.array([[float(current.get(k, 0)) for k in keys]])
        vec_s = scaler.transform(vec)

        # RandomForest → вероятность аномалии
        rf_prob = float(clf.predict_proba(vec_s)[0, 1])

        # IsolationForest → бинарное решение
        iso_flag = iso.predict(vec_s)[0] == -1   # True = аномалия

        # Комбинированный счёт: RF доминирует, IF добавляет
        combined_prob = rf_prob * (1 - ISO_WEIGHT) + (1.0 if iso_flag else 0.0) * ISO_WEIGHT
        anomaly_score = round(combined_prob * 100, 1)

        # Статус
        if combined_prob >= PROB_CRITICAL:
            status = "critical"
        elif combined_prob >= PROB_ATTENTION:
            status = "attention"
        else:
            status = "normal"

        # Z-score флаги (для объяснения «почему»)
        baseline_size = len(history)
        if baseline_size >= MIN_BASELINE:
            valid_hist = [f for f in history if f and f.get("valid") is not False]
            flags, _ = _zscore_flags(current, valid_hist) if valid_hist else ([], 0.0)
        else:
            flags = []

        note_map = {
            "normal":    "Сессия в пределах нормы (ML-оценка)",
            "attention": "Лёгкое отклонение от нормы — стоит понаблюдать (ML-оценка)",
            "critical":  "Признаки возможной боли/усталости — требуется внимание врача (ML-оценка, не диагноз)",
        }

        return {
            "status":       status,
            "anomalyScore": anomaly_score,
            "baselineSize": baseline_size,
            "flags":        flags,
            "modelVersion": model.get("model_version", "v2"),
            "mode":         "ml",
            "note":         note_map.get(status, ""),
        }

    except Exception as e:
        logger.warning("ML-предсказание упало (%s) — fallback на z-score", e)
        return None


# ─── RULE-режим (z-score, без модели) ────────────────────────────────────────

def _predict_rule_based(current: Dict, history: List[Dict]) -> Dict:
    """Оригинальная z-score логика (anomalyService.js port)."""
    valid = [f for f in history if f and f.get("valid") is not False
             and isinstance(f.get("rom"), (int, float))]

    if len(valid) < MIN_BASELINE:
        return {
            "status":       "insufficient_baseline",
            "flags":        [],
            "anomalyScore": 0,
            "baselineSize": len(valid),
            "mode":         "rule",
            "note":         f"Нужно ≥ {MIN_BASELINE} прошлых сессий для базовой линии (есть {len(valid)})",
        }

    flags, score = _zscore_flags(current, valid)
    n_crit = sum(1 for f in flags if f["severity"] == "critical")
    n_total = len(flags)
    partial = bool(current.get("partial"))

    if REQUIRE_CORROBORATION and not partial:
        # Эскалация только при подтверждении ≥2 метриками; одиночный critical → attention.
        if n_total >= 2:
            status = "critical" if n_crit >= 1 else "attention"
        elif n_total == 1:
            status = "attention" if n_crit >= 1 else "normal"
        else:
            status = "normal"
    else:
        status = "critical" if n_crit >= 1 else ("attention" if flags else "normal")

    return {
        "status":       status,
        "flags":        flags,
        "anomalyScore": round(score * 100) / 100,
        "baselineSize": len(valid),
        "mode":         "rule",
        "note":         ("Сессия в пределах нормы пациента" if status == "normal"
                         else "Признаки возможной боли/усталости — требуется внимание врача (не диагноз)"),
    }


# ─── Главная функция ──────────────────────────────────────────────────────────

def detect_anomalies(
    current: Dict[str, Any],
    history: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Определяет, отклоняется ли текущая сессия от нормы пациента.

    current  — признаки текущей сессии (extract_features output)
    history  — список признаков прошлых сессий (от старых к новым)

    Возвращает: {status, anomalyScore, baselineSize, flags, mode, note}
    Контракт: docs/ML_CONTRACT.md §2
    """
    if not current or current.get("valid") is False:
        return {
            "status":       "no_data",
            "flags":        [],
            "anomalyScore": 0,
            "baselineSize": len(history or []),
            "mode":         "none",
            "note":         "Нет признаков текущей сессии",
        }

    # Частичные признаки (агрегаты Firebase: rom/minAngle/maxAngle, без сырого ряда IMU)
    # → ПРИНУДИТЕЛЬНО rule-режим. Обученная модель ждёт полный вектор из 6 признаков;
    # из них на частичных данных доступен только rom — подстановка нулей вместо 5 отсутствующих
    # (peakVelocity, smoothnessIndex, tremorPower, pauseRatio, activeTimeSec) даёт мусорный
    # anomalyScore. Z-score по доступным признакам (rom) — корректен и честен.
    partial = bool(current.get("partial"))

    # Пробуем ML-модель (только на полном векторе признаков)
    model = None if partial else _load_model()
    if model is not None:
        result = _predict_with_model(current, history or [], model)
        if result is not None:
            return result

    # Fallback / частичные данные: rule-based z-score
    result = _predict_rule_based(current, history or [])
    if partial:
        result["partial"] = True
        result["note"] = (result.get("note", "")
                          + " Анализ ограничен амплитудой (ROM): нет сырого ряда IMU.").strip()
    return result
