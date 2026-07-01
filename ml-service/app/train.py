"""
Обучение моделей аномалий Axis — v2 (2026-06-03).

Пайплайн:
  1. Загружаем данные: реальные (PAMAP2) + синтетика. Реальные в приоритете.
  2. Считаем признаки extract_features() — тот же вектор, что в продакшне.
  3. Обучаем три модели:
     a. IsolationForest   — безнадзорный (только на нормальных сессиях)
     b. RandomForest      — надзорный (классификация normal/anomaly)
     c. RobustScaler      — нормализация признаков (устойчив к выбросам)
  4. Сохраняем в app/models/anomaly_model.joblib.
  5. Печатаем ЧЕСТНЫЕ метрики на отложенной test-выборке + CV ROC-AUC.
     (Раньше печатались метрики на train — завышенные и вводящие в заблуждение.)

Запуск:
    cd ml-service
    pip install -r requirements.txt
    python -m app.train

Добавить реальные данные PAMAP2:
    pip install ucimlrepo
    python -m app.train          ← автоматически скачает и использует

Или вручную:
    1. Скачать https://archive.ics.uci.edu/dataset/231
    2. Распаковать в ml-service/data/pamap2/
    3. python -m app.train
"""
from __future__ import annotations
import os
import sys
import time
from typing import List, Tuple

import numpy as np

from .features import extract_features

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODEL_DIR, "anomaly_model.joblib")

# Ядро из 6 клинически осмысленных признаков для модели (урезано с 14). Убраны дубли и
# мусор: minAngle/maxAngle (их разницу несёт rom), meanAbsVelocity (коррелирует с peakVelocity),
# meanJerk (из него считается smoothnessIndex), tremorIndex/tremorFreqHz (дублируют спектральный
# tremorPower), repetitions (геймплей, не моторика) и мёртвый symmetryIndex (importance ~0.001).
# features.py по-прежнему считает ВСЕ признаки — для показа врачу и правил-рекомендаций;
# в МОДЕЛЬ идёт только это ядро. Асимметрия ловится отдельно в recommendations.detect_weak_side.
FEATURE_KEYS = [
    "rom", "peakVelocity", "smoothnessIndex",
    "tremorPower", "pauseRatio", "activeTimeSec",
]


# ─── Загрузка данных ────────────────────────────────────────────────────────

def _series_to_vector(series: list) -> List[float] | None:
    """imuTimeSeries → вектор признаков. None если invalid."""
    f = extract_features(series, "r")
    if not f.get("valid"):
        return None
    return [float(f.get(k, 0.0)) for k in FEATURE_KEYS]


def load_dataset() -> Tuple[np.ndarray, np.ndarray, str]:
    """
    Возвращает (X, y, source_description).
    Пробует реальные данные, дополняет синтетикой для баланса.
    """
    X_all: List[List[float]] = []
    y_all: List[int] = []
    sources: List[str] = []

    # ── Реальные данные ВАШЕГО устройства (MongoDB) ───────────────────────
    # Приоритетный источник: сессии, реально сыгранные через приложение, с сырым рядом и
    # меткой самочувствия пациента (ground truth). Если Mongo выключена/пуста — пропускаем.
    try:
        from data.mongo_loader import load_mongo_dataset  # type: ignore
        mongo_series, mongo_labels, mstats = load_mongo_dataset()
        n_mongo = 0
        for s, lbl in zip(mongo_series, mongo_labels):
            v = _series_to_vector(s)
            if v:
                X_all.append(v)
                y_all.append(lbl)
                n_mongo += 1
        if n_mongo:
            sources.append(f"MongoDB устройство ({mstats['normal']} норм., "
                            f"{mstats['anomaly']} аном., реальные метки)")
            print(f"[OK] Реальные данные устройства: {n_mongo} размеченных сессий")
    except Exception as e:
        print(f"[WARN] MongoDB-данные недоступны ({e}).")

    # ── Реальные данные (PAMAP2) ──────────────────────────────────────────
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
        from data.real_data_loader import make_real_dataset  # type: ignore
        real_series, real_labels = make_real_dataset(max_windows_per_subject=80)
        if real_series:
            for s, lbl in zip(real_series, real_labels):
                v = _series_to_vector(s)
                if v:
                    X_all.append(v)
                    y_all.append(lbl)
            sources.append(f"PAMAP2 ({sum(1 for l in real_labels if l==0)} норм., "
                            f"{sum(1 for l in real_labels if l==1)} аном.)")
            print(f"[OK]Реальные данные: {len(real_series)} окон → {len(X_all)} векторов")
    except Exception as e:
        print(f"[WARN] Реальные данные недоступны ({e}), только синтетика.")

    # ── Реальные движения запястья (Mendeley Smartwatch IMU) ──────────────
    # Реальные сигналы (живой шум датчика, настоящая моторика) → класс «норма».
    # HAR-датасет без меток нормы/аномалии, поэтому все сессии label=0.
    # Если папки data/mendeley/ нет — тихо пропускаем.
    try:
        from data.mendeley_loader import load_mendeley_dataset  # type: ignore
        men_series, men_labels, mstats = load_mendeley_dataset()
        n_men = 0
        for s, lbl in zip(men_series, men_labels):
            v = _series_to_vector(s)
            if v:
                X_all.append(v)
                y_all.append(lbl)
                n_men += 1
        if n_men:
            sources.append(f"Mendeley запястье ({n_men} реальных сессий, норма)")
            print(f"[OK] Реальные движения запястья (Mendeley): {n_men} сессий")
        elif mstats.get("note"):
            print(f"[WARN] Mendeley: {mstats['note']}")
    except Exception as e:
        print(f"[WARN] Mendeley-данные недоступны ({e}).")

    # ── Синтетика (всегда добавляем для устойчивости) ──────────────────────
    from data.synthetic import make_labeled_dataset  # type: ignore
    n_synth = max(300, 600 - len(X_all))  # чем больше реальных, тем меньше синтетики
    synth_data = make_labeled_dataset(
        n_normal=int(n_synth * 0.60),
        n_abnormal=int(n_synth * 0.40),
        seed=99,
    )
    n_synth_added = 0
    for s, lbl in synth_data:
        v = _series_to_vector(s)
        if v:
            X_all.append(v)
            y_all.append(lbl)
            n_synth_added += 1
    sources.append(f"Синтетика v2 ({n_synth_added} окон)")
    print(f"[OK]Синтетика v2: {n_synth_added} векторов добавлено")

    source_str = " + ".join(sources)
    return np.array(X_all, dtype=float), np.array(y_all, dtype=int), source_str


def _save_dataset_artifact(X: np.ndarray, y: np.ndarray, source: str) -> None:
    """Сохраняет нормализованный датасет + отчёт о составе (воспроизводимость/аудит).

    Артефакт: data/dataset_latest.npz (X — векторы признаков, y — метки, feature_keys, source).
    Отчёт: data/dataset_latest_report.json (число норм/аномалий, средние по признакам, источник).
    Признаки масштабирует RobustScaler уже в самой модели (и при инференсе) — здесь хранятся
    «сырые» признаки, чтобы датасет был самодостаточным и переобучаемым.
    """
    import json
    import time
    data_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
    os.makedirs(data_dir, exist_ok=True)
    npz_path = os.path.join(data_dir, "dataset_latest.npz")
    np.savez_compressed(npz_path, X=X, y=y,
                        feature_keys=np.array(FEATURE_KEYS), source=source)
    report = {
        "built_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "source": source,
        "n_total": int(len(y)),
        "n_normal": int((y == 0).sum()) if len(y) else 0,
        "n_anomaly": int((y == 1).sum()) if len(y) else 0,
        "feature_keys": FEATURE_KEYS,
        "feature_means": ({k: round(float(X[:, i].mean()), 3) for i, k in enumerate(FEATURE_KEYS)}
                          if len(X) else {}),
    }
    with open(os.path.join(data_dir, "dataset_latest_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(f"[OK] Датасет сохранён: {npz_path} (+ dataset_latest_report.json)")


# ─── Обучение ───────────────────────────────────────────────────────────────

def main():
    try:
        from sklearn.ensemble import IsolationForest, RandomForestClassifier
        from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
        from sklearn.preprocessing import RobustScaler
        from sklearn.metrics import classification_report, roc_auc_score, confusion_matrix
        from sklearn.calibration import CalibratedClassifierCV
        import joblib
    except ImportError:
        print("Нужны зависимости: pip install -r requirements.txt")
        return

    # Windows-консоль (cp1251) роняет emoji-print из загрузчиков (PAMAP2: ⚠/📥/✅) с
    # UnicodeEncodeError, который выше глотался как «данные недоступны» → молчаливый откат
    # на синтетику. Переключаем stdout/stderr на utf-8, чтобы реальные данные реально грузились.
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass

    t0 = time.time()
    print("=" * 60)
    print("Axis ML — Обучение модели аномалий v2")
    print("=" * 60)

    X, y, source = load_dataset()
    n_total = len(y)
    n_norm  = int((y == 0).sum())
    n_anom  = int((y == 1).sum())
    print(f"\nДатасет: {n_total} сессий | норма={n_norm} | аномалия={n_anom}")
    print(f"Источники: {source}")

    # Сохраняем нормализованный датасет + отчёт (всегда, даже если мало для обучения).
    _save_dataset_artifact(X, y, source)

    if n_total < 20:
        print("[ERR]Слишком мало данных для обучения.")
        return

    def _make_rf():
        return RandomForestClassifier(
            n_estimators=400, max_depth=10, min_samples_leaf=3,
            class_weight="balanced", random_state=0, n_jobs=-1,
        )

    # ── ЧЕСТНАЯ оценка на отложенной выборке (test 25%) ───────────────────
    # Раньше метрики печатались на train → завышенные precision/recall.
    # Теперь модель оценивается на данных, которых она не видела.
    print("\n=== RandomForest — оценка на отложенном test (25%) ===")
    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y, test_size=0.25, stratify=y, random_state=42
    )
    eval_scaler = RobustScaler().fit(X_tr)   # scaler — только на train (без утечки)
    X_tr_s, X_te_s = eval_scaler.transform(X_tr), eval_scaler.transform(X_te)

    clf_eval = CalibratedClassifierCV(_make_rf(), method="sigmoid", cv=5)
    clf_eval.fit(X_tr_s, y_tr)
    proba_te = clf_eval.predict_proba(X_te_s)[:, 1]
    pred_te  = (proba_te >= 0.50).astype(int)
    print(classification_report(y_te, pred_te, target_names=["норма", "аномалия"], zero_division=0))
    test_auc = None
    try:
        test_auc = roc_auc_score(y_te, proba_te)
        print(f"ROC-AUC (test, честный): {test_auc:.3f}")
    except Exception:
        pass
    cm = confusion_matrix(y_te, pred_te)
    print(f"Confusion matrix (test):\n  TN={cm[0,0]}  FP={cm[0,1]}\n  FN={cm[1,0]}  TP={cm[1,1]}")

    # CV ROC-AUC на всех данных (доп. устойчивая оценка)
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(_make_rf(), eval_scaler.transform(X), y,
                                cv=cv, scoring="roc_auc", n_jobs=-1)
    print(f"CV ROC-AUC (5-fold): {cv_scores.mean():.3f} ± {cv_scores.std():.3f}")

    # Важность признаков (на train, без калибровки)
    rf_imp = _make_rf().fit(X_tr_s, y_tr)
    imp = dict(sorted(zip(FEATURE_KEYS, rf_imp.feature_importances_.round(3)),
                      key=lambda kv: -kv[1]))
    print(f"Важность признаков: {imp}")

    # ── Финальные модели на ВСЁМ датасете (для продакшна) ─────────────────
    print("\n=== Финальное обучение на всех данных (для сохранения) ===")
    scaler = RobustScaler()
    X_s = scaler.fit_transform(X)

    # IsolationForest: contamination МАЛА (ожидаемая доля выбросов среди НОРМАЛЬНЫХ),
    # т.к. fit только на нормальных. Раньше = n_anom/n_total (до 0.4) → IF помечал
    # до 40% нормы как аномалии. Для one-class это методологически неверно.
    iso = IsolationForest(n_estimators=300, contamination=0.05,
                          max_features=0.8, random_state=0, n_jobs=-1)
    iso.fit(X_s[y == 0])

    clf = CalibratedClassifierCV(_make_rf(), method="sigmoid", cv=5)
    clf.fit(X_s, y)

    # ── Сохранение ────────────────────────────────────────────────────────
    # Версия и валидация маркируются ЧЕСТНО:
    #   - суффикс -synthetic, если реальных данных (PAMAP2/клиника) не было;
    #   - validation="none", пока нет клинически размеченных данных.
    # ROC-AUC выше посчитан на синтетике (label = параметры генератора) и НЕ является
    # доказательством клинической точности — это указано в metrics_note.
    has_real = ("PAMAP2" in source) or ("MongoDB" in source) or ("Mendeley" in source)
    is_synthetic_only = not has_real
    # Реальные метки самочувствия пациента (боль/усталость) из приложения — это ground truth,
    # хоть и не клиническая валидация. Помечаем validation честно: "self-reported", если в
    # источнике есть размеченные сессии устройства; иначе "none".
    has_device_labels = "реальные метки" in source
    model_version = "v7-2026-06-10-realdata" + ("-synthetic" if is_synthetic_only else "-mixed")
    validation = "self-reported" if has_device_labels else "none"

    os.makedirs(MODEL_DIR, exist_ok=True)
    model_obj = {
        "scaler":         scaler,
        "clf":            clf,          # RandomForest + калибровка
        "iso":            iso,          # IsolationForest
        "feature_keys":   FEATURE_KEYS,
        "source":         source,
        "n_train":        n_total,
        "n_normal":       n_norm,
        "n_anomaly":      n_anom,
        "test_roc_auc":   round(float(test_auc), 3) if test_auc is not None else None,
        "cv_roc_auc":     round(float(cv_scores.mean()), 3),
        "model_version":  model_version,
        "validation":     validation,
        "synthetic_only": is_synthetic_only,
        "metrics_note":   ("ROC-AUC посчитан на синтетике (label = параметры генератора). "
                           "НЕ доказательство клинической точности. До клин. валидации "
                           "основной механизм — персональный z-score baseline."),
    }
    joblib.dump(model_obj, MODEL_PATH)
    elapsed = time.time() - t0
    print(f"\n[OK]Модель сохранена: {MODEL_PATH}  ({elapsed:.1f} с)")
    print(f"   Версия: {model_version} | validation: {validation}")
    if is_synthetic_only:
        print("[WARN]  ВНИМАНИЕ: обучено только на синтетике (validation=none).")
        print("   ROC-AUC выше — НЕ клиническая метрика. Для продакшна нужны реальные данные.")
        print("   Установите: pip install ucimlrepo  ИЛИ скачайте PAMAP2 в data/pamap2/")


if __name__ == "__main__":
    main()
