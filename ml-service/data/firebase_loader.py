"""
Адаптер реальных данных из Firebase Realtime Database (экспорт JSON) → нормализованные
сессии/пациенты Axis.

ВАЖНОЕ ОГРАНИЧЕНИЕ ИСТОЧНИКА (подтверждено на реальном экспорте esp-project-fca3d):
  В экспорте НЕТ сырых временных рядов IMU — только агрегаты по сессии
  (rangeOfMotion, maxAngle, minAngle, movementCount, strengthIndex, enduranceSec)
  и один финальный снимок углов (roll/pitch/yaw). Поэтому признаки, требующие ряда
  (peakVelocity, meanAbsVelocity, meanJerk, smoothnessIndex, tremorIndex, symmetryIndex,
  pauseRatio, repetitions, activeTimeSec), из этого экспорта НЕ вычисляются.
  Чтобы их получить — логировать полный ряд [{t,r,p,y},...] в Firebase/Mongo
  (на устройстве movementCount≈3650 за 63 с ⇒ ~58 Гц поток есть, но не сохраняется).
  См. docs/ML_SPEC.md §5.

Что адаптер делает:
  - читает экспорт (app_patients, rehab_sessions/app_sessions, ai_data);
  - возвращает нормализованных пациентов и сессии;
  - в features кладёт ТОЛЬКО геометрию из агрегатов (rom, minAngle, maxAngle),
    помечая partial=True и перечисляя отсутствующие (series-dependent) признаки;
  - сохраняет device_metrics устройства (strengthIndex, movementCount, enduranceSec, снимок углов).

Запуск:
  venv\\Scripts\\python.exe ml-service\\data\\firebase_loader.py "C:\\путь\\export.json"
"""
from __future__ import annotations
import json
import os
from typing import Dict, Any, List

# Признаки, требующие сырого временного ряда — недоступны из агрегатов Firebase.
SERIES_DEPENDENT = [
    "peakVelocity", "meanAbsVelocity", "meanJerk", "smoothnessIndex",
    "tremorIndex", "symmetryIndex", "pauseRatio", "repetitions", "activeTimeSec",
]


def _num(v, d=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def _session_from_agg(sid: str, s: Dict[str, Any]) -> Dict[str, Any]:
    """Нормализует одну агрегатную сессию Firebase в формат Axis (partial features)."""
    rom = _num(s.get("rangeOfMotion"))
    features = {
        "rom": round(rom, 2),
        "minAngle": round(_num(s.get("minAngle")), 2),
        "maxAngle": round(_num(s.get("maxAngle")), 2),
        "valid": rom > 0,         # сессии game1 в экспорте имеют ROM=0 → невалидны для аналитики
        "partial": True,          # вычислено из агрегатов, а не из ряда
        "missing": SERIES_DEPENDENT,
    }
    return {
        "id": sid,
        "patient_id": s.get("patientId"),
        "doctor_id": s.get("doctorId"),
        "game_type": s.get("gameType"),
        "game_name": s.get("gameName"),
        "score": int(_num(s.get("score"))),
        "duration_sec": _num(s.get("durationSec")),
        "level": int(_num(s.get("level"), 1)),
        "created_at": s.get("createdAt"),
        "source": s.get("source", "firebase"),
        "device_metrics": {
            "movementCount": s.get("movementCount"),
            "strengthIndex": s.get("strengthIndex"),
            "enduranceSec": s.get("enduranceSec"),
            "finalSnapshot": {"roll": s.get("roll"), "pitch": s.get("pitch"), "yaw": s.get("yaw")},
        },
        "features": features,
    }


def load_firebase_export(path: str) -> Dict[str, Any]:
    """Читает JSON-экспорт RTDB → {patients: {...}, sessions: [...]}."""
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)

    patients: Dict[str, Any] = {}
    for pid, p in (data.get("app_patients") or {}).items():
        patients[pid] = {
            "id": pid,
            "full_name": p.get("fullName"),
            "age": p.get("age"),
            "gender": p.get("gender"),
            "diagnosis": p.get("diagnosis") or None,
            "doctor_id": p.get("doctorId"),
            "created_at": p.get("createdAt"),
        }

    # Приоритет rehab_sessions (есть source/mongoSessionId), иначе app_sessions.
    raw_sessions = data.get("rehab_sessions") or data.get("app_sessions") or {}
    sessions: List[Dict[str, Any]] = [_session_from_agg(sid, s) for sid, s in raw_sessions.items()]
    sessions.sort(key=lambda x: x.get("created_at") or "")
    return {"patients": patients, "sessions": sessions}


def summarize(path: str) -> None:
    d = load_firebase_export(path)
    print(f"Пациентов: {len(d['patients'])} | Сессий: {len(d['sessions'])}")
    for p in d["patients"].values():
        print(f"  - {p['full_name']} (age {p['age']}, dx '{p['diagnosis']}')")
    print("\nСессии (из агрегатов Firebase; features.partial=True):")
    print(f"{'game':<7}{'score':>7}{'rom':>8}{'min':>8}{'max':>8}{'dur,s':>7}{'moves':>8}{'valid':>7}")
    for s in d["sessions"]:
        f, dm = s["features"], s["device_metrics"]
        print(f"{(s['game_type'] or '?'):<7}{s['score']:>7}{f['rom']:>8.1f}{f['minAngle']:>8.1f}"
              f"{f['maxAngle']:>8.1f}{s['duration_sec']:>7.0f}{(dm['movementCount'] or 0):>8}"
              f"{str(f['valid']):>7}")
    print("\nНЕ вычислимо из этого экспорта (нужен сырой ряд [{t,r,p,y},...]):")
    print("  " + ", ".join(SERIES_DEPENDENT))


if __name__ == "__main__":
    import sys
    default = os.path.join(os.path.dirname(__file__), "firebase_export.json")
    summarize(sys.argv[1] if len(sys.argv) > 1 else default)
