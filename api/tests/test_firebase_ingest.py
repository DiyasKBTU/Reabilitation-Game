"""
Тесты импорта Firebase → Axis (без БД).

Покрывают:
  1. Нормализацию экспорта RTDB (пациенты, сессии, частичные признаки, провенанс).
  2. Корректную деградацию ML на частичных признаках (rule-режим, без краша),
     т.е. что данные Firebase «уходят в ML» предсказуемо.

Фикстура повторяет реальную схему экспорта esp-project-fca3d (см. docs/ML_SPEC.md §5):
  1 пациент, 2 валидные сессии game2 + 1 невалидная game1 (ROM=0).
"""
import pytest

from app.ingest.firebase import (
    normalize_export,
    partial_features_from_aggregates,
    parse_created_at,
    SERIES_DEPENDENT,
)
from app.ml.anomaly import detect_anomalies
from app.ml.recommendations import build_recommendations
from app.ml.narrative import build_narrative


FIXTURE = {
    "app_patients": {
        "p_serjan": {
            "fullName": "Serjan", "age": 20, "gender": "m",
            "diagnosis": "", "doctorId": "doc_fb_1",
            "createdAt": "2026-06-01T10:00:00Z",
        }
    },
    "rehab_sessions": {
        "s1": {
            "patientId": "p_serjan", "doctorId": "doc_fb_1",
            "gameType": "game2", "gameName": "City Driver",
            "rangeOfMotion": 73.6, "minAngle": -39.9, "maxAngle": 33.7,
            "movementCount": 3650, "strengthIndex": 0.82, "enduranceSec": 60,
            "score": 1450, "durationSec": 63, "level": 2,
            "roll": 5.0, "pitch": 1.0, "yaw": 2.0,
            "createdAt": 1717238400000,   # epoch ms
        },
        "s2": {
            "patientId": "p_serjan", "gameType": "game2",
            "rangeOfMotion": 60.3, "minAngle": -28.6, "maxAngle": 31.7,
            "movementCount": 875, "score": 484, "durationSec": 320, "level": 1,
            "createdAt": "2026-06-03T09:00:00Z",
        },
        "s3": {  # Space Catcher в проде писал ROM=0 → невалидна для аналитики
            "patientId": "p_serjan", "gameType": "game1",
            "rangeOfMotion": 0, "minAngle": 0, "maxAngle": 0,
            "movementCount": 0, "score": 3, "durationSec": 14,
            "createdAt": "2026-06-05T09:00:00Z",
        },
    },
}


def test_normalize_counts_and_patient():
    norm = normalize_export(FIXTURE)
    assert len(norm["patients"]) == 1
    assert len(norm["sessions"]) == 3

    p = norm["patients"]["p_serjan"]
    assert p["full_name"] == "Serjan"
    assert p["age"] == 20 and isinstance(p["age"], int)
    assert p["source"] == "firebase" and p["source_id"] == "p_serjan"
    assert p["diagnosis"] is None          # пустая строка → None
    assert p["doctor_source_id"] == "doc_fb_1"


def test_partial_features_geometry_and_flags():
    feats = partial_features_from_aggregates(FIXTURE["rehab_sessions"]["s1"])
    assert feats["rom"] == 73.6
    assert feats["minAngle"] == -39.9 and feats["maxAngle"] == 33.7
    assert feats["valid"] is True
    assert feats["partial"] is True
    assert feats["missing"] == SERIES_DEPENDENT
    # Все признаки, требующие сырого ряда, занулены (их нельзя посчитать из агрегатов).
    for k in SERIES_DEPENDENT:
        assert feats[k] == 0 or feats[k] == 0.0


def test_invalid_session_marked():
    norm = normalize_export(FIXTURE)
    by_id = {s["source_id"]: s for s in norm["sessions"]}
    assert by_id["s3"]["features"]["valid"] is False      # ROM=0
    assert by_id["s1"]["features"]["valid"] is True
    # провенанс и привязка к пациенту
    assert by_id["s1"]["patient_source_id"] == "p_serjan"
    assert by_id["s1"]["source"] == "firebase"


def test_device_metrics_preserved():
    norm = normalize_export(FIXTURE)
    s1 = next(s for s in norm["sessions"] if s["source_id"] == "s1")
    dm = s1["device_metrics"]
    assert dm["movementCount"] == 3650
    assert dm["strengthIndex"] == 0.82
    assert dm["enduranceSec"] == 60
    assert dm["finalSnapshot"] == {"roll": 5.0, "pitch": 1.0, "yaw": 2.0}


def test_sessions_sorted_by_created_at():
    norm = normalize_export(FIXTURE)
    times = [s["created_at"] for s in norm["sessions"]]
    assert times == sorted(times)


def test_parse_created_at_variants():
    assert parse_created_at("2026-06-01T10:00:00Z").year == 2026
    assert parse_created_at(1717238400000).year == 2024       # epoch ms
    # мусор → текущее время (не падает)
    assert parse_created_at(None) is not None
    assert parse_created_at("не дата") is not None


def test_nested_by_patient_shape():
    """rehab_sessions_by_patient: {pid: {sid: сессия}} — тоже разворачивается."""
    nested = {
        "rehab_sessions_by_patient": {
            "p_x": {
                "sX": {"gameType": "game2", "rangeOfMotion": 40.0,
                       "minAngle": -20.0, "maxAngle": 20.0, "score": 100,
                       "durationSec": 30}
            }
        }
    }
    norm = normalize_export(nested)
    assert len(norm["sessions"]) == 1
    s = norm["sessions"][0]
    assert s["source_id"] == "sX"
    assert s["patient_source_id"] == "p_x"   # взят из внешнего ключа


# ── ML на частичных признаках: должен деградировать в rule-режим без краша ──────

def test_anomaly_forces_rule_mode_on_partial():
    feats = partial_features_from_aggregates(FIXTURE["rehab_sessions"]["s1"])
    # история < MIN_BASELINE → insufficient_baseline, но главное — режим rule, не ml.
    res = detect_anomalies(feats, history=[])
    assert res["mode"] == "rule"
    assert res.get("partial") is True
    assert "ROM" in res["note"]


def test_anomaly_rule_flags_rom_drop_on_partial():
    """С достаточной историей по ROM детектор ловит падение амплитуды (на частичных данных)."""
    # Личная норма с разбросом (нужна ненулевая дисперсия для z-score).
    rom_history = [68.0, 72.0, 70.0, 71.0, 69.0]
    history = [{"rom": r, "minAngle": -r / 2, "maxAngle": r / 2,
                "valid": True, "partial": True} for r in rom_history]
    current = partial_features_from_aggregates(
        {"rangeOfMotion": 30.0, "minAngle": -15.0, "maxAngle": 15.0, "durationSec": 60}
    )
    res = detect_anomalies(current, history)
    assert res["mode"] == "rule"
    assert any(fl["metric"] == "rom" for fl in res["flags"])   # падение ROM отмечено


def test_recommendations_session_plan_safe_on_partial():
    feats = partial_features_from_aggregates(FIXTURE["rehab_sessions"]["s1"])
    anomaly = detect_anomalies(feats, history=[])
    rec = build_recommendations(feats, history=[], anomaly=anomaly, trends={})
    plan = rec["sessionPlan"]
    # smoothness=0 НЕ должен ложно тянуть в "decrease"/"качество>очков" на частичных данных
    assert plan["levelAdvice"] == "hold"
    assert plan["emphasizeQualityOverScore"] is False


def test_narrative_hides_unmeasured_metrics_on_partial():
    """Шаблонное заключение не должно сообщать ложные «плавность 0% / тремор 0%» на частичных данных."""
    feats = partial_features_from_aggregates(FIXTURE["rehab_sessions"]["s1"])
    nar = build_narrative(feats, anomaly={"status": "normal"}, recommendations={}, trends={})
    assert nar["source"] == "template"        # LLM по умолчанию выключен
    assert "ROM" in nar["text"]
    assert "плавность" not in nar["text"]      # не измерено → не упоминаем
    assert "тремор" not in nar["text"]
    assert "сыр" in nar["text"].lower()        # есть пометка, что сырой ряд не записан


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
