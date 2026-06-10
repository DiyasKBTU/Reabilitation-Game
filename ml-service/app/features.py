"""
ML Этап 1 — извлечение признаков движения из IMU time-series (Python-порт).

Это ЭТАЛОННАЯ Python-реализация featureService.js. Логика повторяет JS
один-в-один, чтобы признаки, посчитанные на Node-бэкенде и в ML-сервисе,
совпадали (см. tests/test_parity.py). Когда появятся обученные модели, они
будут принимать ровно этот вектор признаков.

Вход:  series = [{"t": ms, "r": roll, "p": pitch, "y": yaw}, ...]
Выход: плоский словарь числовых признаков (не диагноз — описание движения).
"""
from __future__ import annotations
from typing import List, Dict, Any

DEFAULT_DT_MS = 200  # запасной интервал, если t отсутствует

# Пороговая скорость для тремора: оба соседних семпла должны её превышать.
# Нормализация: ~8 смен направления в секунду → tremorIndex=1.
TREMOR_NORM_HZ = 8.0

# ─── Спектральный анализ дрожи (частотная область) ───────────────────────────
# tremorIndex (ниже) — временной метод (смены направления скорости). Здесь — частотный:
# доля мощности в клинической полосе тремора + доминирующая частота дрожи.
# Реализация — прямое ДПФ (чистый Python, без numpy) по сетке частот: детерминирована
# и одинакова в обоих портах (паритет). Сумма уравновешена по реальным временам t_i,
# поэтому корректна и при неравномерной дискретизации.
TREMOR_BAND_LOW_HZ = 3.0     # ниже — произвольное движение/дрейф
TREMOR_BAND_HIGH_HZ = 12.0   # клинический тремор: паркинсон 4–6 Гц, эссенциальный 6–12 Гц
DFT_STEP_HZ = 0.25           # шаг частотной сетки
DFT_MIN_HZ = 0.25            # нижняя граница полной мощности (захватывает произвольное ~0.5 Гц)
TREMOR_MIN_RATIO = 0.01      # ниже этой доли мощности пик считаем шумом → частоту не сообщаем


def _sign(x: float) -> int:
    if x > 0:
        return 1
    if x < 0:
        return -1
    return 0


def _js_round(v: float, d: int = 3) -> float:
    """Повторяет JS Math.round(v*k)/k (округление .5 вверх)."""
    if not _is_finite(v):
        return 0.0
    k = 10 ** d
    import math
    return math.floor(v * k + 0.5) / k


def _is_finite(v: float) -> bool:
    return v == v and v not in (float("inf"), float("-inf"))


def _avg(arr: List[float]) -> float:
    return sum(arr) / len(arr) if arr else 0.0


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _moving_avg3(arr: List[float]) -> List[float]:
    """Скользящее среднее по 3 точкам с зеркальными краями (то же поведение, что в JS)."""
    n = len(arr)
    out = []
    for i in range(n):
        s = max(0, i - 1)
        e = min(n, i + 2)
        chunk = arr[s:e]
        out.append(sum(chunk) / len(chunk))
    return out


def _safe_float(v: Any) -> float:
    """Робастное приведение к float. На мусоре ('−', None, '') → 0.0 (как JS Number||0),
    а не ValueError. Раньше float('−') ронял эталонную функцию (JS возвращал 0)."""
    try:
        f = float(v)
        return f if f == f and f not in (float("inf"), float("-inf")) else 0.0
    except (TypeError, ValueError):
        return 0.0


def _spectral_tremor(a: List[float], t: List[float]) -> tuple:
    """Спектральный анализ дрожи → (tremorFreqHz, tremorPower).

    tremorPower — доля спектральной мощности в полосе 3–12 Гц от полной мощности (0..1):
      у произвольного движения мощность сосредоточена на ~0.5 Гц → доля мала;
      у дрожи — выраженный пик в полосе → доля велика.
    tremorFreqHz — частота пика внутри полосы; 0, если частота дискретизации не покрывает полосу.

    Прямое ДПФ по сетке частот с шагом DFT_STEP_HZ. Время t_i (мс) переводится в секунды,
    суммы взвешены по реальным временам → корректно при неравномерной дискретизации.
    """
    import math
    n = len(a)
    if n < 10:
        return 0.0, 0.0
    dur_sec = (t[n - 1] - t[0]) / 1000.0
    if dur_sec < 2.0:
        return 0.0, 0.0
    fs_hz = (n - 1) / dur_sec            # средняя частота дискретизации
    nyq = fs_hz / 2.0
    band_high = min(TREMOR_BAND_HIGH_HZ, nyq * 0.98)
    if band_high <= TREMOR_BAND_LOW_HZ:
        return 0.0, 0.0                  # fs не покрывает полосу тремора

    mean_a = sum(a) / n                  # убираем DC, иначе среднее даёт ложную мощность
    a0 = [v - mean_a for v in a]
    ts = [(t[i] - t[0]) / 1000.0 for i in range(n)]

    total_power = band_power = peak_power = peak_freq = 0.0
    f = DFT_MIN_HZ
    while f <= nyq + 1e-9:
        re = im = 0.0
        for i in range(n):
            ang = 2.0 * math.pi * f * ts[i]
            re += a0[i] * math.cos(ang)
            im += a0[i] * math.sin(ang)
        power = re * re + im * im
        total_power += power
        if TREMOR_BAND_LOW_HZ <= f <= band_high:
            band_power += power
            if power > peak_power:
                peak_power = power
                peak_freq = f
        f += DFT_STEP_HZ

    if total_power <= 0:
        return 0.0, 0.0
    ratio = band_power / total_power
    # Доля мала → выраженной дрожи нет, пик в полосе — шум → частоту не сообщаем (0).
    return (peak_freq if ratio >= TREMOR_MIN_RATIO else 0.0), ratio


def empty_features() -> Dict[str, Any]:
    return {
        "sampleCount": 0, "durationSec": 0, "rom": 0, "minAngle": 0, "maxAngle": 0,
        "meanAbsVelocity": 0, "peakVelocity": 0, "meanJerk": 0, "smoothnessIndex": 0,
        "tremorIndex": 0, "tremorFreqHz": 0, "tremorPower": 0, "symmetryIndex": 0,
        "pauseRatio": 0, "repetitions": 0, "activeTimeSec": 0, "valid": False,
    }


def extract_features(series: List[Dict[str, Any]], axis: str = "r") -> Dict[str, Any]:
    if not isinstance(series, list) or len(series) < 3:
        return empty_features()

    a = [_safe_float(s.get(axis)) for s in series]
    t = [float(s["t"]) if isinstance(s.get("t"), (int, float)) else i * DEFAULT_DT_MS
         for i, s in enumerate(series)]
    n = len(a)

    duration_sec = max(0.0, (t[n - 1] - t[0]) / 1000) or (n - 1) * (DEFAULT_DT_MS / 1000)

    # ROM / симметрия / активное время — по сырому сигналу (макс. точность диапазона)
    min_angle = min(a)
    max_angle = max(a)
    rom = max_angle - min_angle

    pos_exc = neg_exc = 0.0
    for i in range(1, n):
        d = a[i] - a[i - 1]
        if d > 0:
            pos_exc += d
        else:
            neg_exc += -d
    total_exc = pos_exc + neg_exc
    symmetry_index = _js_round((pos_exc - neg_exc) / total_exc) if total_exc > 0 else 0

    dt_sec = duration_sec / n
    active_time_sec = _js_round(len([v for v in a if abs(v) > 5]) * dt_sec, 1)

    # Сглаживаем угол скользящим средним (3 точки) перед дифференцированием.
    # MA(3) снижает дисперсию шума датчика в ~sqrt(3) раз за каждый уровень производной,
    # что предотвращает вырождение smoothnessIndex/tremorIndex при высокой частоте дискретизации.
    a_s = _moving_avg3(a)

    vel = []
    for i in range(1, n):
        dt = max(1.0, t[i] - t[i - 1]) / 1000
        vel.append((a_s[i] - a_s[i - 1]) / dt)
    abs_vel = [abs(v) for v in vel]
    mean_abs_velocity = _avg(abs_vel)
    peak_velocity = max(abs_vel + [0.0])

    acc = []
    for i in range(1, len(vel)):
        dt = max(1.0, t[i + 1] - t[i]) / 1000
        acc.append((vel[i] - vel[i - 1]) / dt)
    jerk = []
    for i in range(1, len(acc)):
        dt = max(1.0, t[i + 2] - t[i + 1]) / 1000
        jerk.append((acc[i] - acc[i - 1]) / dt)
    mean_jerk = _avg([abs(j) for j in jerk])

    # smoothnessIndex: нормируем рывок с учётом частоты дискретизации.
    # При высоком fs (25 Гц vs эталонный 5 Гц) шум в рывке растёт как (fs/fs_ref)^2,
    # поэтому jerkScale масштабируем обратно пропорционально.
    dt_avg_ms = max(1.0, (t[n - 1] - t[0]) / max(n - 1, 1))
    dt_corr = max(1.0, (200.0 / dt_avg_ms) ** 2)
    jerk_scale = (peak_velocity or 1) * 50 * dt_corr
    smoothness_index = _js_round(_clamp01(1 - mean_jerk / jerk_scale))

    # tremorIndex: частота смен направления скорости выше адаптивного порога.
    # Использует сглаженную скорость — исключает смены знака от шума датчика.
    # Оба соседних семпла должны превышать порог, чтобы отфильтровать одиночные шумовые пики.
    PAUSE_VEL = 8
    tremor_threshold = max(PAUSE_VEL * 3.0, mean_abs_velocity * 0.4)
    tremor_changes = 0
    for i in range(1, len(vel)):
        if (abs(vel[i]) > tremor_threshold and abs(vel[i - 1]) > tremor_threshold
                and vel[i - 1] != 0 and _sign(vel[i]) != _sign(vel[i - 1])):
            tremor_changes += 1
    tremor_reversals_per_sec = tremor_changes / duration_sec if duration_sec > 0 else 0
    tremor_index = _js_round(_clamp01(tremor_reversals_per_sec / TREMOR_NORM_HZ))

    # Частотный анализ дрожи (по сырому углу): доминирующая частота + доля мощности в полосе.
    tremor_freq_hz, tremor_power = _spectral_tremor(a, t)

    paused = len([v for v in abs_vel if v < PAUSE_VEL])
    pause_ratio = _js_round(paused / len(abs_vel))

    dir_changes = 0
    for i in range(1, len(vel)):
        if vel[i - 1] != 0 and _sign(vel[i]) != _sign(vel[i - 1]) and abs(vel[i]) > PAUSE_VEL:
            dir_changes += 1
    repetitions = dir_changes // 2

    return {
        "sampleCount": n,
        "durationSec": _js_round(duration_sec, 1),
        "rom": _js_round(rom, 2),
        "minAngle": _js_round(min_angle, 2),
        "maxAngle": _js_round(max_angle, 2),
        "meanAbsVelocity": _js_round(mean_abs_velocity, 2),
        "peakVelocity": _js_round(peak_velocity, 2),
        "meanJerk": _js_round(mean_jerk, 2),
        "smoothnessIndex": smoothness_index,
        "tremorIndex": tremor_index,
        "tremorFreqHz": _js_round(tremor_freq_hz, 1),
        "tremorPower": _js_round(tremor_power, 3),
        "symmetryIndex": symmetry_index,
        "pauseRatio": pause_ratio,
        "repetitions": repetitions,
        "activeTimeSec": active_time_sec,
        "valid": True,
    }
