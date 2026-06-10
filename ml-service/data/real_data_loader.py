"""
Загрузчик реальных IMU-датасетов для обучения модели аномалий.

ИСТОЧНИК: PAMAP2 Physical Activity Monitoring (UCI ML Repository, ID=231)
  - 9 участников, ИМУ на запястье (кисть), груди, лодыжке
  - Гироскоп запястья → интегрируем → угол наклона → roll-ряд
  - Квернион запястья → roll напрямую (точнее)
  - Лицензия: CC BY 4.0
  - DOI: 10.24432/C5NW2H

КАК РАБОТАЕТ:
  1. Скачивает PAMAP2 через ucimlrepo (≈80 MB, автоматически).
  2. Из кватерниона запястья вычисляет roll(°) в каждый момент времени.
  3. Нарезает на окна длиной WINDOW_SEC с перекрытием STEP_SEC.
  4. Из каждого окна извлекает features (тот же алгоритм, что в продакшне).
  5. «Нормальные» окна → label=0, деградированные копии → label=1.

АЛЬТЕРНАТИВНЫЙ ИСТОЧНИК (если ucimlrepo недоступен):
  Скачать вручную: https://archive.ics.uci.edu/dataset/231
  Распаковать в ml-service/data/pamap2/PAMAP2_Dataset/Protocol/
  Затем set USE_LOCAL=True ниже.
"""

from __future__ import annotations
import math
import os
import random
from typing import List, Tuple, Dict, Any, Optional

import numpy as np

# Путь для кэша / локальных файлов
_DATA_DIR = os.path.dirname(os.path.abspath(__file__))
_PAMAP2_LOCAL = os.path.join(_DATA_DIR, "pamap2")

# Параметры сегментации
WINDOW_SEC   = 30    # длина одного «окна» (сессии) в секундах
STEP_SEC     = 15    # шаг окна (50% перекрытие)
SAMPLE_HZ    = 100   # частота дискретизации PAMAP2
SCALE_TO_HZ  = 25   # прореживаем до ~25 Гц (близко к устройству пациента)

# Активности с существенным движением запястья (коды PAMAP2)
ACTIVE_ACTIVITIES = {4, 5, 6, 7, 12, 13, 16, 17, 20, 24}

# Индексы колонок в PAMAP2 .dat файлах (0-indexed)
# 0: timestamp, 1: activityID, 2: heart_rate
# 3: hand_temp
# 4-6: hand_acc16 (x,y,z) [m/s²]
# 7-9: hand_acc6  (x,y,z) [m/s²]
# 10-12: hand_gyro (x,y,z) [rad/s]
# 13-15: hand_mag  (x,y,z) [µT]
# 16-19: hand_orient (W,X,Y,Z) кватернион
COL_TIMESTAMP = 0
COL_ACTIVITY  = 1
COL_HAND_GYRO_X = 10  # рад/с
COL_HAND_GY_Y   = 11
COL_HAND_GY_Z   = 12
COL_HAND_ORI_W  = 16
COL_HAND_ORI_X  = 17
COL_HAND_ORI_Y  = 18
COL_HAND_ORI_Z  = 19


# ─── Кватернион → roll (°) ─────────────────────────────────────────────────

def _quat_to_roll(w: float, x: float, y: float, z: float) -> float:
    """Roll (вращение вокруг оси X) из кватерниона в градусах."""
    sinr_cosp = 2.0 * (w * x + y * z)
    cosr_cosp = 1.0 - 2.0 * (x * x + y * y)
    return math.degrees(math.atan2(sinr_cosp, cosr_cosp))


def _gyro_integrate_roll(gyro_x: List[float], timestamps_sec: List[float]) -> List[float]:
    """Запасной вариант: интегрируем гироскоп по оси X → угол в градусах."""
    angles = [0.0]
    for i in range(1, len(gyro_x)):
        dt = max(0.001, timestamps_sec[i] - timestamps_sec[i - 1])
        angles.append(angles[-1] + math.degrees(gyro_x[i] * dt))
    return angles


# ─── Парсер .dat файлов PAMAP2 ─────────────────────────────────────────────

def _parse_dat(filepath: str) -> Optional[np.ndarray]:
    """Читает .dat файл PAMAP2 в numpy-матрицу, пропускает строки с NaN."""
    try:
        data = np.genfromtxt(filepath, delimiter=" ")
        # Убираем строки, где хотя бы одна из нужных колонок = NaN
        cols = [COL_TIMESTAMP, COL_ACTIVITY,
                COL_HAND_GYRO_X, COL_HAND_GY_Y, COL_HAND_GY_Z,
                COL_HAND_ORI_W, COL_HAND_ORI_X, COL_HAND_ORI_Y, COL_HAND_ORI_Z]
        mask = ~np.any(np.isnan(data[:, cols]), axis=1)
        return data[mask]
    except Exception as e:
        print(f"  ⚠ Ошибка чтения {filepath}: {e}")
        return None


# ─── Конвертация окна PAMAP2 → imuTimeSeries ──────────────────────────────

def _window_to_series(rows: np.ndarray, use_quat: bool = True) -> List[Dict[str, float]]:
    """
    Из среза матрицы PAMAP2 строим список [{t, r, p, y}, ...] —
    формат imuTimeSeries, совместимый с extract_features().
    p (pitch) и y (yaw) ставим в 0 — нас интересует только roll (r).
    """
    series = []
    step = max(1, SAMPLE_HZ // SCALE_TO_HZ)  # прореживание
    t0 = rows[0, COL_TIMESTAMP]

    for i in range(0, len(rows), step):
        row = rows[i]
        t_ms = (row[COL_TIMESTAMP] - t0) * 1000.0

        if use_quat and not np.any(np.isnan(
                [row[COL_HAND_ORI_W], row[COL_HAND_ORI_X],
                 row[COL_HAND_ORI_Y], row[COL_HAND_ORI_Z]])):
            roll = _quat_to_roll(row[COL_HAND_ORI_W], row[COL_HAND_ORI_X],
                                  row[COL_HAND_ORI_Y], row[COL_HAND_ORI_Z])
        else:
            # fallback: накопленный угол от предыдущей точки
            roll = float(row[COL_HAND_GYRO_X]) * (1.0 / SCALE_TO_HZ) * 180.0 / math.pi

        series.append({"t": t_ms, "r": round(roll, 3), "p": 0.0, "y": 0.0})

    return series


# ─── Создание «аномальных» копий ──────────────────────────────────────────

def _degrade_series(series: List[Dict[str, float]], rng: random.Random) -> List[Dict[str, float]]:
    """
    Моделируем сессию с болью/усталостью:
    — ROM сжимается, — добавляем тремор, — вставляем паузы, — замедляем.
    """
    if len(series) < 5:
        return series

    # Параметры деградации
    rom_scale   = rng.uniform(0.3, 0.6)    # ROM уменьшается до 30–60%
    tremor_amp  = rng.uniform(2.0, 6.0)    # тремор в градусах
    tremor_freq = rng.uniform(4.0, 8.0)    # Гц
    pause_prob  = rng.uniform(0.2, 0.4)    # вероятность паузы

    mid = sum(s["r"] for s in series) / len(series)  # смещение (центр)
    degraded = []
    last_r = series[0]["r"]

    for i, s in enumerate(series):
        t_sec = s["t"] / 1000.0
        # Сжимаем ROM вокруг центра
        r = mid + (s["r"] - mid) * rom_scale
        # Добавляем тремор
        r += tremor_amp * math.sin(2 * math.pi * tremor_freq * t_sec)
        # Вставляем паузы (застывание)
        if rng.random() < pause_prob:
            r = last_r  # не двигается
        last_r = r
        degraded.append({"t": s["t"], "r": round(r, 3), "p": 0.0, "y": 0.0})

    return degraded


# ─── Загрузка через ucimlrepo ─────────────────────────────────────────────

def _load_via_ucimlrepo() -> Optional[List[np.ndarray]]:
    """Скачивает PAMAP2 через API ucimlrepo. Возвращает список numpy-матриц."""
    try:
        from ucimlrepo import fetch_ucirepo  # type: ignore
        print("📥 Загрузка PAMAP2 через ucimlrepo (≈80 MB, первый раз)...")
        dataset = fetch_ucirepo(id=231)
        # dataset.data.features — большой DataFrame
        # Нам нужно разбить по subject'ам и сессиям
        # ucimlrepo возвращает данные без разбивки по файлам,
        # поэтому обращаемся напрямую к оригинальным файлам из кэша
        cache_dir = os.path.expanduser("~/.cache/ucimlrepo/231")
        return _load_local_dat(cache_dir)
    except Exception as e:
        print(f"  ⚠ ucimlrepo недоступен: {e}")
        return None


def _load_local_dat(base_dir: str) -> Optional[List[np.ndarray]]:
    """Ищет .dat файлы в директории и загружает их."""
    subjects = []
    for root, dirs, files in os.walk(base_dir):
        for fname in sorted(files):
            if fname.endswith(".dat") and "subject" in fname.lower():
                mat = _parse_dat(os.path.join(root, fname))
                if mat is not None and len(mat) > WINDOW_SEC * SAMPLE_HZ:
                    subjects.append(mat)
                    print(f"  ✅ {fname}: {len(mat)} строк")
    return subjects if subjects else None


# ─── Основная функция: создать датасет ────────────────────────────────────

def make_real_dataset(
    max_windows_per_subject: int = 50,
    anomaly_ratio: float = 0.35,
    seed: int = 42,
) -> Tuple[List[List[Dict]], List[int]]:
    """
    Возвращает (series_list, labels):
      series_list[i] = [{t, r, p, y}, ...] — одна «сессия»
      labels[i]      = 0 (норма) | 1 (аномалия)

    Сначала пробует загрузить PAMAP2, при ошибке — возвращает ([], []).
    """
    rng = random.Random(seed)
    np.random.seed(seed)

    # Пробуем локальные данные
    subjects = None
    if os.path.isdir(_PAMAP2_LOCAL):
        print(f"📂 Ищу локальные данные PAMAP2 в {_PAMAP2_LOCAL}...")
        subjects = _load_local_dat(_PAMAP2_LOCAL)

    # Пробуем ucimlrepo
    if not subjects:
        subjects = _load_via_ucimlrepo()

    if not subjects:
        print("⚠ Реальные данные недоступны — используется синтетика.")
        return [], []

    print(f"✅ Загружено {len(subjects)} файлов PAMAP2.")

    window_size = WINDOW_SEC * SAMPLE_HZ
    step_size   = STEP_SEC  * SAMPLE_HZ

    all_series: List[List[Dict]] = []
    all_labels: List[int]        = []

    for mat in subjects:
        # Берём только активные периоды
        active_mask = np.isin(mat[:, COL_ACTIVITY], list(ACTIVE_ACTIVITIES))
        active_idx  = np.where(active_mask)[0]

        windows_this = 0
        i = 0
        while i + window_size <= len(active_idx) and windows_this < max_windows_per_subject:
            slice_idx = active_idx[i: i + window_size]
            # Проверяем непрерывность (нет больших пропусков)
            if slice_idx[-1] - slice_idx[0] > window_size * 1.2:
                i += step_size
                continue

            rows   = mat[slice_idx[0]: slice_idx[-1] + 1]
            series = _window_to_series(rows)

            if len(series) < 20:
                i += step_size
                continue

            # Нормальное окно
            all_series.append(series)
            all_labels.append(0)

            # Аномальная копия (с вероятностью anomaly_ratio)
            if rng.random() < anomaly_ratio:
                all_series.append(_degrade_series(list(series), rng))
                all_labels.append(1)

            windows_this += 1
            i += step_size

    print(f"✅ Датасет PAMAP2: {all_labels.count(0)} норм. / {all_labels.count(1)} аном. окон")
    return all_series, all_labels


# ─── Быстрая проверка (запустить напрямую) ─────────────────────────────────

if __name__ == "__main__":
    series_list, labels = make_real_dataset(max_windows_per_subject=10)
    if series_list:
        print(f"Пример окна (первые 3 точки): {series_list[0][:3]}")
        print(f"Метка: {labels[0]}")
    else:
        print("Данные не загружены. Установите ucimlrepo: pip install ucimlrepo")
        print("Или скачайте вручную: https://archive.ics.uci.edu/dataset/231")
