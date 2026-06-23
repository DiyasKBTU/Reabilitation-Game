"""
Диагностика: ЧТО реально лежит в MongoDB — чтобы понять, есть ли данные с устройства и
пригодны ли они для обучения модели.

Различает источники сессий и, главное, считает, у скольких есть СЫРОЙ ряд IMU
(`imu_time_series`) — именно он нужен для полного вектора из 16 признаков и обучения.

Запуск (из корня репозитория, venv, при запущенной MongoDB):
  venv\\Scripts\\python.exe api\\scripts\\inspect_sessions.py

Строка подключения — из api/.env (MONGO_URI). Ничего не меняет, только читает.
"""
from __future__ import annotations
import asyncio
import sys
from collections import Counter
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


async def _run() -> None:
    from app.database import connect_db, close_db
    from app.models.patient import Patient
    from app.models.session import Session

    await connect_db()
    try:
        n_patients = await Patient.count()
        n_sessions = await Session.count()
        print(f"Пациентов: {n_patients} | Сессий: {n_sessions}\n")

        if n_sessions == 0:
            print("В базе нет сессий. Данных устройства пока нет — сыграйте с ESP32 "
                  "(или импортируйте Firebase / включите DEMO_MODE).")
            return

        by_source: Counter = Counter()
        with_series = 0           # есть сырой ряд IMU (пригодно для 16 признаков и обучения)
        valid = 0
        partial = 0
        series_lengths = []

        async for s in Session.find_all():
            src = s.source or "live"   # None → живая игра в приложении
            by_source[src] += 1
            ser = s.imu_time_series or []
            if len(ser) >= 3:
                with_series += 1
                series_lengths.append(len(ser))
            f = s.features or {}
            if f.get("valid"):
                valid += 1
            if f.get("partial"):
                partial += 1

        print("Сессии по источнику (source):")
        for src, cnt in by_source.most_common():
            print(f"  {src:<10} {cnt}")

        print(f"\nС сырым рядом IMU (imu_time_series ≥ 3 точек): {with_series}/{n_sessions}")
        if series_lengths:
            print(f"  длина ряда: min={min(series_lengths)}, "
                  f"max={max(series_lengths)}, "
                  f"средн.={sum(series_lengths) // len(series_lengths)}")
        print(f"valid (features.valid): {valid}/{n_sessions}")
        print(f"partial (агрегаты Firebase, без ряда): {partial}/{n_sessions}")

        # Реальные данные устройства = НЕ demo, с сырым рядом.
        real_device_like = sum(c for src, c in by_source.items() if src not in ("demo",))
        print("\n── Вывод для обучения ──")
        print(f"Пригодно для ПОЛНОЙ модели (16 признаков, нужен сырой ряд): {with_series} сессий.")
        if with_series == 0:
            print("  → Сырого ряда нет ни у одной сессии. На данных устройства полную модель")
            print("    обучить нельзя, пока клиент/прошивка не начнёт логировать [{t,r,p,y}].")
        non_demo_series = "?"
        print(f"Сессий не из демо: {real_device_like} (из них с рядом — см. выше).")
    finally:
        await close_db()


def main() -> None:
    _ensure_utf8_stdout()
    try:
        asyncio.run(_run())
    except Exception as e:
        print(f"[ОШИБКА] Не удалось прочитать MongoDB: {e}")
        print("Проверьте, что MongoDB запущена и MONGO_URI в api/.env верный.")
        sys.exit(1)


if __name__ == "__main__":
    main()
