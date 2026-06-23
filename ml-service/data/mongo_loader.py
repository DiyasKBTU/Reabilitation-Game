"""
Загрузчик РЕАЛЬНЫХ сессий устройства из MongoDB для обучения модели аномалий.

Это мост «данные вашего устройства → датасет». Текущее веб-приложение при каждой игре
сохраняет полный сырой ряд IMU (`imu_time_series`) в Mongo, а пациент на экране результата
оценивает самочувствие (`label.pain` 0–2, `label.fatigue` 1–10). Связка «ряд + оценка» даёт
РЕАЛЬНУЮ метку нормы/аномалии — ground truth для обучения (замыкание петли «data flywheel»,
см. docs/INVESTOR_AUDIT.md §5 и docs/ML_SPEC.md §6).

Подключение: `MONGO_URI` из окружения (или localhost). Если Mongo недоступна или pymongo не
установлен — возвращает ПУСТОЙ датасет, не роняя обучение (train.py продолжит на PAMAP2/синтетике).

Только читает, ничего не меняет.
"""
from __future__ import annotations
import os
from typing import Any, Dict, List, Tuple

# Минимум точек ряда, чтобы признаки были осмысленны (= MIN_SAMPLE_COUNT в api/app/ml/validity.py).
MIN_SERIES = 10


def _mongo_uri() -> str:
    return os.environ.get("MONGO_URI", "mongodb://localhost:27017/rehabgame")


def label_from_session(label: Dict[str, Any] | None) -> int | None:
    """Метка нормы(0)/аномалии(1) из оценки пациента. None → метки нет/серая зона (пропустить).

    Правило (консервативное, чтобы не загрязнять обучение неоднозначными случаями):
      - боль >= 1  ИЛИ усталость >= 7        → аномалия (1): есть боль/выраженная усталость;
      - боль == 0  И  усталость <= 4 (или нет)→ норма (0): хорошее самочувствие;
      - иначе (напр. усталость 5–6 без боли)  → None: серая зона, в датасет не берём.
    """
    if not label:
        return None
    pain = label.get("pain")
    fatigue = label.get("fatigue")
    if pain is None and fatigue is None:
        return None
    p = pain if isinstance(pain, (int, float)) else 0
    f = fatigue if isinstance(fatigue, (int, float)) else 0
    if p >= 1 or f >= 7:
        return 1
    if p == 0 and (fatigue is None or f <= 4):
        return 0
    return None  # серая зона — однозначной метки нет


def load_mongo_dataset(axis: str = "r") -> Tuple[List[List[Dict]], List[int], Dict[str, int]]:
    """Реальные размеченные сессии устройства → (series_list, labels, stats).

    Берёт только сессии С сырым рядом (>= MIN_SERIES точек) И с однозначной меткой
    самочувствия. `stats` отражает, сколько вообще есть рядов и сколько из них размечено —
    это честная картина «петли данных» на сегодня.
    """
    stats = {"total_with_series": 0, "labeled": 0, "normal": 0,
             "anomaly": 0, "unlabeled_with_series": 0}

    try:
        from pymongo import MongoClient
    except ImportError:
        print("[mongo_loader] pymongo не установлен — реальные данные пропущены.")
        return [], [], stats

    uri = _mongo_uri()
    db_name = uri.rsplit("/", 1)[-1].split("?")[0] or "rehabgame"
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=3000)
        client.admin.command("ping")  # быстрый фейл, если Mongo выключена
    except Exception as e:
        print(f"[mongo_loader] MongoDB недоступна ({type(e).__name__}) — реальные данные пропущены.")
        return [], [], stats

    series_list: List[List[Dict]] = []
    labels: List[int] = []
    try:
        coll = client[db_name]["sessions"]
        for doc in coll.find({}, {"imu_time_series": 1, "label": 1, "source": 1}):
            ser = doc.get("imu_time_series") or []
            if len(ser) < MIN_SERIES:
                continue
            stats["total_with_series"] += 1
            lbl = label_from_session(doc.get("label"))
            if lbl is None:
                stats["unlabeled_with_series"] += 1
                continue
            series_list.append(ser)
            labels.append(lbl)
            stats["labeled"] += 1
            stats["normal" if lbl == 0 else "anomaly"] += 1
    finally:
        client.close()

    print(f"[mongo_loader] сессий с рядом: {stats['total_with_series']} | "
          f"размечено: {stats['labeled']} (норма {stats['normal']} / аном. {stats['anomaly']}) | "
          f"без метки: {stats['unlabeled_with_series']}")
    return series_list, labels, stats


if __name__ == "__main__":
    s, y, st = load_mongo_dataset()
    print(f"Итог: {len(s)} размеченных сессий, статистика: {st}")
