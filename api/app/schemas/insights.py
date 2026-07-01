from pydantic import BaseModel
from typing import Any, Dict, Optional


class InsightsOut(BaseModel):
    features: Optional[Dict[str, Any]] = None
    # Признаки по вторичным осям управления (multi-axis): {ось: {"label": str, "features": {...}}}.
    # Дополнительная картина движения для врача; в модель аномалий/нарратив не входят.
    axis_features: Optional[Dict[str, Any]] = None
    anomaly: Optional[Dict[str, Any]] = None
    # Калибровка: персональная стартовая точка пациента (baseline) и прогресс относительно неё.
    # baseline = {session_id, features, calibrated_at, game_name}; delta_vs_baseline —
    # по ключевым метрикам {metric: {baseline, current, change, changePct, improved}}.
    baseline: Optional[Dict[str, Any]] = None
    delta_vs_baseline: Optional[Dict[str, Any]] = None
    recommendations: Optional[Dict[str, Any]] = None
    trends: Optional[Dict[str, Any]] = None
    narrative: Optional[Dict[str, Any]] = None
    # Паттерн движения (мультиклассовый классификатор, синтетика): {label, labelRu, confidence,
    # probs, ...}. Подсказка паттерна для врача, НЕ диагноз. None для partial/невалидных сессий.
    pattern: Optional[Dict[str, Any]] = None
    alerts: list = []
    game_type: str = "game1"
    session_count: int = 0
