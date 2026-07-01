"""
Генератор синтетических IMU-сессий — «тёплый старт» до накопления
реальных данных. НЕ заменяет реальные данные пациентов.

v3 (2026-06-25): ретаргет на ДЦП (детский церебральный паралич). Профили аномалий
переписаны под формы ДЦП вместо инсульт/Паркинсон:
  - Спастическая форма (повышенный тонус: малый ROM, рывковость, замедленность)
  - Гемипарез (односторонняя слабость → выраженная асимметрия)
  - Дискинетическая форма (непроизвольные медленные колебания, переменная амплитуда)
  - Атаксическая форма (нарушение координации, интенционный тремор, низкая плавность)
Нормальные/пограничные профили сохранены (типично развивающийся ребёнок).

Параметры качественно моделируют известные характеристики моторики при ДЦП
(не точные клинические значения — синтетика для «тёплого старта», не для валидации):
  - Спастика: гипертонус → уменьшенная амплитуда и скорость, прерывистость движения
  - Гемипарез: одна сторона существенно ограничена → асимметрия > 40%
  - Дискинезия: атетоидные/хореиформные колебания, низкая частота (~1.5–3.5 Гц), вариативность
  - Атаксия: дисметрия и интенционный тремор (~3–5 Гц), плохая плавность, промахи мимо цели

v2 (2026-06-03): первые клинические профили (инсульт/Паркинсон) — заменены в v3.
"""

from __future__ import annotations
import math
import random
from typing import List, Dict, Any, Tuple


def make_session(
    rom: float = 50.0,
    freq_hz: float = 0.5,
    smooth: float = 0.95,
    tremor: float = 0.0,
    tremor_freq_hz: float = 6.0,
    asymmetry: float = 0.0,
    pause_frac: float = 0.0,
    dur_sec: float = 20.0,
    fs_hz: float = 25.0,
    fatigue_decay: float = 0.0,  # 0=нет деградации, 1=ROM падает вдвое к концу
    noise_sd: float = 0.5,       # шум датчика (°)
    seed: int | None = None,
) -> List[Dict[str, Any]]:
    """
    Возвращает imuTimeSeries = [{t, r, p, y}, ...] — одна сессия.

    fatigue_decay: моделирует нарастающую усталость — ROM уменьшается
    к концу сессии пропорционально этому коэффициенту.
    """
    rng = random.Random(seed)
    n = int(dur_sec * fs_hz)
    dt_ms = 1000.0 / fs_hz
    series = []

    # Асимметрия ∈ [-1,1]: 0 — симметрично, >0 ограничивает «минус»-сторону,
    # <0 — «плюс»-сторону. Раньше было (1 - asym*2) → при asym>0.5 amp_neg уходил
    # в МИНУС (менял знак), и профили _pain (0.25–0.55) / _asymmetry (0.42–0.70)
    # насыщались — severity-градиент терялся. Теперь амплитуды монотонно убывают к 0.
    asym_c = max(-1.0, min(1.0, asymmetry))
    amp_pos = rom / 2 * (1.0 + min(0.0, asym_c))   # asym<0 ограничивает «плюс»
    amp_neg = rom / 2 * (1.0 - max(0.0, asym_c))   # asym>0 ограничивает «минус»

    for i in range(n):
        t = i * dt_ms
        t_sec = t / 1000.0
        phase = 2 * math.pi * freq_hz * t_sec

        # Усталость: линейное затухание амплитуды
        decay = 1.0 - fatigue_decay * (i / max(n - 1, 1)) * 0.6
        base = math.sin(phase)
        r = (amp_pos * base if base >= 0 else amp_neg * base) * decay

        # Тремор (высокочастотная осцилляция ≈ 4–8 Гц)
        r += tremor * rom * 0.15 * math.sin(2 * math.pi * tremor_freq_hz * t_sec)

        # Рывковость (случайный высокочастотный шум)
        jitter = (1 - smooth) * rom * 0.25 * rng.gauss(0, 1)
        r += jitter

        # Шум датчика
        r += rng.gauss(0, noise_sd)

        # Паузы
        if rng.random() < pause_frac:
            r = series[-1]["r"] if series else 0.0

        series.append({"t": round(t, 1), "r": round(r, 3), "p": 0.0, "y": 0.0})

    return series


# ─── Клинические профили ───────────────────────────────────────────────────

def _normal_session(rng: random.Random) -> List[Dict]:
    """Нормальная сессия реабилитации — хороший диапазон, плавное движение."""
    return make_session(
        rom=rng.uniform(35, 65),
        smooth=rng.uniform(0.82, 0.97),
        tremor=rng.uniform(0.0, 0.12),
        tremor_freq_hz=rng.uniform(4.0, 8.0),
        asymmetry=rng.uniform(-0.12, 0.12),
        pause_frac=rng.uniform(0.0, 0.12),
        dur_sec=rng.uniform(15, 35),
        fatigue_decay=rng.uniform(0.0, 0.15),
        noise_sd=rng.uniform(0.3, 0.8),
        seed=rng.randint(0, 10**7),
    )


def _spastic_session(rng: random.Random) -> List[Dict]:
    """Спастическая форма ДЦП — гипертонус: малый ROM, рывковость, замедленность.

    Повышенный мышечный тонус ограничивает амплитуду и скорость, движение прерывистое
    (низкая плавность), нередко с лёгкой асимметрией поражённой стороны.
    """
    return make_session(
        rom=rng.uniform(12, 32),
        freq_hz=rng.uniform(0.25, 0.45),     # замедленное движение
        smooth=rng.uniform(0.30, 0.55),      # рывковость из-за гипертонуса
        tremor=rng.uniform(0.05, 0.20),
        asymmetry=rng.uniform(0.15, 0.45),
        pause_frac=rng.uniform(0.20, 0.45),
        fatigue_decay=rng.uniform(0.1, 0.4),
        noise_sd=rng.uniform(0.4, 1.0),
        seed=rng.randint(0, 10**7),
    )


def _hemiparesis_session(rng: random.Random) -> List[Dict]:
    """Гемипарез — односторонняя слабость: выраженная асимметрия движения."""
    return make_session(
        rom=rng.uniform(20, 45),
        freq_hz=rng.uniform(0.35, 0.55),
        smooth=rng.uniform(0.55, 0.82),
        tremor=rng.uniform(0.05, 0.22),
        asymmetry=rng.uniform(0.45, 0.75),   # одна сторона существенно ограничена
        pause_frac=rng.uniform(0.10, 0.30),
        noise_sd=rng.uniform(0.3, 0.9),
        seed=rng.randint(0, 10**7),
    )


def _dyskinetic_session(rng: random.Random) -> List[Dict]:
    """Дискинетическая форма — непроизвольные медленные колебания (атетоз/хорея).

    Колеблющийся тонус → переменная амплитуда, низкочастотные непроизвольные движения
    (~1.5–3.5 Гц), плохая плавность и высокая вариативность.
    """
    return make_session(
        rom=rng.uniform(25, 55),
        freq_hz=rng.uniform(0.30, 0.55),
        smooth=rng.uniform(0.25, 0.50),
        tremor=rng.uniform(0.40, 0.75),
        tremor_freq_hz=rng.uniform(1.5, 3.5),  # медленные атетоидные колебания
        asymmetry=rng.uniform(0.10, 0.40),
        pause_frac=rng.uniform(0.10, 0.30),
        noise_sd=rng.uniform(0.6, 1.6),         # высокая вариативность
        seed=rng.randint(0, 10**7),
    )


def _ataxic_session(rng: random.Random) -> List[Dict]:
    """Атаксическая форма — нарушение координации: интенционный тремор, дисметрия.

    Плохая координация → промахи мимо цели (переменная амплитуда), интенционный тремор
    (~3–5 Гц), низкая плавность движения.
    """
    return make_session(
        rom=rng.uniform(30, 55),
        freq_hz=rng.uniform(0.35, 0.55),
        smooth=rng.uniform(0.30, 0.55),
        tremor=rng.uniform(0.40, 0.70),
        tremor_freq_hz=rng.uniform(3.0, 5.0),   # интенционный тремор
        asymmetry=rng.uniform(0.05, 0.30),
        pause_frac=rng.uniform(0.10, 0.30),
        noise_sd=rng.uniform(0.5, 1.3),
        seed=rng.randint(0, 10**7),
    )


def _borderline_session(rng: random.Random) -> List[Dict]:
    """Пограничная норма — ниже идеала, но ещё не аномалия."""
    return make_session(
        rom=rng.uniform(28, 40),
        smooth=rng.uniform(0.65, 0.82),
        tremor=rng.uniform(0.10, 0.22),
        asymmetry=rng.uniform(0.10, 0.22),
        pause_frac=rng.uniform(0.12, 0.25),
        fatigue_decay=rng.uniform(0.05, 0.25),
        noise_sd=rng.uniform(0.4, 0.9),
        seed=rng.randint(0, 10**7),
    )


# ─── Основной генератор ─────────────────────────────────────────────────────

def make_labeled_dataset(
    n_normal: int = 300,
    n_abnormal: int = 200,
    seed: int = 42,
) -> List[Tuple[List[Dict], int]]:
    """
    Возвращает список (imuTimeSeries, label):
      label=0 — норма
      label=1 — аномалия (спастика / гемипарез / дискинезия / атаксия)

    Нормальные: ~70% хорошие + 30% пограничные (чтобы модель не переоптимизировалась).
    Аномальные: равномерно из 4 форм ДЦП.
    """
    rng = random.Random(seed)
    data: List[Tuple[List[Dict], int]] = []

    # Нормальные сессии
    n_good       = int(n_normal * 0.70)
    n_borderline = n_normal - n_good
    for _ in range(n_good):
        data.append((_normal_session(rng), 0))
    for _ in range(n_borderline):
        data.append((_borderline_session(rng), 0))

    # Аномальные сессии (4 формы ДЦП)
    profile_fns = [_spastic_session, _hemiparesis_session, _dyskinetic_session, _ataxic_session]
    per_profile = n_abnormal // len(profile_fns)
    remainder   = n_abnormal % len(profile_fns)
    for fn in profile_fns:
        count = per_profile + (1 if remainder > 0 else 0)
        remainder -= 1
        for _ in range(count):
            data.append((fn(rng), 1))

    rng.shuffle(data)
    return data


if __name__ == "__main__":
    import json
    ds = make_labeled_dataset()
    normals   = sum(1 for _, l in ds if l == 0)
    anomalies = sum(1 for _, l in ds if l == 1)
    print(f"Сгенерировано: {len(ds)} сессий ({normals} норм. / {anomalies} аном.)")
    print("Пример:", json.dumps(ds[0][0][:3], ensure_ascii=False))
