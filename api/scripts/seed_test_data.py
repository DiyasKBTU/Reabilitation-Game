"""
CLI: засев ТЕСТОВЫХ данных (дети с ДЦП) в MongoDB для разработки и тестирования.

Отличается от демо-режима (`DEMO_MODE` + `app/demo/seed.py`):
  - запускается ВРУЧНУЮ, а не автоматически на старте API;
  - помечает всё `source="test"` — легко найти и удалить (`--reset`), не путая с боевыми/демо;
  - отдельные учётки `test_doctor` / `test_patient` (пароль `test1234`).

Назначение — быстро наполнить пустую БД реалистичными данными, чтобы вручную проверять
дашборд врача, экран результата пациента, фильтры, тренды, ML-вердикты без реального устройства.

Целевая аудитория проекта — дети с ДЦП. Когорта покрывает основные формы (спастическая,
гемипарез, дискинетическая, атаксическая) и весь спектр ML-вердиктов (норма / внимание / критично).

Запуск (из корня репозитория, venv), требует запущенной MongoDB (MONGO_URI из api/.env):
  venv\\Scripts\\python.exe api\\scripts\\seed_test_data.py            # засеять (идемпотентно)
  venv\\Scripts\\python.exe api\\scripts\\seed_test_data.py --reset    # удалить тест-данные и засеять заново
  venv\\Scripts\\python.exe api\\scripts\\seed_test_data.py --doctor-id <ObjectId>   # привязать к врачу
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

TEST_PASSWORD = "test1234"
TEST_DOCTOR_USERNAME = "test_doctor"
TEST_PATIENT_USERNAME = "test_patient"

# Тест-когорта: дети с ДЦП. account=True → привязан к учётке test_patient (может войти и поиграть).
TEST_COHORT = [
    {"full_name": "Айдос Жума (тест)",  "age": 8,  "gender": "м",
     "diagnosis": "ДЦП, спастическая диплегия, лёгкая форма",
     "profile": "dcp_mild_progress", "n": 12, "account": True},
    {"full_name": "Камила Ерлан (тест)", "age": 7, "gender": "ж",
     "diagnosis": "ДЦП, спастический левосторонний гемипарез",
     "profile": "dcp_spastic_hemi", "n": 13},
    {"full_name": "Ерлан Серик (тест)",  "age": 9, "gender": "м",
     "diagnosis": "ДЦП, дискинетическая (гиперкинетическая) форма",
     "profile": "dcp_dyskinetic", "n": 12},
    {"full_name": "Сабина Нур (тест)",   "age": 6, "gender": "ж",
     "diagnosis": "ДЦП, атаксическая форма",
     "profile": "dcp_ataxic", "n": 11},
    {"full_name": "Нурлан Касым (тест)", "age": 11, "gender": "м",
     "diagnosis": "ДЦП, спастический правосторонний гемипарез",
     "profile": "dcp_spastic_hemi", "n": 14},
    {"full_name": "Аделя Болат (тест)",  "age": 5, "gender": "ж",
     "diagnosis": "ДЦП, спастическая диплегия",
     "profile": "dcp_mild_progress", "n": 12},
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


async def _reset_test_data() -> None:
    """Удаляет всё, помеченное source='test', и тест-учётки — чистый повторный засев."""
    from app.models.user import User
    from app.models.patient import Patient
    from app.models.session import Session
    from app.models.score import Score

    test_patients = await Patient.find(Patient.source == "test").to_list()
    pids = [p.id for p in test_patients]
    for pid in pids:
        await Session.find(Session.patient_id == pid).delete()
        await Score.find(Score.patient_id == pid).delete()
    await Patient.find(Patient.source == "test").delete()
    for uname in (TEST_DOCTOR_USERNAME, TEST_PATIENT_USERNAME):
        u = await User.find_one(User.username == uname)
        if u:
            await u.delete()
    print(f"  Удалено тест-пациентов: {len(pids)} (с их сессиями и очками).")


async def seed(reset: bool, doctor_id: str | None) -> None:
    from app.database import connect_db, close_db
    from app.models.user import User
    from app.models.patient import Patient
    from app.auth.password import hash_password
    from beanie import PydanticObjectId

    await connect_db()
    try:
        if reset:
            print("Сброс существующих тест-данных...")
            await _reset_test_data()

        if await User.find_one(User.username == TEST_DOCTOR_USERNAME):
            print("Тест-данные уже засеяны (есть test_doctor). Для пересоздания: --reset.")
            return

        # Врач: либо указанный --doctor-id, либо отдельная тест-учётка.
        if doctor_id:
            did = PydanticObjectId(doctor_id)
            if not await User.get(did):
                print(f"Врач с id={doctor_id} не найден.")
                return
            doctor_user_id = did
            print(f"Пациенты будут привязаны к врачу id={doctor_id}.")
        else:
            doctor = User(username=TEST_DOCTOR_USERNAME, email="test_doctor@rehab.test",
                          password_hash=hash_password(TEST_PASSWORD), role="doctor")
            await doctor.insert()
            doctor_user_id = doctor.id
            print(f"Создан тест-врач: {TEST_DOCTOR_USERNAME} / {TEST_PASSWORD}")

        patient_user = User(username=TEST_PATIENT_USERNAME, email="test_patient@rehab.test",
                            password_hash=hash_password(TEST_PASSWORD), role="patient")
        await patient_user.insert()
        print(f"Создан тест-пациент (учётка): {TEST_PATIENT_USERNAME} / {TEST_PASSWORD}")

        total_sessions = 0
        for idx, spec in enumerate(TEST_COHORT):
            patient = Patient(
                full_name=spec["full_name"], doctor_id=doctor_user_id,
                user_id=patient_user.id if spec.get("account") else None,
                diagnosis=spec["diagnosis"], age=spec["age"], gender=spec["gender"],
                source="test",
            )
            await patient.insert()
            cnt = await _seed_sessions(patient, doctor_user_id, spec, seed=5000 + idx * 211)
            total_sessions += cnt
            print(f"  + {spec['full_name']}: {cnt} сессий ({spec['diagnosis']})")

        print(f"\nГотово: {len(TEST_COHORT)} пациентов, {total_sessions} сессий.")
        print("Вход врача:   test_doctor / test1234  → дашборд со всеми пациентами.")
        print("Вход ребёнка: test_patient / test1234 → игры и экран результата.")
    finally:
        await close_db()


def main() -> None:
    _ensure_utf8_stdout()
    ap = argparse.ArgumentParser(description="Засев тестовых данных (дети с ДЦП) в MongoDB.")
    ap.add_argument("--reset", action="store_true", help="Удалить прежние тест-данные и засеять заново.")
    ap.add_argument("--doctor-id", help="Привязать пациентов к существующему врачу (его ObjectId).")
    args = ap.parse_args()
    asyncio.run(seed(reset=args.reset, doctor_id=args.doctor_id))


if __name__ == "__main__":
    main()
