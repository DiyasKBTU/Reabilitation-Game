"""
CLI: импорт пациентов/сессий из Firebase Realtime Database в MongoDB RehabGame.

Источник — JSON-экспорт RTDB ИЛИ live-URL базы (REST: `<db>/.json`). Формат одинаков.
Импорт идемпотентен: повторный запуск того же экспорта не плодит дубли (ключ source+source_id).

ВАЖНО (см. docs/ML_SPEC.md §5): в экспорте только агрегаты, без сырого ряда IMU →
импортированные сессии получают ЧАСТИЧНЫЕ признаки (rom/minAngle/maxAngle), partial=True.
ML по ним работает в rule-режиме (z-score по ROM). Полный вектор из 12 признаков появится,
когда устройство/веб-клиент начнёт логировать ряд [{t,r,p,y},...] (см. CHANGELOG/ML_SPEC).

Запуск (из корня репозитория, venv):
  # из файла-экспорта:
  venv\\Scripts\\python.exe api\\scripts\\import_firebase.py path\\to\\export.json
  # из live-базы по URL (можно добавить ?auth=TOKEN, если правила закрыты):
  venv\\Scripts\\python.exe api\\scripts\\import_firebase.py https://<db>.firebaseio.com/.json
  # предпросмотр без записи в БД:
  venv\\Scripts\\python.exe api\\scripts\\import_firebase.py export.json --dry-run
  # привязать импортированных пациентов к врачу (его MongoDB id):
  venv\\Scripts\\python.exe api\\scripts\\import_firebase.py export.json --doctor-id <ObjectId>

Требует запущенной MongoDB (кроме --dry-run). Строка подключения — из api/.env (MONGO_URI).
"""
from __future__ import annotations
import argparse
import asyncio
import json
import sys
import urllib.request
from pathlib import Path

# Делаем пакет `app` импортируемым при прямом запуске скрипта.
_API_DIR = Path(__file__).resolve().parents[1]   # .../api
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))

from app.ingest.firebase import normalize_export  # noqa: E402


def _ensure_utf8_stdout() -> None:
    """Печать кириллицы в Windows-консоли (cp1251) иначе падает. Переключаем на utf-8."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass


def _load_raw(src: str) -> dict:
    """Читает JSON из локального файла или по http(s)-URL (RTDB REST)."""
    # utf-8-sig снимает BOM, если он есть (частый случай у файлов, сохранённых на Windows),
    # и работает как обычный utf-8, если BOM отсутствует.
    if src.startswith(("http://", "https://")):
        with urllib.request.urlopen(src, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8-sig"))
    path = Path(src)
    if not path.exists():
        raise FileNotFoundError(f"Файл не найден: {path}")
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _print_preview(norm: dict) -> None:
    patients, sessions = norm["patients"], norm["sessions"]
    print(f"Пациентов: {len(patients)} | Сессий: {len(sessions)}")
    for p in patients.values():
        print(f"  - {p['full_name']} (age {p['age']}, dx '{p['diagnosis']}') [fb:{p['source_id']}]")
    print(f"\n{'game':<7}{'score':>7}{'rom':>8}{'min':>8}{'max':>8}{'dur,s':>7}{'valid':>7}  patient")
    for s in sessions:
        f = s["features"]
        print(f"{s['game_type']:<7}{s['score']:>7}{f['rom']:>8.1f}{f['minAngle']:>8.1f}"
              f"{f['maxAngle']:>8.1f}{s['duration_sec']:>7.0f}{str(f['valid']):>7}  "
              f"{s['patient_source_id']}")
    n_valid = sum(1 for s in sessions if s["features"]["valid"])
    print(f"\nВалидных сессий (ROM>0): {n_valid}/{len(sessions)}. "
          "Признаки частичные (partial=True): нет сырого ряда IMU → ML в rule-режиме (по ROM).")


async def _import(norm: dict, doctor_oid) -> None:
    from app.database import connect_db, close_db
    from app.models.patient import Patient
    from app.models.session import Session
    from app.models.score import Score

    await connect_db()
    try:
        # ── Пациенты (идемпотентно по source+source_id) ──────────────────────
        pid_map: dict = {}
        n_pat_new = n_pat_skip = n_pat_bound = 0
        for fb_pid, p in norm["patients"].items():
            existing = await Patient.find_one(
                Patient.source == "firebase", Patient.source_id == fb_pid
            )
            if existing:
                pid_map[fb_pid] = existing.id
                # Привязать к врачу постфактум: при --doctor-id обновляем существующего
                # пациента (его могли импортировать раньше, когда аккаунта врача ещё не было).
                if doctor_oid is not None and existing.doctor_id != doctor_oid:
                    await existing.set({"doctor_id": doctor_oid})
                    n_pat_bound += 1
                else:
                    n_pat_skip += 1
                continue
            patient = Patient(
                full_name=p["full_name"], diagnosis=p["diagnosis"], age=p["age"],
                gender=p["gender"], doctor_id=doctor_oid,
                source="firebase", source_id=fb_pid, created_at=p["created_at"],
            )
            await patient.insert()
            pid_map[fb_pid] = patient.id
            n_pat_new += 1

        # ── Сессии (идемпотентно по source+source_id) ────────────────────────
        n_sess_new = n_sess_skip = n_sess_orphan = 0
        for s in norm["sessions"]:
            if await Session.find_one(
                Session.source == "firebase", Session.source_id == s["source_id"]
            ):
                n_sess_skip += 1
                continue

            fb_pid = s["patient_source_id"]
            patient_oid = pid_map.get(fb_pid)
            if patient_oid is None:
                # Сессия ссылается на пациента, которого нет в app_patients →
                # создаём пациента-плейсхолдер (чтобы данные не потерялись).
                if not fb_pid:
                    n_sess_orphan += 1
                    continue
                placeholder = Patient(
                    full_name=f"Пациент {str(fb_pid)[:6]}", doctor_id=doctor_oid,
                    source="firebase", source_id=str(fb_pid),
                )
                await placeholder.insert()
                pid_map[fb_pid] = placeholder.id
                patient_oid = placeholder.id

            session = Session(
                patient_id=patient_oid, doctor_id=doctor_oid,
                game_type=s["game_type"], game_name=s["game_name"],
                score=s["score"], duration_sec=s["duration_sec"], level=s["level"],
                imu_time_series=[], features=s["features"],
                device_metrics=s["device_metrics"],
                source="firebase", source_id=s["source_id"], created_at=s["created_at"],
            )
            await session.insert()
            await Score(
                patient_id=patient_oid,
                username=(norm["patients"].get(fb_pid, {}).get("full_name") or "firebase"),
                game_type=s["game_type"], score=s["score"], created_at=s["created_at"],
            ).insert()
            n_sess_new += 1

        print(f"\nПациенты: +{n_pat_new} новых, {n_pat_skip} уже были"
              + (f", {n_pat_bound} привязано к врачу." if n_pat_bound else "."))
        print(f"Сессии:   +{n_sess_new} новых, {n_sess_skip} уже были"
              + (f", {n_sess_orphan} без пациента (пропущены)." if n_sess_orphan else "."))
        print("Готово. Импортированные пациенты видны в дашборде (врач — своих, admin — всех).")
    finally:
        await close_db()


def main() -> None:
    _ensure_utf8_stdout()
    ap = argparse.ArgumentParser(description="Импорт Firebase RTDB → MongoDB RehabGame")
    ap.add_argument("source", help="путь к JSON-экспорту ИЛИ URL базы (<db>.firebaseio.com/.json)")
    ap.add_argument("--dry-run", action="store_true", help="только предпросмотр, без записи в БД")
    ap.add_argument("--doctor-id", default=None, help="MongoDB id врача для привязки пациентов")
    args = ap.parse_args()

    doctor_oid = None
    if args.doctor_id:
        from beanie import PydanticObjectId
        try:
            doctor_oid = PydanticObjectId(args.doctor_id)
        except Exception:
            print(f"[ОШИБКА] Неверный --doctor-id (ожидается MongoDB ObjectId): {args.doctor_id}")
            sys.exit(1)

    try:
        raw = _load_raw(args.source)
    except Exception as e:
        print(f"[ОШИБКА] Не удалось прочитать источник: {e}")
        sys.exit(1)

    norm = normalize_export(raw)
    _print_preview(norm)

    if args.dry_run:
        print("\n--dry-run: запись в БД пропущена.")
        return
    if not norm["sessions"] and not norm["patients"]:
        print("\nНечего импортировать.")
        return

    asyncio.run(_import(norm, doctor_oid))


if __name__ == "__main__":
    main()
