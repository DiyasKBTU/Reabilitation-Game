"""
Гард качества сессии: отделяет реальное движение от «пустых прогонов».

Проблема: если игру (Game2D/Game3D) запустить и не управлять, машина/платформа
разбивается, срабатывает onGameOver и сохраняется сессия с ROM≈0 и почти нулевыми
признаками. Клинического смысла она не несёт, но как самая свежая доминирует в
дашборде врача (последняя сессия), портит baseline аномалий и наклон трендов.

Решение: НЕ удаляя сырой ряд (CLAUDE.md запрещает удалять imu_time_series), помечаем
такую сессию `features.valid=False`. Это зеркалит логику `ingest/firebase.py`, где
сессии game1 с ROM=0 тоже помечаются `valid=False` — там по агрегатам, здесь по
живому ряду IMU.

Это НЕ извлечение признаков: отдельный слой поверх готового вектора, поэтому паритет
`features.py` ↔ `ml-service/app/features.py` не затрагивается (см. CLAUDE.md, правило 3).
"""
from __future__ import annotations
from typing import Any, Dict, Optional

# Пороги «реального движения» для ПОЛНОГО вектора признаков (живой ряд IMU).
ROM_MIN_DEG = 5.0        # ниже — кисть фактически не двигалась (шум датчика на месте)
MIN_SAMPLE_COUNT = 10    # меньше семплов — анализировать нечего (= минимум для спектра)
MIN_DURATION_SEC = 3.0   # короче — мгновенный game over без игры


def has_real_movement(features: Optional[Dict[str, Any]]) -> bool:
    """Полный вектор признаков описывает реальное движение, а не пустой прогон?

    True только если амплитуда И объём данных И длительность выше порогов.
    К частичным признакам (агрегаты Firebase, sampleCount=0) НЕ применять — см.
    `is_analyzable`, где они обрабатываются отдельно.
    """
    if not features:
        return False
    rom = features.get("rom") or 0
    samples = features.get("sampleCount") or 0
    duration = features.get("durationSec") or 0
    return rom >= ROM_MIN_DEG and samples >= MIN_SAMPLE_COUNT and duration >= MIN_DURATION_SEC


def mark_validity(features: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Проставляет `features['valid']` по гарду движения — для записи сессии.

    Применять только к ПОЛНЫМ признакам (`extract_features` живого ряда). Мутирует и
    возвращает тот же словарь; `None` пробрасывается как `None`. Сырой ряд сессии при
    этом сохраняется — невалидной считается только аналитика, не данные.
    """
    if not features:
        return features
    features["valid"] = bool(features.get("valid", False)) and has_real_movement(features)
    return features


def is_analyzable(features: Optional[Dict[str, Any]]) -> bool:
    """Пригодна ли сессия для аналитики (выбор последней, baseline аномалий, тренды)?

    - нет признаков / `valid` снят → нет;
    - частичные (агрегаты Firebase, ROM-only) → доверяем их `valid` (sampleCount=0 законен);
    - полные (живой ряд IMU) → требуем реального движения (гард выше).

    Работает и на старых сессиях, записанных до гарда (`valid=True`, ROM≈0): они
    отбраковываются на чтении, без миграции данных.
    """
    if not features or not features.get("valid"):
        return False
    if features.get("partial"):
        return True
    return has_real_movement(features)
