"""
CLI: засев ТЕСТОВЫХ данных (дети с ДЦП) в MongoDB для разработки и тестирования.

Создаёт связную структуру с удобными учётками:
  - 1 администратор;
  - 3 врача, у каждого 3–4 прикреплённых пациента-ребёнка с ДЦП и сессиями;
  - у одного пациента каждого врача есть собственная учётка для входа (играть самому).

Отличие от демо-режима (`DEMO_MODE` + `app/demo/seed.py`):
  - запускается ВРУЧНУЮ, а не на старте API;
  - всё помечено `source="test"` — легко удалить (`--reset`);
  - предсказуемые логины/пароли (печатаются в конце).

Логика ролей (важно): публично регистрируется ТОЛЬКО пациент и БЕЗ выбора врача — пациент не
может сам прикрепиться к врачу. Врач прикрепляет пациента к себе сам. Поэтому врачи и админ
заводятся этим скриптом (или администратором), а не публичной регистрацией.

Запуск (из корня репозитория, venv), требует запущенной MongoDB (MONGO_URI из api/.env):
  venv\\Scripts\\python.exe api\\scripts\\seed_test_data.py                 # засеять (идемпотентно)
  venv\\Scripts\\python.exe api\\scripts\\seed_test_data.py --reset         # пересоздать тест-данные
  venv\\Scripts\\python.exe api\\scripts\\seed_test_data.py --clear-demo    # ещё и стереть демо-данные
"""
from __future__ import annotations
import argparse
import asyncio
import random
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Делаем пакет `app` импортируемым при прямом запуске скрипта.
_API_DIR = Path(__file__).resolve().parents[1]   # .../api
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))

# Переиспользуем автономный генератор IMU-ряда и профили ДЦП из демо-сида — без дублирования
# клинической логики. Засев тестовых данных при этом полностью независим (свои учётки, source).
from app.demo.seed import _make_series, _params_for  # noqa: E402
from app.ml.features import extract_features          # noqa: E402
from app.ml.validity import mark_validity             # noqa: E402

# ─── Удобные учётные данные (печатаются в конце) ─────────────────────────────
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin1234"
DOCTOR_PASSWORD = "doctor1234"
PATIENT_PASSWORD = "patient1234"

# Врачи и их пациенты. account="patientN" → у пациента есть учётка для входа (играть самому);
# остальные пациенты — карточки без учётки (врач просто наблюдает). Формы ДЦП дают на дашборде
# разные ML-вердикты (норма / внимание / критично).
DOCTORS = [
    {
        "username": "doctor1", "full_name": "Жанна Абаева",
        "patients": [
            {"full_name": "Алмас Сериков", "age": 8, "gender": "м",
             "diagnosis": "ДЦП, спастическая диплегия, лёгкая форма",
             "profile": "dcp_mild_progress", "n": 12, "account": "patient1"},
            {"full_name": "Дария Нурлан", "age": 7, "gender": "ж",
             "diagnosis": "ДЦП, спастический правосторонний гемипарез",
             "profile": "dcp_spastic_hemi", "n": 13},
            {"full_name": "Тимур Ахметов", "age": 9, "gender": "м",
             "diagnosis": "ДЦП, дискинетическая (гиперкинетическая) форма",
             "profile": "dcp_dyskinetic", "n": 12},
            {"full_name": "Аружан Касым", "age": 6, "gender": "ж",
             "diagnosis": "ДЦП, атаксическая форма",
             "profile": "dcp_ataxic", "n": 11},
        ],
    },
    {
        "username": "doctor2", "full_name": "Марат Сейтов",
        "patients": [
            {"full_name": "Санжар Болат", "age": 10, "gender": "м",
             "diagnosis": "ДЦП, спастическая диплегия",
             "profile": "dcp_mild_progress", "n": 12, "account": "patient2"},
            {"full_name": "Камила Ерлан", "age": 7, "gender": "ж",
             "diagnosis": "ДЦП, спастический левосторонний гемипарез",
             "profile": "dcp_spastic_hemi", "n": 14},
            {"full_name": "Ерлан Серик", "age": 9, "gender": "м",
             "diagnosis": "ДЦП, дискинетическая (гиперкинетическая) форма",
             "profile": "dcp_dyskinetic", "n": 12},
        ],
    },
    {
        "username": "doctor3", "full_name": "Айгуль Бекова",
        "patients": [
            {"full_name": "Нурлан Касым", "age": 11, "gender": "м",
             "diagnosis": "ДЦП, спастическая диплегия, лёгкая форма",
             "profile": "dcp_mild_progress", "n": 12, "account": "patient3"},
            {"full_name": "Сабина Нур", "age": 6, "gender": "ж",
             "diagnosis": "ДЦП, атаксическая форма",
             "profile": "dcp_ataxic", "n": 11},
            {"full_name": "Дамир Аман", "age": 8, "gender": "м",
             "diagnosis": "ДЦП, спастический правосторонний гемипарез",
             "profile": "dcp_spastic_hemi", "n": 13},
            {"full_name": "Аделя Болат", "age": 5, "gender": "ж",
             "diagnosis": "ДЦП, дискинетическая (гиперкинетическая) форма",
             "profile": "dcp_dyskinetic", "n": 12},
        ],
    },
]


def _ensure_utf8_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass


async def _seed_sessions(patient, doctor_id, spec, seed: int) -> int:
    from app.models.session import Session
    from app.models.score import Score

    n = spec["n"]
    profile = spec["profile"]
    now = datetime.now(timezone.utc)
    rng = random.Random(seed)
    created_count = 0

    for i in range(n):
        p = i / (n - 1) if n > 1 else 1.0
        last = i == n - 1
        params = _params_for(profile, p, last)
        series = _make_series(**params, seed=rng.randint(0, 10 ** 7))
        # mark_validity — как в боевом POST /sessions: тест-данные ведут себя как реальные сессии.
        feats = mark_validity(extract_features(series, "r"))

        created = now - timedelta(days=(n - 1 - i) * 3, hours=rng.randint(0, 6))
        score = int(params["rom"] * 8 + params["smooth"] * 400 + rng.randint(0, 60))

        await Session(
            patient_id=patient.id, doctor_id=doctor_id,
            game_type="game1", game_name="Space Catcher",
            score=score, max_combo=max(1, score // 120), zone_hits=score // 50,
            duration_sec=feats.get("durationSec", params["dur_sec"]),
            level=min(5, 1 + i // 3),
            imu_time_series=series, features=feats,
            source="test", created_at=created,
        ).insert()
        await Score(patient_id=patient.id, username=patient.full_name,
                    game_type="game1", score=score, created_at=created).insert()
        created_count += 1
    return created_count


async def _delete_by_source(source: str) -> int:
    """Удаляет пациентов с данным source и их сессии/очки. Возвращает число пациентов."""
    from app.models.patient import Patient
    from app.models.session import Session
    from app.models.score import Score

    patients = await Patient.find(Patient.source == source).to_list()
    for p in patients:
        await Session.find(Session.patient_id == p.id).delete()
        await Score.find(Score.patient_id == p.id).delete()
    await Patient.find(Patient.source == source).delete()
    return len(patients)


async def _reset_test_data() -> None:
    """Удаляет тест-пациентов (source='test') и тест-учётки (врачи/пациенты), кроме админа."""
    from app.models.user import User

    n = await _delete_by_source("test")
    usernames = ([d["username"] for d in DOCTORS]
                 + [pt["account"] for d in DOCTORS for pt in d["patients"] if pt.get("account")])
    for uname in usernames:
        u = await User.find_one(User.username == uname)
        if u:
            await u.delete()
    print(f"  Сброшено тест-данных: пациентов {n}, учёток {len(usernames)} (админ сохранён).")


async def _clear_demo_data() -> None:
    """Удаляет демо-данные (source='demo') и демо-учётки. Для перехода на DEMO_MODE=false начисто."""
    from app.models.user import User

    n = await _delete_by_source("demo")
    removed = 0
    for uname in ("demo_doctor", "demo_patient"):
        u = await User.find_one(User.username == uname)
        if u:
            await u.delete()
            removed += 1
    print(f"  Очищены демо-данные: пациентов {n}, демо-учёток {removed}.")


async def _ensure_admin() -> None:
    """Гарантирует учётку администратора с известным паролем (admin / admin1234)."""
    from app.models.user import User
    from app.auth.password import hash_password

    admin = await User.find_one(User.username == ADMIN_USERNAME)
    if admin:
        await admin.set({"password_hash": hash_password(ADMIN_PASSWORD), "role": "admin"})
        print(f"Админ обновлён: {ADMIN_USERNAME} / {ADMIN_PASSWORD}")
    else:
        await User(username=ADMIN_USERNAME, email="admin@rehab.test",
                   password_hash=hash_password(ADMIN_PASSWORD), role="admin",
                   consent=True).insert()
        print(f"Создан админ: {ADMIN_USERNAME} / {ADMIN_PASSWORD}")


async def seed(reset: bool, clear_demo: bool) -> None:
    from app.database import connect_db, close_db
    from app.models.user import User
    from app.models.patient import Patient
    from app.auth.password import hash_password

    await connect_db()
    try:
        if clear_demo:
            print("Очистка демо-данных...")
            await _clear_demo_data()
        if reset:
            print("Сброс прежних тест-данных...")
            await _reset_test_data()

        await _ensure_admin()

        if await User.find_one(User.username == DOCTORS[0]["username"]):
            print("Тест-данные уже засеяны (есть doctor1). Для пересоздания: --reset.")
            return

        total_patients = total_sessions = 0
        seed_n = 5000
        for d in DOCTORS:
            doctor = User(username=d["username"], email=f'{d["username"]}@rehab.test',
                          password_hash=hash_password(DOCTOR_PASSWORD), role="doctor",
                          consent=True)
            await doctor.insert()
            print(f"\nВрач {d['username']} ({d['full_name']}) / {DOCTOR_PASSWORD}:")

            for spec in d["patients"]:
                user_id = None
                if spec.get("account"):
                    pu = User(username=spec["account"], email=f'{spec["account"]}@rehab.test',
                              password_hash=hash_password(PATIENT_PASSWORD), role="patient",
                              consent=True)
                    await pu.insert()
                    user_id = pu.id

                patient = Patient(
                    full_name=spec["full_name"], doctor_id=doctor.id, user_id=user_id,
                    diagnosis=spec["diagnosis"], age=spec["age"], gender=spec["gender"],
                    source="test",
                )
                await patient.insert()
                cnt = await _seed_sessions(patient, doctor.id, spec, seed=seed_n)
                seed_n += 211
                total_patients += 1
                total_sessions += cnt
                acc = f' [вход: {spec["account"]} / {PATIENT_PASSWORD}]' if spec.get("account") else ""
                print(f"  + {spec['full_name']}: {cnt} сессий{acc}")

        print(f"\nГотово: {len(DOCTORS)} врача, {total_patients} пациентов, {total_sessions} сессий.")
        _print_credentials()
    finally:
        await close_db()


def _print_credentials() -> None:
    print("\n── Учётные данные ──────────────────────────────")
    print(f"  Админ    {ADMIN_USERNAME:<10} {ADMIN_PASSWORD}")
    for d in DOCTORS:
        print(f"  Врач     {d['username']:<10} {DOCTOR_PASSWORD}")
    for d in DOCTORS:
        for pt in d["patients"]:
            if pt.get("account"):
                print(f"  Пациент  {pt['account']:<10} {PATIENT_PASSWORD}  (врач {d['username']})")
    print("────────────────────────────────────────────────")


def main() -> None:
    _ensure_utf8_stdout()
    ap = argparse.ArgumentParser(description="Засев тестовых данных (дети с ДЦП) в MongoDB.")
    ap.add_argument("--reset", action="store_true", help="Удалить прежние тест-данные и засеять заново.")
    ap.add_argument("--clear-demo", action="store_true", help="Также стереть демо-данные (source='demo').")
    args = ap.parse_args()
    asyncio.run(seed(reset=args.reset, clear_demo=args.clear_demo))


if __name__ == "__main__":
    main()
