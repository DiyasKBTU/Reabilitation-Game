"""
Засев демонстрационных данных для показа инвесторам (DEMO_MODE=true).

Идемпотентно: если демо-врач уже существует — выходим, повторно ничего не создаём.
Создаёт:
  - демо-врача и демо-пациента (учётки для входа);
  - 5 пациентов с клинически правдоподобными траекториями реабилитации
    (норма/прогресс, постинсультная асимметрия, тремор Паркинсона, болевой синдром);
  - по 11–14 сессий на пациента с готовыми признаками — чтобы ML-дашборд (KPI, аномалии,
    рекомендации, тренды, спектр дрожи) был полностью заполнен сразу после входа.

Генератор IMU здесь автономный (мини-копия ml-service/data/synthetic.py): демо-модуль
не должен зависеть от ml-service, а паритет признаков ему не нужен.
"""
from __future__ import annotations
import math
import random
from datetime import datetime, timezone, timedelta
from typing import Dict, List

from ..ml.features import extract_features

# ─── Учётные данные демо (отдаются на странице входа кнопками) ────────────────
DEMO_PASSWORD = "demo1234"
DEMO_DOCTOR_USERNAME = "demo_doctor"
DEMO_PATIENT_USERNAME = "demo_patient"

DEMO_CREDENTIALS = {
    "doctor":  {"username": DEMO_DOCTOR_USERNAME,  "password": DEMO_PASSWORD},
    "patient": {"username": DEMO_PATIENT_USERNAME, "password": DEMO_PASSWORD},
}


# ─── Автономный генератор IMU-ряда (демо-only) ───────────────────────────────

def _make_series(rom, smooth, tremor, tremor_freq_hz, asymmetry,
                 pause_frac, dur_sec=22.0, fs_hz=25.0, fatigue_decay=0.0,
                 noise_sd=0.6, seed=None) -> List[Dict]:
    rng = random.Random(seed)
    n = int(dur_sec * fs_hz)
    dt_ms = 1000.0 / fs_hz
    move_freq_hz = 0.5  # частота произвольного движения кисти

    asym_c = max(-1.0, min(1.0, asymmetry))
    amp_pos = rom / 2 * (1.0 + min(0.0, asym_c))
    amp_neg = rom / 2 * (1.0 - max(0.0, asym_c))

    series: List[Dict] = []
    for i in range(n):
        t = i * dt_ms
        ts = t / 1000.0
        decay = 1.0 - fatigue_decay * (i / max(n - 1, 1)) * 0.6
        base = math.sin(2 * math.pi * move_freq_hz * ts)
        r = (amp_pos * base if base >= 0 else amp_neg * base) * decay
        r += tremor * rom * 0.15 * math.sin(2 * math.pi * tremor_freq_hz * ts)  # дрожь
        r += (1 - smooth) * rom * 0.25 * rng.gauss(0, 1)                        # рывковость
        r += rng.gauss(0, noise_sd)                                            # шум датчика
        if rng.random() < pause_frac:
            r = series[-1]["r"] if series else 0.0
        series.append({"t": round(t, 1), "r": round(r, 3), "p": 0.0, "y": 0.0})
    return series


def _lerp(a: float, b: float, p: float) -> float:
    return a + (b - a) * p


def _params_for(profile: str, p: float, last: bool) -> Dict:
    """Параметры сессии по профилю и прогрессу p∈[0,1] (0 — старая, 1 — свежая)."""
    if profile == "recovery_normal":          # норма с улучшением
        return dict(rom=_lerp(38, 60, p), smooth=_lerp(0.78, 0.95, p), tremor=0.05,
                    tremor_freq_hz=6.0, asymmetry=_lerp(0.18, 0.08, p),
                    pause_frac=_lerp(0.22, 0.10, p), dur_sec=_lerp(18, 26, p),
                    fatigue_decay=0.1, noise_sd=0.5)
    if profile == "stroke_asym":              # постинсультная асимметрия, неполное восстановление
        params = dict(rom=_lerp(26, 33, p), smooth=_lerp(0.55, 0.70, p), tremor=0.15,
                      tremor_freq_hz=5.5, asymmetry=_lerp(0.55, 0.40, p),
                      pause_frac=_lerp(0.38, 0.30, p), dur_sec=_lerp(16, 22, p),
                      fatigue_decay=0.3, noise_sd=0.8)
        if last:  # лёгкий откат на свежей сессии (плато) → тир «Внимание» (amber)
            params.update(rom=31, smooth=0.64, tremor=0.16, asymmetry=0.28, pause_frac=0.28,
                          fatigue_decay=0.25, dur_sec=20, noise_sd=0.7)
        return params
    if profile == "parkinson_tremor":         # тремор покоя ~5 Гц, хронический
        return dict(rom=_lerp(30, 38, p), smooth=_lerp(0.45, 0.56, p),
                    tremor=_lerp(0.72, 0.62, p), tremor_freq_hz=5.0, asymmetry=0.2,
                    pause_frac=0.2, dur_sec=_lerp(18, 22, p), fatigue_decay=0.15, noise_sd=1.0)
    if profile == "shoulder_pain":            # болевой синдром, недавнее обострение
        params = dict(rom=_lerp(22, 27, p), smooth=_lerp(0.50, 0.60, p), tremor=0.12,
                      tremor_freq_hz=5.0, asymmetry=0.45, pause_frac=_lerp(0.45, 0.32, p),
                      dur_sec=_lerp(14, 20, p), fatigue_decay=0.4, noise_sd=0.8)
        if last:  # самая свежая сессия — обострение → критическая ML-аномалия
            params.update(rom=12, smooth=0.40, pause_frac=0.58, fatigue_decay=0.6, dur_sec=12)
        return params
    raise ValueError(f"неизвестный профиль: {profile}")


# ─── Когорта демо-пациентов ──────────────────────────────────────────────────
# account=True → пациент привязан к учётке demo_patient (может войти и поиграть сам).
DEMO_PATIENTS = [
    {"full_name": "Мария Иванова",  "age": 48, "gender": "ж",
     "diagnosis": "Состояние после эндопротезирования коленного сустава",
     "profile": "recovery_normal", "n": 12, "account": True},
    {"full_name": "Анна Ковалёва",  "age": 54, "gender": "ж",
     "diagnosis": "Постинсультный правосторонний гемипарез",
     "profile": "stroke_asym", "n": 14},
    {"full_name": "Борис Семёнов",  "age": 67, "gender": "м",
     "diagnosis": "Болезнь Паркинсона, тремор покоя",
     "profile": "parkinson_tremor", "n": 13},
    {"full_name": "Дмитрий Орлов",  "age": 60, "gender": "м",
     "diagnosis": "Хронический болевой синдром плечевого сустава",
     "profile": "shoulder_pain", "n": 11},
    {"full_name": "Елена Дёмина",   "age": 51, "gender": "ж",
     "diagnosis": "Реабилитация лучезапястного сустава после перелома",
     "profile": "recovery_normal", "n": 12},
]


async def _seed_patient_sessions(patient, doctor, spec, seed: int) -> None:
    from ..models.session import Session
    from ..models.score import Score

    n = spec["n"]
    profile = spec["profile"]
    now = datetime.now(timezone.utc)
    # Детерминированный seed (НЕ hash() строки — он рандомизируется per-process по PYTHONHASHSEED),
    # чтобы демо-данные и ML-вердикты были одинаковыми при каждом перезапуске.
    rng = random.Random(seed)

    for i in range(n):
        p = i / (n - 1) if n > 1 else 1.0
        last = i == n - 1
        params = _params_for(profile, p, last)
        series = _make_series(**params, seed=rng.randint(0, 10 ** 7))
        feats = extract_features(series, "r")

        # backdate: сессии каждые ~3 дня, свежая — сегодня
        created = now - timedelta(days=(n - 1 - i) * 3, hours=rng.randint(0, 6))
        score = int(params["rom"] * 8 + params["smooth"] * 400 + rng.randint(0, 60))

        await Session(
            patient_id=patient.id, doctor_id=doctor.id,
            game_type="game1", game_name="Space Catcher",
            score=score, max_combo=max(1, score // 120), zone_hits=score // 50,
            duration_sec=feats.get("durationSec", params["dur_sec"]),
            level=min(5, 1 + i // 3),
            imu_time_series=series, features=feats,
            source="demo", created_at=created,
        ).insert()

        await Score(patient_id=patient.id, username=patient.full_name,
                    game_type="game1", score=score, created_at=created).insert()


async def seed_demo() -> bool:
    """Идемпотентный засев демо-данных. Возвращает True, если что-то создано."""
    from ..models.user import User
    from ..models.patient import Patient
    from ..auth.password import hash_password

    if await User.find_one(User.username == DEMO_DOCTOR_USERNAME):
        return False  # уже засеяно

    doctor = User(username=DEMO_DOCTOR_USERNAME, email="demo_doctor@rehab.demo",
                  password_hash=hash_password(DEMO_PASSWORD), role="doctor")
    await doctor.insert()

    patient_user = User(username=DEMO_PATIENT_USERNAME, email="demo_patient@rehab.demo",
                        password_hash=hash_password(DEMO_PASSWORD), role="patient")
    await patient_user.insert()

    for idx, spec in enumerate(DEMO_PATIENTS):
        patient = Patient(
            full_name=spec["full_name"], doctor_id=doctor.id,
            user_id=patient_user.id if spec.get("account") else None,
            diagnosis=spec["diagnosis"], age=spec["age"], gender=spec["gender"],
            source="demo",
        )
        await patient.insert()
        await _seed_patient_sessions(patient, doctor, spec, seed=1000 + idx * 137)

    return True
