"""
Классификатор ПАТТЕРНА движения — инференс (Неделя 4).

Отвечает на вопрос «на какой паттерн моторики похоже движение» (норма / спастика / асимметрия /
тремор), в отличие от детектора аномалий (`anomaly.py`), который ловит «хуже ли сессия личной
нормы пациента» (боль/усталость). Модель — мультиклассовый RandomForest (калибр.), обучена в
`ml-service/app/train_pattern.py` на синтетических профилях ДЦП.

⚠️ ЧЕСТНО: обучено на СИНТЕТИКЕ (классы заданы генератором), не клинически валидировано
(`validation=none`). Это ПОДСКАЗКА паттерна для врача, НЕ диагноз. Контракт: docs/ML_CONTRACT.md §6.

Граничные случаи → возвращаем None (паттерн не показываем):
  - нет/невалидные признаки;
  - partial-признаки (агрегаты Firebase без сырого ряда: нет tremorPower/плавности — классифицировать нечем);
  - модель не загружена.
"""
from __future__ import annotations
import os
import logging
from typing import Dict, Optional, Any

logger = logging.getLogger(__name__)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "pattern_model.joblib")

# Fallback-значения, если в артефакте их нет (модель хранит свои — берём приоритетно).
PATTERN_KEYS = ["rom", "peakVelocity", "smoothnessIndex", "tremorPower",
                "tremorFreqHz", "pauseRatio", "rangeAsym"]
PATTERN_LABELS_RU = {
    "normal":     "Норма",
    "spastic":    "Спастический паттерн",
    "asymmetric": "Асимметрия (гемипарез)",
    "tremor":     "Тремор / гиперкинез",
}
# Ниже этой уверенности паттерн считаем неоднозначным (помечаем lowConfidence).
LOW_CONFIDENCE = 0.45

_model: Optional[Dict] = None
_model_loaded: bool = False


def _load_model() -> Optional[Dict]:
    global _model, _model_loaded
    if _model_loaded:
        return _model
    _model_loaded = True
    if not os.path.exists(MODEL_PATH):
        logger.info("pattern_model.joblib не найден — паттерн не классифицируется")
        return None
    try:
        import joblib
        _model = joblib.load(MODEL_PATH)
        logger.info("Модель паттерна загружена: версия %s", _model.get("model_version", "?"))
        return _model
    except Exception as e:
        logger.warning("Не удалось загрузить модель паттерна: %s", e)
        return None


def preload_model() -> bool:
    """Явная предзагрузка (из main.py при старте FastAPI)."""
    return _load_model() is not None


def range_asym(f: Dict) -> float:
    """Асимметрия достижимого диапазона ∈ [0,1] (0 = симметрично). Зеркало train_pattern.range_asym."""
    mn = float(f.get("minAngle", 0) or 0)
    mx = float(f.get("maxAngle", 0) or 0)
    pos = max(mx, 0.0)
    neg = max(-mn, 0.0)
    tot = pos + neg
    return abs(pos - neg) / tot if tot > 0 else 0.0


def _pattern_vector(f: Dict, keys) -> list:
    d = dict(f)
    d["rangeAsym"] = range_asym(f)
    return [float(d.get(k, 0.0) or 0.0) for k in keys]


def classify_pattern(features: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """features (extract_features) → {label, labelRu, confidence, probs, ...} либо None.

    Контракт: docs/ML_CONTRACT.md §6.
    """
    if not features or features.get("valid") is False or features.get("partial"):
        return None
    model = _load_model()
    if model is None:
        return None
    try:
        import numpy as np
        scaler = model["scaler"]
        clf = model["clf"]
        classes = model["classes"]
        keys = model.get("feature_keys", PATTERN_KEYS)
        labels_ru = model.get("labels_ru", PATTERN_LABELS_RU)

        vec = np.array([_pattern_vector(features, keys)])
        proba = clf.predict_proba(scaler.transform(vec))[0]
        idx = int(proba.argmax())
        label = classes[idx]
        confidence = round(float(proba[idx]), 3)
        return {
            "label":         label,
            "labelRu":       labels_ru.get(label, label),
            "confidence":    confidence,
            "lowConfidence": confidence < LOW_CONFIDENCE,
            "probs":         {classes[i]: round(float(proba[i]), 3) for i in range(len(classes))},
            "modelVersion":  model.get("model_version", "pattern-v1"),
            "validation":    model.get("validation", "none"),
            "note":          "Распознавание паттерна обучено на синтетике — подсказка, не диагноз.",
        }
    except Exception as e:
        logger.warning("Классификация паттерна упала (%s) — паттерн не показываем", e)
        return None
