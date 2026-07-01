"""
Обучение КЛАССИФИКАТОРА ПАТТЕРНА движения (Неделя 4) — v1 (2026-06-30).

Отдельная задача от детектора аномалий (`train.py`): не «хуже ли сессия личной нормы»
(боль/усталость), а «на какой ПАТТЕРН моторики похоже движение». 4 класса, сопоставленные
синтетическим профилям ДЦП из `data/synthetic.py`:
  normal     ← _normal_session + _borderline_session
  spastic    ← _spastic_session            (гипертонус: малый ROM, рывковость, паузы)
  asymmetric ← _hemiparesis_session        (односторонняя слабость: асимметрия диапазона)
  tremor     ← _dyskinetic_session + _ataxic_session (гиперкинез: высокий tremorPower)

⚠️ ЧЕСТНО: обучается на СИНТЕТИКЕ — классы заданы генератором, не клинически валидированы.
Это «подсказка паттерна», НЕ диагноз. validation=none. До реальных размеченных данных ДЦП
не заявлять как диагностику.

Пайплайн (как в train.py): RobustScaler + RandomForest(калибр. sigmoid) → predict_proba даёт
уверенность по классам. Честная оценка на отложенном test (per-class precision/recall/f1 +
confusion matrix + macro ROC-AUC OvR).

Запуск:  cd ml-service && ../venv/Scripts/python.exe -m app.train_pattern
"""
from __future__ import annotations
import os
import sys
import time
from typing import List, Tuple

import numpy as np

from .features import extract_features

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODEL_DIR, "pattern_model.joblib")

# Классы и их генераторы (синтетические профили). Порядок = индексы меток.
PATTERN_CLASSES = ["normal", "spastic", "asymmetric", "tremor"]
PATTERN_LABELS_RU = {
    "normal":     "Норма",
    "spastic":    "Спастический паттерн",
    "asymmetric": "Асимметрия (гемипарез)",
    "tremor":     "Тремор / гиперкинез",
}

# Признаки классификатора паттерна. Отличается от ядра детектора аномалий: добавлены
# tremorFreqHz (разделяет дискинезию ~2 Гц и атаксию ~4 Гц) и rangeAsym (ловит гемипарез).
PATTERN_KEYS = ["rom", "peakVelocity", "smoothnessIndex", "tremorPower",
                "tremorFreqHz", "pauseRatio", "rangeAsym"]


def range_asym(f: dict) -> float:
    """Асимметрия достижимого диапазона ∈ [0,1] (0 = симметрично). Зеркало в api/app/ml/pattern.py."""
    mn = float(f.get("minAngle", 0) or 0)
    mx = float(f.get("maxAngle", 0) or 0)
    pos = max(mx, 0.0)
    neg = max(-mn, 0.0)
    tot = pos + neg
    return abs(pos - neg) / tot if tot > 0 else 0.0


def pattern_vector(f: dict) -> List[float]:
    """features-словарь → вектор признаков паттерна. Зеркало в api/app/ml/pattern.py."""
    d = dict(f)
    d["rangeAsym"] = range_asym(f)
    return [float(d.get(k, 0.0) or 0.0) for k in PATTERN_KEYS]


def build_dataset(per_class: int = 420, seed: int = 7) -> Tuple[np.ndarray, np.ndarray]:
    """Сбалансированный мультиклассовый датасет из синтетических профилей."""
    import random
    from data.synthetic import (  # type: ignore
        _normal_session, _borderline_session, _spastic_session,
        _hemiparesis_session, _dyskinetic_session, _ataxic_session,
    )
    generators = {
        "normal":     [_normal_session, _borderline_session],
        "spastic":    [_spastic_session],
        "asymmetric": [_hemiparesis_session],
        "tremor":     [_dyskinetic_session, _ataxic_session],
    }
    rng = random.Random(seed)
    X: List[List[float]] = []
    y: List[int] = []
    for ci, cls in enumerate(PATTERN_CLASSES):
        fns = generators[cls]
        for k in range(per_class):
            fn = fns[k % len(fns)]
            feats = extract_features(fn(rng), "r")
            if not feats.get("valid"):
                continue
            X.append(pattern_vector(feats))
            y.append(ci)
    return np.array(X, dtype=float), np.array(y, dtype=int)


def main():
    try:
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.model_selection import train_test_split
        from sklearn.preprocessing import RobustScaler
        from sklearn.calibration import CalibratedClassifierCV
        from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score
        import joblib
    except ImportError:
        print("Нужны зависимости: pip install -r requirements.txt")
        return

    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass

    t0 = time.time()
    print("=" * 60)
    print("Классификатор паттерна движения — обучение v1 (синтетика)")
    print("=" * 60)

    X, y = build_dataset()
    counts = {PATTERN_CLASSES[i]: int((y == i).sum()) for i in range(len(PATTERN_CLASSES))}
    print(f"Датасет: {len(y)} сессий | по классам: {counts}")

    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, stratify=y, random_state=42)
    scaler = RobustScaler().fit(X_tr)
    X_tr_s, X_te_s = scaler.transform(X_tr), scaler.transform(X_te)

    # 150 деревьев/глубина 10 + калибровка cv=3: задача 4-классовая и чисто разделимая, 400×cv5
    # давали тот же результат при артефакте ~28 МБ (4× нормы). Эти параметры → ~7 МБ как у anomaly.
    def _make_rf():
        return RandomForestClassifier(n_estimators=150, max_depth=10, min_samples_leaf=2,
                                      class_weight="balanced", random_state=0, n_jobs=-1)

    print("\n=== Оценка на отложенном test (25%) ===")
    clf_eval = CalibratedClassifierCV(_make_rf(), method="sigmoid", cv=3)
    clf_eval.fit(X_tr_s, y_tr)
    proba_te = clf_eval.predict_proba(X_te_s)
    pred_te = proba_te.argmax(axis=1)
    print(classification_report(y_te, pred_te, target_names=PATTERN_CLASSES, zero_division=0))
    cm = confusion_matrix(y_te, pred_te)
    print("Confusion matrix (строки=истина, столбцы=предсказание):")
    print("            " + "  ".join(f"{c[:6]:>6}" for c in PATTERN_CLASSES))
    for i, c in enumerate(PATTERN_CLASSES):
        print(f"  {c:<10}" + "  ".join(f"{cm[i, j]:>6}" for j in range(len(PATTERN_CLASSES))))
    macro_auc = None
    try:
        macro_auc = roc_auc_score(y_te, proba_te, multi_class="ovr", average="macro")
        print(f"\nMacro ROC-AUC (OvR): {macro_auc:.3f}")
    except Exception as e:
        print(f"ROC-AUC недоступен: {e}")

    imp = _make_rf().fit(X_tr_s, y_tr).feature_importances_
    print("Важность признаков:", {k: round(float(v), 3) for k, v in
                                   sorted(zip(PATTERN_KEYS, imp), key=lambda kv: -kv[1])})

    # ── Финальная модель на всех данных ───────────────────────────────────────
    final_scaler = RobustScaler().fit(X)
    clf = CalibratedClassifierCV(_make_rf(), method="sigmoid", cv=3)
    clf.fit(final_scaler.transform(X), y)

    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump({
        "scaler":        final_scaler,
        "clf":           clf,
        "classes":       PATTERN_CLASSES,
        "labels_ru":     PATTERN_LABELS_RU,
        "feature_keys":  PATTERN_KEYS,
        "model_version": "pattern-v1-2026-06-30-synthetic",
        "validation":    "none",
        "macro_roc_auc": round(float(macro_auc), 3) if macro_auc is not None else None,
        "metrics_note":  ("Классы заданы синтетическим генератором профилей ДЦП. Это распознавание "
                          "ПАТТЕРНА движения, НЕ клинический диагноз. ROC-AUC — на синтетике."),
    }, MODEL_PATH)
    print(f"\n[OK] Модель сохранена: {MODEL_PATH}  ({time.time() - t0:.1f} с)")
    print("[WARN] validation=none — синтетика. Это подсказка паттерна, не диагноз.")


if __name__ == "__main__":
    main()
