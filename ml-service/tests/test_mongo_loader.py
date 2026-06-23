"""
Тесты моста «данные устройства → датасет» (ml-service/data/mongo_loader.py).

Offline: проверяют чистую логику метки самочувствия и что при недоступной MongoDB загрузчик
возвращает пустой датасет, не роняя обучение. Реальный запрос к Mongo здесь НЕ выполняется.
"""
import os
import sys

# Корень ml-service в путь, чтобы импортировать пакет `data`.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from data.mongo_loader import label_from_session, load_mongo_dataset  # noqa: E402


def test_label_pain_is_anomaly():
    assert label_from_session({"pain": 2}) == 1
    assert label_from_session({"pain": 1, "fatigue": 3}) == 1


def test_label_high_fatigue_is_anomaly():
    assert label_from_session({"fatigue": 8}) == 1
    assert label_from_session({"pain": 0, "fatigue": 7}) == 1


def test_label_good_wellbeing_is_normal():
    assert label_from_session({"pain": 0, "fatigue": 2}) == 0
    assert label_from_session({"pain": 0}) == 0


def test_label_missing_or_grey_zone_is_none():
    assert label_from_session(None) is None
    assert label_from_session({}) is None
    # усталость 5–6 без боли — серая зона, однозначной метки нет
    assert label_from_session({"pain": 0, "fatigue": 6}) is None


def test_mongo_unavailable_returns_empty_gracefully():
    """MongoDB выключена/недоступна → пустой датасет, без исключения (обучение продолжится)."""
    os.environ["MONGO_URI"] = "mongodb://127.0.0.1:1/none"  # заведомо недоступный порт
    series, labels, stats = load_mongo_dataset()
    assert series == []
    assert labels == []
    assert {"total_with_series", "labeled", "normal", "anomaly"} <= set(stats)
