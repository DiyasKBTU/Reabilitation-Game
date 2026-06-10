"""
Валидация эталонной реализации признаков (api/app/ml/features.py ≡ ml-service/app/features.py).

ИСТОРИЯ: до v8.0 здесь проверялся паритет Python ↔ backend/services/featureService.js.
Node-бэкенд удалён в v8.0 → JS-эталона больше нет, признаки считаются ТОЛЬКО на Python.
Поэтому тест переписан в полноценную валидацию Python-реализации:
  1. valid + корректные диапазоны;
  2. детерминизм (одинаковый вход → одинаковый выход);
  3. клиническая дискриминация (норма vs патология);
  4. робастность (пустой/мусорный вход не роняет функцию);
  5. golden-регрессия (фиксированные значения — ловит непреднамеренные изменения формул).

Запуск:  venv\\Scripts\\python.exe -m pytest ml-service/tests/ -v
"""
from __future__ import annotations
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.features import extract_features, empty_features  # noqa: E402
from data.synthetic import make_session                    # noqa: E402


def _sessions():
    return {
        "normal": make_session(rom=50, smooth=0.95, tremor=0.05, seed=1),
        "patho":  make_session(rom=25, smooth=0.4, tremor=0.6, asymmetry=0.4, pause_frac=0.4, seed=2),
        "asym":   make_session(rom=60, smooth=0.9, asymmetry=-0.3, seed=3),
    }


# ─── 1. Валидность и диапазоны ──────────────────────────────────────────────
def test_features_valid_and_ranges():
    for name, s in _sessions().items():
        f = extract_features(s, "r")
        assert f["valid"] is True, name
        assert f["rom"] > 0, name
        assert 0 <= f["smoothnessIndex"] <= 1, name
        assert 0 <= f["tremorIndex"] <= 1, name
        assert 0 <= f["tremorPower"] <= 1, name
        assert f["tremorFreqHz"] >= 0, name
        assert -1 <= f["symmetryIndex"] <= 1, name
        assert 0 <= f["pauseRatio"] <= 1, name
        assert f["maxAngle"] >= f["minAngle"], name
        assert f["repetitions"] >= 0, name


# ─── 2. Детерминизм ─────────────────────────────────────────────────────────
def test_determinism():
    s = _sessions()["normal"]
    a = extract_features(s, "r")
    b = extract_features(s, "r")
    assert a == b, "extract_features недетерминирован на одинаковом входе"


# ─── 3. Клиническая дискриминация ───────────────────────────────────────────
def test_discrimination():
    f = {k: extract_features(v, "r") for k, v in _sessions().items()}
    # Патология: больше тремор, больше пауз, ниже плавность, чем у нормы
    assert f["patho"]["tremorIndex"] > f["normal"]["tremorIndex"]
    assert f["patho"]["pauseRatio"] > f["normal"]["pauseRatio"]
    assert f["patho"]["smoothnessIndex"] < f["normal"]["smoothnessIndex"]
    # Спектральная дрожь: у патологии больше доля мощности в полосе тремора
    assert f["patho"]["tremorPower"] > f["normal"]["tremorPower"]
    # Асимметрия: диапазон смещён (одна сторона больше другой по модулю)
    asym = f["asym"]
    assert abs(asym["minAngle"]) != abs(asym["maxAngle"])


# ─── 4. Робастность ─────────────────────────────────────────────────────────
def test_robustness_empty_and_garbage():
    assert extract_features([], "r") == empty_features()
    assert extract_features([{"t": 0, "r": 1}], "r")["valid"] is False  # < 3 точек
    # Мусорные значения оси не должны ронять функцию (Number||0 поведение)
    garbage = [{"t": i * 200, "r": v} for i, v in enumerate(["−", None, "", "x", 1.0])]
    out = extract_features(garbage, "r")
    assert "valid" in out and isinstance(out["rom"], (int, float))


# ─── 5. Golden-регрессия (ловит непреднамеренные изменения формул) ──────────
# Значения зафиксированы на seed-сессиях. Менять ТОЛЬКО осознанно при правке features.py.
GOLDEN = {
    "normal": {"rom": 53.28, "smoothnessIndex": 0.909, "tremorIndex": 0.0, "pauseRatio": 0.058,
               "peakVelocity": 98.69, "tremorPower": 0.0, "tremorFreqHz": 0.0},
    "patho":  {"rom": 37.13, "smoothnessIndex": 0.776, "tremorIndex": 0.363, "pauseRatio": 0.154,
               "peakVelocity": 149.54, "tremorPower": 0.051, "tremorFreqHz": 6.0},
    "asym":   {"rom": 56.68, "minAngle": -32.6, "maxAngle": 24.08, "smoothnessIndex": 0.873},
}


def test_golden_regression():
    sess = _sessions()
    diffs = []
    for name, expected in GOLDEN.items():
        f = extract_features(sess[name], "r")
        for k, exp in expected.items():
            got = float(f[k])
            tol = 0.02 if abs(exp) <= 1 else max(0.5, abs(exp) * 0.01)
            if abs(got - exp) > tol:
                diffs.append((name, k, exp, got))
    assert not diffs, f"Регрессия признаков: {diffs}"


if __name__ == "__main__":
    test_features_valid_and_ranges()
    test_determinism()
    test_discrimination()
    test_robustness_empty_and_garbage()
    test_golden_regression()
    print("OK — все проверки признаков прошли")
