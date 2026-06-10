r"""
Аналитический прогон для питч-дека / due diligence.

Запуск:  venv\Scripts\python.exe ml-service\analyze_pitch.py

Делает три вещи и печатает таблицами:
  1. Дискриминация признаков: генерирует N сессий по каждому клиническому
     профилю, считает features, печатает средние значения ключевых признаков
     по профилям → видно, разделяет ли вектор признаков патологии.
  2. Метаданные обученной модели (версия, источник, размер обучения, AUC).
  3. Поведение модели по профилям: доля сессий каждого профиля, которые
     модель помечает attention/critical (реальная «работа» классификатора,
     а не заявленный ROC-AUC).
"""
from __future__ import annotations
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

from data import synthetic as syn          # noqa: E402
from app.features import extract_features   # noqa: E402

PROFILES = {
    "normal":      syn._normal_session,
    "borderline":  syn._borderline_session,
    "fatigue":     syn._fatigue_session,
    "pain":        syn._pain_session,
    "tremor":      syn._tremor_session,
    "asymmetry":   syn._asymmetry_session,
}
KEYS = ["rom", "peakVelocity", "smoothnessIndex", "tremorIndex",
        "symmetryIndex", "pauseRatio", "repetitions", "activeTimeSec"]
N = 60
import random
rng = random.Random(7)


def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def gen(profile_fn, n):
    out = []
    for _ in range(n):
        s = profile_fn(rng)
        f = extract_features(s, "r")
        if f.get("valid"):
            out.append(f)
    return out


print("=" * 78)
print("1. ДИСКРИМИНАЦИЯ ПРИЗНАКОВ — среднее по 60 сессиям каждого профиля")
print("=" * 78)
data = {name: gen(fn, N) for name, fn in PROFILES.items()}
hdr = f"{'profile':<12}" + "".join(f"{k[:9]:>11}" for k in KEYS)
print(hdr)
print("-" * len(hdr))
for name, feats in data.items():
    row = f"{name:<12}"
    for k in KEYS:
        row += f"{mean([f[k] for f in feats]):>11.2f}"
    print(row)

print()
print("=" * 78)
print("2. МЕТАДАННЫЕ ОБУЧЕННОЙ МОДЕЛИ")
print("=" * 78)
MODEL_PATH = os.path.join(ROOT, "..", "api", "app", "ml", "models", "anomaly_model.joblib")
MODEL_PATH = os.path.normpath(MODEL_PATH)
try:
    import joblib
    m = joblib.load(MODEL_PATH)
    for k in ["model_version", "source", "n_train", "n_normal", "n_anomaly",
              "test_roc_auc", "cv_roc_auc", "feature_keys"]:
        print(f"  {k:<16}: {m.get(k)}")
    model = m
except Exception as e:
    print("  Модель не загрузилась:", e)
    model = None

if model:
    print()
    print("=" * 78)
    print("3. ПОВЕДЕНИЕ МОДЕЛИ ПО ПРОФИЛЯМ — доля сессий, помеченных не-normal")
    print("   (показывает, что реально делает классификатор по каждому профилю)")
    print("=" * 78)
    from app.anomaly import _predict_with_model  # noqa: E402  (зеркало api/app/ml/anomaly.py)
    print(f"{'profile':<12}{'normal%':>10}{'attention%':>12}{'critical%':>11}{'mean score':>12}")
    print("-" * 57)
    for name, feats in data.items():
        statuses = {"normal": 0, "attention": 0, "critical": 0}
        scores = []
        for f in feats:
            r = _predict_with_model(f, [], model)
            if r:
                statuses[r["status"]] = statuses.get(r["status"], 0) + 1
                scores.append(r["anomalyScore"])
        tot = max(1, sum(statuses.values()))
        print(f"{name:<12}{100*statuses['normal']/tot:>9.0f}%"
              f"{100*statuses['attention']/tot:>11.0f}%"
              f"{100*statuses['critical']/tot:>10.0f}%"
              f"{mean(scores):>12.1f}")
