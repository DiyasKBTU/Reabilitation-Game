"""
Нормализатор экспорта Firebase Realtime Database → структуры Axis для импорта в MongoDB.

Чистый модуль (без I/O и без обращения к БД) — тестируется отдельно (api/tests/).
Чтение файла/URL и запись в Mongo — в api/scripts/import_firebase.py.

ОГРАНИЧЕНИЕ ИСТОЧНИКА (подтверждено на экспорте esp-project-fca3d, см. docs/ML_SPEC.md §5):
  В экспорте НЕТ сырого временного ряда IMU — только агрегаты по сессии
  (rangeOfMotion, maxAngle, minAngle, movementCount, strengthIndex, enduranceSec) и
  один финальный снимок углов. Поэтому здесь вычислимы только геометрические признаки
  rom/minAngle/maxAngle; остальные 9 (требуют ряда) помечаются partial+missing и равны 0.
  Чтобы получить полный вектор из 12 признаков — логировать ряд [{t,r,p,y},...] на устройстве.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Optional, Tuple

SOURCE = "firebase"

# Признаки, требующие сырого временного ряда — недоступны из агрегатов Firebase.
SERIES_DEPENDENT = [
    "peakVelocity", "meanAbsVelocity", "meanJerk", "smoothnessIndex",
    "tremorIndex", "symmetryIndex", "pauseRatio", "repetitions", "activeTimeSec",
]

# Имена игр по game_type (как в остальной системе).
GAME_NAMES = {"game1": "Space Catcher", "game2": "City Driver"}

# Ключи-маркеры: их наличие в словаре означает, что это сессия (а не {sid: сессия}).
_SESSION_MARKERS = ("gameType", "game_type", "rangeOfMotion", "score", "durationSec")


def _num(v: Any, d: float = 0.0) -> float:
    """Робастное приведение к float (как Number(x)||d в JS). Мусор → d."""
    try:
        f = float(v)
        return f if f == f and f not in (float("inf"), float("-inf")) else d
    except (TypeError, ValueError):
        return d


def _is_session(d: Any) -> bool:
    return isinstance(d, dict) and any(k in d for k in _SESSION_MARKERS)


def parse_created_at(v: Any) -> datetime:
    """createdAt из Firebase → datetime (UTC). Поддерживает ISO-строку и epoch (сек/мс)."""
    if isinstance(v, bool):
        return datetime.now(timezone.utc)
    if isinstance(v, (int, float)):
        ts = float(v)
        if ts > 1e12:          # эвристика: > 1e12 → миллисекунды
            ts /= 1000.0
        try:
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return datetime.now(timezone.utc)
    if isinstance(v, str) and v.strip():
        s = v.strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(s)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def partial_features_from_aggregates(agg: Dict[str, Any]) -> Dict[str, Any]:
    """Полный словарь признаков по агрегатам Firebase.

    Геометрия (rom/minAngle/maxAngle) — реальная; признаки, требующие сырого ряда,
    равны 0 и перечислены в `missing`; partial=True помечает источник.
    valid=False, если ROM=0 (напр., сессии game1 в экспорте не пишут угол → невалидны).
    Форма совместима с docs/ML_CONTRACT.md §1 (+ partial/missing).
    """
    rom = _num(agg.get("rangeOfMotion"))
    return {
        "sampleCount": 0,
        "durationSec": round(_num(agg.get("durationSec")), 1),
        "rom": round(rom, 2),
        "minAngle": round(_num(agg.get("minAngle")), 2),
        "maxAngle": round(_num(agg.get("maxAngle")), 2),
        "meanAbsVelocity": 0.0,
        "peakVelocity": 0.0,
        "meanJerk": 0.0,
        "smoothnessIndex": 0.0,
        "tremorIndex": 0.0,
        "symmetryIndex": 0.0,
        "pauseRatio": 0.0,
        "repetitions": 0,
        "activeTimeSec": 0.0,
        "valid": rom > 0,
        "partial": True,
        "missing": list(SERIES_DEPENDENT),
    }


def normalize_patient(pid: str, p: Dict[str, Any]) -> Dict[str, Any]:
    """app_patients/{pid} → нормализованный пациент (поля модели Patient + провенанс)."""
    raw_age = p.get("age")
    try:
        age = int(raw_age) if raw_age is not None and str(raw_age).strip() != "" else None
    except (TypeError, ValueError):
        age = None
    return {
        "source": SOURCE,
        "source_id": pid,
        "full_name": p.get("fullName") or p.get("name") or f"Пациент {pid[:6]}",
        "diagnosis": (p.get("diagnosis") or None),
        "age": age,
        "gender": p.get("gender"),
        "doctor_source_id": p.get("doctorId"),
        "created_at": parse_created_at(p.get("createdAt")),
    }


def normalize_session(sid: str, s: Dict[str, Any]) -> Dict[str, Any]:
    """Одна агрегатная сессия Firebase → нормализованная сессия (partial features)."""
    game_type = s.get("gameType") or s.get("game_type") or "game1"
    return {
        "source": SOURCE,
        "source_id": sid,
        "patient_source_id": s.get("patientId") or s.get("patient_id"),
        "doctor_source_id": s.get("doctorId"),
        "game_type": game_type,
        "game_name": s.get("gameName") or GAME_NAMES.get(game_type, "Axis"),
        "score": int(_num(s.get("score"))),
        "duration_sec": _num(s.get("durationSec")),
        "level": int(_num(s.get("level"), 1)),
        "features": partial_features_from_aggregates(s),
        "device_metrics": {
            "movementCount": s.get("movementCount"),
            "strengthIndex": s.get("strengthIndex"),
            "enduranceSec": s.get("enduranceSec"),
            "finalSnapshot": {"roll": s.get("roll"), "pitch": s.get("pitch"), "yaw": s.get("yaw")},
        },
        "created_at": parse_created_at(s.get("createdAt")),
    }


def _iter_sessions(raw: Dict[str, Any]) -> Iterator[Tuple[str, Dict[str, Any], Optional[str]]]:
    """Перебирает сессии в плоской ({sid: сессия}) ИЛИ вложенной ({pid: {sid: сессия}}) карте.

    Возвращает (sid, session, outer_pid|None). outer_pid задан только для вложенной формы
    (rehab_sessions_by_patient) — он подставляется как patient_source_id, если в самой
    сессии его нет.
    """
    for key, val in (raw or {}).items():
        if not isinstance(val, dict):
            continue
        if _is_session(val):
            yield key, val, None
        else:  # вложенная карта {pid: {sid: сессия}}
            for inner_sid, inner_s in val.items():
                if _is_session(inner_s):
                    yield inner_sid, inner_s, key


def normalize_export(data: Dict[str, Any]) -> Dict[str, Any]:
    """RTDB-экспорт (или ответ REST `<db>/.json`) → {patients: {pid: {...}}, sessions: [...]}.

    Источник сессий по приоритету: rehab_sessions → rehab_sessions_by_patient → app_sessions.
    Если корень — это сам узел (без обёрток), пытаемся интерпретировать его как сессии.
    """
    data = data or {}

    patients: Dict[str, Any] = {}
    for pid, p in (data.get("app_patients") or {}).items():
        if isinstance(p, dict):
            patients[pid] = normalize_patient(pid, p)

    raw = (data.get("rehab_sessions")
           or data.get("rehab_sessions_by_patient")
           or data.get("app_sessions")
           or {})

    sessions: List[Dict[str, Any]] = []
    for sid, s, outer_pid in _iter_sessions(raw):
        sess = normalize_session(sid, s)
        if outer_pid and not sess["patient_source_id"]:
            sess["patient_source_id"] = outer_pid
        sessions.append(sess)

    sessions.sort(key=lambda x: x["created_at"])
    return {"patients": patients, "sessions": sessions}
