"""
CLI: очистка базы перед боевой эксплуатацией — удаляет ДЕМО и ТЕСТОВЫЕ данные,
оставляя администратора и реальных пациентов/врачей нетронутыми.

Зачем: при DEMO_MODE=true и/или прогонах seed_test_data в базе копятся демо-когорта
(source="demo", учётки demo_doctor/demo_patient со слабым паролем demo1234) и тест-данные
(source="test" / is_test, учётки doctor1..3 / patient1..3). Перед приходом реальных
пациентов их надо убрать, чтобы не путать и не держать слабые пароли.

БЕЗОПАСНОСТЬ:
  - По умолчанию РЕЖИМ ПРОСМОТРА (dry-run): только показывает, что было бы удалено.
    Реальное удаление — только с флагом --apply.
  - НИКОГДА не удаляет учётки с ролью admin и реальных (не demo/не test) пациентов/врачей.
  - Удаление НЕОБРАТИМО и НЕ в git. Перед --apply сделайте дамп Mongo (см. инструкцию).

Что считается «на удаление»:
  - Пациенты: source="demo" ИЛИ source="test" ИЛИ is_test=true → карточка + её сессии + очки.
  - Учётки: is_test=true; demo_doctor/demo_patient; сид-логины doctor1..3/patient1..3;
    и любые учётки, привязанные к удаляемым карточкам (user_id) — КРОМЕ роли admin.

Запуск в проде (внутри контейнера api):
  docker compose -f docker-compose.prod.yml exec api python scripts/cleanup_for_production.py            # просмотр
  docker compose -f docker-compose.prod.yml exec api python scripts/cleanup_for_production.py --apply     # удалить

Локально (venv, запущенная Mongo, MONGO_URI из api/.env):
  venv\\Scripts\\python.exe api\\scripts\\cleanup_for_production.py            # просмотр
  venv\\Scripts\\python.exe api\\scripts\\cleanup_for_production.py --apply     # удалить
"""
from __future__ import annotations
import argparse
import asyncio
import sys
from pathlib import Path

# Делаем пакет `app` импортируемым при прямом запуске скрипта.
_API_DIR = Path(__file__).resolve().parents[1]   # .../api
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))

# Известные сид-логины (из seed_test_data.py и demo/seed.py). Явно перечислены, чтобы
# вычистить связанные учётки, которые не привязаны к карточке пациента (напр. врачи-сиды).
SEED_DOCTOR_USERNAMES = {"doctor1", "doctor2", "doctor3", "demo_doctor"}
SEED_PATIENT_USERNAMES = {"patient1", "patient2", "patient3", "demo_patient"}
SEED_USERNAMES = SEED_DOCTOR_USERNAMES | SEED_PATIENT_USERNAMES


def _ensure_utf8_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass


async def cleanup(apply: bool) -> None:
    from app.database import connect_db, close_db
    from app.models.user import User
    from app.models.patient import Patient
    from app.models.session import Session
    from app.models.score import Score

    await connect_db()
    try:
        # ── 1. Карточки пациентов на удаление: demo / test / is_test ──────────
        all_patients = await Patient.find_all().to_list()
        del_patients = [p for p in all_patients
                        if p.source in ("demo", "test") or getattr(p, "is_test", False)]
        del_patient_ids = {p.id for p in del_patients}
        keep_patients = [p for p in all_patients if p.id not in del_patient_ids]

        # ── 2. Учётки на удаление ─────────────────────────────────────────────
        all_users = await User.find_all().to_list()
        linked_user_ids = {p.user_id for p in del_patients if p.user_id}
        del_users, kept_users = [], []
        for u in all_users:
            # Защита: администратора не трогаем НИКОГДА.
            if u.role == "admin":
                kept_users.append(u)
                continue
            is_junk = (
                getattr(u, "is_test", False)
                or u.username in SEED_USERNAMES
                or u.id in linked_user_ids
            )
            (del_users if is_junk else kept_users).append(u)

        # ── 3. Отчёт ──────────────────────────────────────────────────────────
        # Считаем сессии/очки удаляемых карточек (для наглядности).
        sess_count = 0
        for p in del_patients:
            sess_count += await Session.find(Session.patient_id == p.id).count()

        print("=" * 64)
        print("ОЧИСТКА БАЗЫ" + ("  [ПРИМЕНЕНИЕ]" if apply else "  [ПРОСМОТР — ничего не удаляется]"))
        print("=" * 64)

        print(f"\nНА УДАЛЕНИЕ — карточки пациентов: {len(del_patients)}")
        for p in del_patients:
            tag = p.source or ("is_test" if getattr(p, "is_test", False) else "?")
            print(f"  - {p.full_name!r:32} [{tag}]")
        print(f"  → связанных сессий: {sess_count} (+ очки будут удалены)")

        print(f"\nНА УДАЛЕНИЕ — учётки: {len(del_users)}")
        for u in del_users:
            print(f"  - {u.username:20} роль={u.role:8} is_test={getattr(u, 'is_test', False)}")

        print(f"\nОСТАЮТСЯ — учётки (админ + реальные): {len(kept_users)}")
        for u in kept_users:
            print(f"  + {u.username:20} роль={u.role:8}")
        print(f"\nОСТАЮТСЯ — реальные карточки пациентов: {len(keep_patients)}")
        for p in keep_patients:
            print(f"  + {p.full_name!r:32} source={p.source or 'live'}")

        if not apply:
            print("\n" + "-" * 64)
            print("Это ПРОСМОТР. Ничего не удалено. Для удаления запустите с флагом --apply")
            print("(перед этим сделайте дамп Mongo — удаление необратимо).")
            return

        # ── 4. Удаление (только с --apply) ────────────────────────────────────
        print("\nУдаляю…")
        for p in del_patients:
            await Session.find(Session.patient_id == p.id).delete()
            await Score.find(Score.patient_id == p.id).delete()
            await p.delete()
        for u in del_users:
            await u.delete()
        print(f"Удалено: карточек {len(del_patients)}, сессий {sess_count}, учёток {len(del_users)}.")
        print(f"Осталось: учёток {len(kept_users)}, карточек {len(keep_patients)}. Готово.")
    finally:
        await close_db()


def main() -> None:
    _ensure_utf8_stdout()
    ap = argparse.ArgumentParser(
        description="Очистка демо/тест-данных перед боевой эксплуатацией (по умолчанию — просмотр).")
    ap.add_argument("--apply", action="store_true",
                    help="Действительно удалить (без флага — только показать, что будет удалено).")
    args = ap.parse_args()
    asyncio.run(cleanup(apply=args.apply))


if __name__ == "__main__":
    main()
