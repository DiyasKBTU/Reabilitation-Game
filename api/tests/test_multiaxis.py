"""
Тесты оркестратора аномалий по осям (api/app/ml/multiaxis.py).

Изолируют ЛОГИКУ АГРЕГАЦИИ: детектор `detect_anomalies` подменяется заглушкой, возвращающей
заранее заданные пер-осевые вердикты. Так проверяется именно сведение вердиктов (худший статус,
максимум счёта, пометка осей у флагов, выбор ведущей оси), без зависимости от модели/признаков.
"""
import app.ml.multiaxis as mx


def _stub(canned):
    """Заглушка detect_anomalies: маршрутизирует по метке оси в признаках текущей сессии."""
    return lambda cur, hist: dict(canned[cur["__axis__"]])


def test_multi_axis_takes_worst_status(monkeypatch):
    canned = {
        "r": {"status": "normal",   "anomalyScore": 10,
              "flags": [{"metric": "rom", "label": "ROM"}], "baselineSize": 5,
              "mode": "ml", "note": "норма"},
        "p": {"status": "critical", "anomalyScore": 80,
              "flags": [{"metric": "tremorIndex", "label": "Тремор"}], "baselineSize": 5,
              "mode": "ml", "note": "боль/усталость"},
    }
    monkeypatch.setattr(mx, "detect_anomalies", _stub(canned))
    axes = [("r", "Руль"), ("p", "Газ/тормоз")]
    cur = {"r": {"__axis__": "r", "valid": True}, "p": {"__axis__": "p", "valid": True}}
    out = mx.analyze_axes(axes, cur, {"r": [], "p": []})

    o = out["overall"]
    assert o["status"] == "critical"            # худший из осей (pitch)
    assert o["anomalyScore"] == 80              # максимум по осям
    assert o["leadAxis"] == "p"
    assert o["axesAnalyzed"] == ["r", "p"]
    # флаги объединены и помечены осью
    assert {f["axis"] for f in o["flags"]} == {"r", "p"}
    assert all("axisLabel" in f for f in o["flags"])
    # ведущая ось — не основная → её подпись добавлена в note
    assert "Газ/тормоз" in o["note"]
    # пер-осевой разбор сохранён для врача
    assert out["axes"]["p"]["label"] == "Газ/тормоз"
    assert out["axes"]["r"]["anomaly"]["status"] == "normal"


def test_both_normal_lead_is_primary(monkeypatch):
    normal = {"status": "normal", "anomalyScore": 5, "flags": [], "baselineSize": 5,
              "mode": "ml", "note": "норма"}
    monkeypatch.setattr(mx, "detect_anomalies", lambda cur, hist: dict(normal))
    out = mx.analyze_axes([("r", "Руль"), ("p", "Газ")],
                          {"r": {"v": 1}, "p": {"v": 1}}, {"r": [], "p": []})
    assert out["overall"]["status"] == "normal"
    assert out["overall"]["leadAxis"] == "r"     # при равенстве — основная ось


def test_single_axis_passthrough(monkeypatch):
    canned = {"status": "attention", "anomalyScore": 50,
              "flags": [{"metric": "rom", "label": "ROM"}], "baselineSize": 4,
              "mode": "ml", "note": "n"}
    monkeypatch.setattr(mx, "detect_anomalies", lambda cur, hist: dict(canned))
    out = mx.analyze_axes([("r", "Наклон")], {"r": {"v": 1}}, {"r": []})
    assert out["overall"]["status"] == "attention"
    # одноосевая игра → флаги БЕЗ пометки оси, без multi-полей (обратная совместимость)
    assert "axis" not in out["overall"]["flags"][0]
    assert "axesAnalyzed" not in out["overall"]
    assert "leadAxis" not in out["overall"]


def test_no_current_features_is_no_data(monkeypatch):
    monkeypatch.setattr(mx, "detect_anomalies",
                        lambda cur, hist: {"status": "critical", "anomalyScore": 99,
                                           "flags": [], "baselineSize": 0, "mode": "ml", "note": ""})
    out = mx.analyze_axes([("r", "Руль"), ("p", "Газ")], {}, {})
    assert out["overall"]["status"] == "no_data"
    assert out["axes"] == {}
