"""
Загрузчик реального датасета движений запястья для обучения модели.

ИСТОЧНИК: Smartwatch IMU Dataset for Upper-Limb Movement Analysis (Mendeley Data)
  - DOI: 10.17632/s86tdtmcc2.1   |   Лицензия: CC BY 4.0
  - Apple Watch Series 6 на обоих запястьях, 3 взрослых (u01, u04, u05;
    у одного — лёгкая слабость левой руки).
  - 3 движения: сгибание/разгибание локтя (el-exfl), плеча (sh-exfl),
    пронация/супинация запястья (wr-prsu).
  - Сырьё (1 - raw/): объединённые CSV all_users_{train,valid,test}.csv, 100 Гц.

ФОРМАТ СЫРЫХ CSV (реальные колонки):
  DMRoll / DMPitch / DMYaw  — Euler-углы CoreMotion, РАДИАНЫ → наши оси r/p/y (в градусах)
  TimeStamp                 — время в секундах (шаг 0.01 → 100 Гц)
  UID, SessionID, MoveType, Wrist, Side — метаданные; ключ сессии = их комбинация

ЧТО ДЕЛАЕМ:
  - Группируем строки в сессии по (UID, SessionID, MoveType, Wrist).
  - Даунсэмпл 100 Гц → ~25 Гц (как у нашего устройства), радианы → градусы.
  - Это HAR-датасет (распознавание движений), без меток нормы/аномалии → все label=0
    (реальные сигналы НОРМЫ: живой шум датчика, настоящая моторика).

ВЫБОР ОСИ (важно): roll и yaw в CoreMotion лежат в [-π,π] и «оборачиваются» (+π → -π),
давая ложные скачки 360° (ROM раздувается до сотен градусов; np.unwrap на шумной границе
«разгоняется» до тысяч). PITCH ∈ [-π/2, π/2] НЕ оборачивается и даёт физичный диапазон
(локоть ~64°, плечо ~104°, запястье ~80°). Поэтому основная ось движения `r` = DMPitch.
roll/yaw кладём в p/y «как есть» (могут содержать обороты) — признаки их не используют.

ПУТЬ К ДАННЫМ:
  Ищется автоматически: сначала ml-service/data/mendeley/, затем папка
  «Smartwatch-IMU-UpperLimb-Dataset» где-либо под корнем проекта.
"""

from __future__ import annotations
import csv
import glob
import os
from typing import List, Tuple, Dict, Any

_DATA_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.abspath(os.path.join(_DATA_DIR, "..", ".."))
_MENDELEY_DIR = os.path.join(_DATA_DIR, "mendeley")

# Целевая частота после даунсэмпла (Гц) — близко к устройству пациента.
_TARGET_HZ = 25.0
_SOURCE_HZ = 100.0
_DOWNSAMPLE = int(round(_SOURCE_HZ / _TARGET_HZ))  # 4

# Имена колонок реального датасета.
_C_ROLL, _C_PITCH, _C_YAW = "DMRoll", "DMPitch", "DMYaw"
_C_TS = "TimeStamp"
_C_KEY = ("UID", "SessionID", "MoveType", "Wrist")

_RAD2DEG = 57.29577951308232


def _find_raw_csvs() -> List[str]:
    """Находит сырые CSV (all_users_*.csv) в известных местах."""
    candidates: List[str] = []
    # 1) канонический путь
    candidates += glob.glob(os.path.join(_MENDELEY_DIR, "**", "all_users_*.csv"), recursive=True)
    # 2) распакованная папка датасета где-либо под корнем проекта
    if not candidates:
        candidates += glob.glob(
            os.path.join(_PROJECT_ROOT, "**", "Smartwatch-IMU-UpperLimb-Dataset", "**",
                         "all_users_*.csv"),
            recursive=True)
    # 3) последний шанс: любой all_users_*.csv под корнем
    if not candidates:
        candidates += glob.glob(os.path.join(_PROJECT_ROOT, "**", "all_users_*.csv"),
                                recursive=True)
    # Только сырьё (папка «1 - raw» / «raw»), не processed/features.
    raw = [p for p in candidates
           if "raw" in p.lower() and "processed" not in p.lower() and "feature" not in p.lower()]
    return sorted(set(raw or candidates))


def load_mendeley_dataset() -> Tuple[List[List[Dict]], List[int], Dict[str, Any]]:
    """
    Возвращает (series_list, labels, stats):
      series_list — список imuTimeSeries [{t,r,p,y}] (по одной на сессию, ~25 Гц)
      labels      — 0 для всех (реальные сигналы нормы; HAR-датасет без меток аномалий)
      stats       — {found_files, sessions, normal, anomaly, users, note}
    """
    stats = {"found_files": 0, "sessions": 0, "normal": 0, "anomaly": 0,
             "users": [], "note": ""}
    files = _find_raw_csvs()
    stats["found_files"] = len(files)
    if not files:
        stats["note"] = ("Сырые CSV (all_users_*.csv) не найдены. Скачайте датасет "
                         "(https://data.mendeley.com/datasets/s86tdtmcc2) → распакуйте "
                         f"в {_MENDELEY_DIR} или под корень проекта.")
        return [], [], stats

    # Группируем строки в сессии по ключу. Копим только нужные колонки (память).
    sessions: Dict[tuple, List[Tuple[float, float, float, float]]] = {}
    users = set()
    for path in files:
        with open(path, "r", encoding="utf-8-sig", newline="") as fh:
            reader = csv.DictReader(fh)
            if reader.fieldnames is None or _C_ROLL not in reader.fieldnames:
                continue
            for row in reader:
                key = tuple(row.get(c, "").strip() for c in _C_KEY)
                try:
                    ts = float(row[_C_TS])
                    r = float(row[_C_ROLL]); p = float(row[_C_PITCH]); y = float(row[_C_YAW])
                except (ValueError, KeyError, TypeError):
                    continue
                sessions.setdefault(key, []).append((ts, r, p, y))
                users.add(key[0])

    series_list: List[List[Dict]] = []
    labels: List[int] = []
    uids_per_session: List[str] = []   # UID пациента для каждой сессии (для per-patient baseline)
    movetype_per_session: List[str] = []   # тип движения (для baseline по однотипным упражнениям)
    for key, rows in sessions.items():
        rows.sort(key=lambda x: x[0])           # по времени
        if len(rows) < 20 * _DOWNSAMPLE:
            continue
        # Основная ось `r` = PITCH (чистая, без оборотов). roll/yaw → p/y «как есть».
        # Даунсэмпл 100 → ~25 Гц. rows: (ts, roll, pitch, yaw).
        ts = [x[0] for x in rows][::_DOWNSAMPLE]
        roll = [x[1] for x in rows][::_DOWNSAMPLE]
        pitch = [x[2] for x in rows][::_DOWNSAMPLE]
        yaw = [x[3] for x in rows][::_DOWNSAMPLE]
        t0 = ts[0]
        series = [
            {"t": round((ts[k] - t0) * 1000.0, 1),    # с → мс от начала
             "r": round(pitch[k] * _RAD2DEG, 3),      # PITCH → основная ось движения
             "p": round(roll[k] * _RAD2DEG, 3),
             "y": round(yaw[k] * _RAD2DEG, 3)}
            for k in range(len(ts))
        ]
        series_list.append(series)
        labels.append(0)
        uids_per_session.append(key[0])         # key = (UID, SessionID, MoveType, Wrist)
        movetype_per_session.append(key[2])

    stats["uids_per_session"] = uids_per_session
    stats["movetype_per_session"] = movetype_per_session
    stats["sessions"] = len(series_list)
    stats["normal"] = len(series_list)
    stats["anomaly"] = 0
    stats["users"] = sorted(users)
    if not series_list:
        stats["note"] = "CSV найдены, но не удалось собрать сессии (проверьте формат колонок)."
    return series_list, labels, stats


if __name__ == "__main__":
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass
    series, labels, stats = load_mendeley_dataset()
    print("Mendeley loader — проверка")
    print(f"  Найдено файлов:    {stats['found_files']}")
    print(f"  Сессий собрано:    {stats['sessions']}  (норма={stats['normal']})")
    print(f"  Участники:         {stats['users']}")
    if stats["note"]:
        print(f"  Заметка: {stats['note']}")
    if series:
        s = series[0]
        durs = [(len(x), x[-1]['t'] / 1000.0) for x in series[:5]]
        print(f"  Пример (первые 5): точек/длительность(с) = {durs}")
        print(f"  Первые 2 точки:    {s[:2]}")
