"""
Калибровочная сессия и персональный baseline.

Идея: ПЕРВАЯ аналитически пригодная сессия пациента в данной игре фиксируется как
«калибровочная» — её признаки становятся персональной стартовой точкой (baseline).
Дальше прогресс показывается ОТНОСИТЕЛЬНО этой точки (delta_vs_baseline). Для детей с
ДЦП это принципиально: «норма» у каждого своя, абсолютные градусы между детьми
несравнимы, а вот собственный рост от старта — честный и мотивирующий показатель.
Заодно первая сессия служит проверкой, что датчик подключён и данные реально идут.

baseline хранится на `Patient.baselines[game_type]`. Поле добавлено позже, поэтому для
существующих карточек baseline БЭКФИЛЛИТСЯ из самой ранней пригодной сессии на лету —
миграция данных не нужна.
"""
from __future__ import annotations
from typing import Any, Dict, Optional

from .models.patient import Patient
from .models.session import Session
from .ml.validity import is_analyzable

# Метрики прогресса относительно старта и направление «улучшения»:
#   up   — рост = улучшение (амплитуда, плавность, скорость)
#   down — снижение = улучшение (тремор, паузы)
BASELINE_METRICS = {
    "rom":             "up",
    "smoothnessIndex": "up",
    "peakVelocity":    "up",
    "tremorIndex":     "down",
    "pauseRatio":      "down",
}


async def ensure_baseline(patient: Patient, game_type: str) -> Optional[Dict[str, Any]]:
    """baseline пациента для игры; при отсутствии — фиксирует самую раннюю пригодную
    сессию как калибровочную и сохраняет её признаки. Идемпотентно, возвращает baseline
    или None (если ни одной пригодной сессии ещё нет)."""
    baselines = dict(patient.baselines or {})
    if game_type in baselines:
        return baselines[game_type]

    # Самая ранняя АНАЛИТИЧЕСКИ ПРИГОДНАЯ сессия = персональная точка отсчёта.
    # Сессии с клавиатуры/без входа (input_source не датчик) пропускаем: их ряд углов
    # синтезирован и точкой отсчёта реального движения быть не может. None = старый клиент.
    sessions = (
        await Session.find({"patient_id": patient.id, "game_type": game_type})
        .sort("+created_at")
        .to_list()
    )
    cal = next((s for s in sessions
                if is_analyzable(s.features) and s.input_source in (None, "ble")), None)
    if cal is None:
        return None

    baseline = {
        "session_id":    str(cal.id),
        "features":      cal.features,
        "calibrated_at": cal.created_at.isoformat(),
        "game_name":     cal.game_name,
    }
    baselines[game_type] = baseline
    await patient.set({"baselines": baselines})
    if not cal.is_calibration:
        await cal.set({"is_calibration": True})
    return baseline


async def set_baseline_from_session(patient: Patient, session: Session) -> Dict[str, Any]:
    """Явно назначает сессию калибровочной и ПЕРЕЗАПИСЫВАЕТ baseline пациента по ней.

    Для направляемой калибровки («поверни до упора влево/вправо») и ре-калибровки —
    например, после смены датчика, когда прежняя точка отсчёта больше не сопоставима.
    В отличие от ensure_baseline (ставит только при отсутствии), здесь baseline заменяется.
    """
    baselines = dict(patient.baselines or {})
    baselines[session.game_type] = {
        "session_id":    str(session.id),
        "features":      session.features,
        "calibrated_at": session.created_at.isoformat(),
        "game_name":     session.game_name,
        "guided":        True,
        # Метрики 2-осевой калибровки (диапазоны, точность) — для отображения врачу.
        "metrics":       session.calibration,
    }
    await patient.set({"baselines": baselines})
    if not session.is_calibration:
        session.is_calibration = True
        await session.set({"is_calibration": True})
    return baselines[session.game_type]


def compute_deltas(
    current: Optional[Dict[str, Any]],
    baseline_features: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Изменение текущей сессии относительно калибровочной по ключевым метрикам.
    На метрику: старт, сейчас, абс. изменение, % изменения, улучшение(bool)."""
    out: Dict[str, Any] = {}
    if not current or not baseline_features:
        return out
    for key, good in BASELINE_METRICS.items():
        base, cur = baseline_features.get(key), current.get(key)
        if base is None or cur is None:
            continue
        base, cur = float(base), float(cur)
        change = cur - base
        pct = (change / abs(base) * 100) if base else 0.0
        improved = (change > 0) if good == "up" else (change < 0)
        out[key] = {
            "baseline":  round(base, 3),
            "current":   round(cur, 3),
            "change":    round(change, 3),
            "changePct": round(pct, 1),
            "improved":  improved,
        }
    return out
