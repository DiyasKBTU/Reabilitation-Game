"""
CLI: пометить ВСЕ существующие данные как ТЕСТОВЫЕ, кроме администратора.

Зачем: перед раздачей на тестирование приводим базу к состоянию «реальных данных ещё нет».
Все нынешние врачи/пациенты и их сессии становятся тестовыми (is_test / source="test"),
поэтому НЕ попадают в обучение ML (mongo_loader пропускает source in [test, demo]) и в
реальную статистику. После этого:
  - РЕАЛЬНЫЕ пациенты появляются только через саморегистрацию (is_test=false, source=None);
  - новые ТЕСТОВЫЕ — только через явную кнопку в админке («Создать тест-пациента»).

Администратор (role="admin") НЕ трогается — остаётся реальным.

Идемпотентно: повторный запуск ставит те же флаги, ничего не ломает.

Запуск (из корня репозитория, venv, нужна запущенная MongoDB; MONGO_URI из api/.env):
  venv\\Scripts\\python.exe api\\scripts\\mark_existing_as_test.py
"""
from __future__ import annotations
import asyncio
import sys
from pathlib import Path

# Делаем пакет `app` импортируемым при прямом запуске скрипта.
_API_DIR = Path(__file__).resolve().parents[1]   # .../api
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))


def _ensure_utf8_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass


async def run() -> None:
    from app.database import connect_db, close_db
    from app.models.user import User
    from app.models.patient import Patient
    from app.models.session import Session

    await connect_db()
    try:
        # 1) Все НЕ-админы → тестовые учётки.
        users = await User.find(User.role != "admin").to_list()
        n_users = 0
        for u in users:
            if not u.is_test:
                await u.set({"is_test": True})
                n_users += 1
        print(f"Учёток помечено тестовыми: {n_users} (из {len(users)} не-админов; админы не тронуты).")

        # 2) Все существующие карточки пациентов → тестовые. source="test" ставим только там,
        #    где провенанса ещё нет (None); демо/firebase сохраняют свой source, но тоже
        #    становятся is_test=true (не реальные).
        patients = await Patient.find_all().to_list()
        patient_ids = []
        for p in patients:
            patch = {}
            if not p.is_test:
                patch["is_test"] = True
            if p.source is None:
                patch["source"] = "test"
            if patch:
                await p.set(patch)
            patient_ids.append(p.id)
        print(f"Карточек пациентов помечено тестовыми: {len(patients)}.")

        # 3) Сессии этих пациентов без провенанса (source=None) → source="test".
        #    Идём через motor-коллекцию ради modified_count и одного запроса.
        modified = 0
        if patient_ids:
            res = await Session.get_motor_collection().update_many(
                {"patient_id": {"$in": patient_ids}, "source": None},
                {"$set": {"source": "test"}},
            )
            modified = res.modified_count
        print(f"Сессий помечено тестовыми (source=test): {modified}.")

        print("\nГотово. Реальными остаются только: админ и всё, что зарегистрируется ПОСЛЕ этого.")
    finally:
        await close_db()


def main() -> None:
    _ensure_utf8_stdout()
    asyncio.run(run())


if __name__ == "__main__":
    main()
