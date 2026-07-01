"""
Тесты классификатора паттерна движения (api/app/ml/pattern.py).

Проверяем ПРОД-инференс end-to-end на чисто сгенерированных профилях (детерминированные синусы,
без случайного шума — чтобы тест был стабильным) + граничные случаи (невалидные/partial → None).

Запуск:  cd api && ../venv/Scripts/python.exe -m pytest tests/test_pattern.py -v
"""
from __future__ import annotations
import math

from app.ml.features import extract_features
from app.ml.pattern import classify_pattern, _load_model


def _gen(rom=50.0, freq=0.5, tremor=0.0, tremor_hz=5.0, asym=0.0, dur=20.0, fs=25.0):
    """Чистая синтетическая сессия (ядро make_session без шума/пауз) — детерминированно."""
    n = int(dur * fs)
    dt = 1000.0 / fs
    amp_pos = rom / 2 * (1.0 + min(0.0, asym))   # asym>0 ограничивает «минус»
    amp_neg = rom / 2 * (1.0 - max(0.0, asym))
    s = []
    for i in range(n):
        t = i * dt
        ts = t / 1000.0
        base = math.sin(2 * math.pi * freq * ts)
        r = (amp_pos * base) if base >= 0 else (amp_neg * base)
        r += tremor * rom * 0.15 * math.sin(2 * math.pi * tremor_hz * ts)
        s.append({"t": round(t, 1), "r": round(r, 3), "p": 0.0, "y": 0.0})
    return s


def _label(series):
    res = classify_pattern(extract_features(series, "r"))
    assert res is not None, "ожидался результат классификации"
    return res["label"], res


def _model_available():
    return _load_model() is not None


# ─── Граничные случаи (работают даже без модели) ────────────────────────────
def test_graceful_on_invalid_or_partial():
    assert classify_pattern({}) is None
    assert classify_pattern({"valid": False}) is None
    assert classify_pattern(extract_features([], "r")) is None          # пустой ряд → valid=False
    # partial-признаки (агрегаты Firebase: только ROM, нет tremorPower/плавности) → не классифицируем
    assert classify_pattern({"valid": True, "partial": True, "rom": 30}) is None


# ─── Классификация чистых профилей (если модель загружена) ──────────────────
def test_normal_pattern():
    if not _model_available():
        return
    label, res = _label(_gen(rom=50, tremor=0.0, asym=0.0))
    assert label == "normal", res["probs"]
    assert 0.0 <= res["confidence"] <= 1.0
    assert set(res["probs"]) == {"normal", "spastic", "asymmetric", "tremor"}


def test_tremor_pattern():
    if not _model_available():
        return
    label, res = _label(_gen(rom=45, tremor=0.6, tremor_hz=5.0))
    assert label == "tremor", res["probs"]


def test_asymmetric_pattern():
    if not _model_available():
        return
    label, res = _label(_gen(rom=50, asym=0.7))
    assert label == "asymmetric", res["probs"]


def test_result_shape():
    if not _model_available():
        return
    _, res = _label(_gen(rom=50))
    for key in ("label", "labelRu", "confidence", "lowConfidence", "probs", "modelVersion", "note"):
        assert key in res
    assert res["validation"] == "none"   # честно: синтетика, не клиническая валидация
