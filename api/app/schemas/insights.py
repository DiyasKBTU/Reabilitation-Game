from pydantic import BaseModel
from typing import Any, Dict, Optional


class InsightsOut(BaseModel):
    features: Optional[Dict[str, Any]] = None
    # Признаки по вторичным осям управления (multi-axis): {ось: {"label": str, "features": {...}}}.
    # Дополнительная картина движения для врача; в модель аномалий/нарратив не входят.
    axis_features: Optional[Dict[str, Any]] = None
    anomaly: Optional[Dict[str, Any]] = None
    recommendations: Optional[Dict[str, Any]] = None
    trends: Optional[Dict[str, Any]] = None
    narrative: Optional[Dict[str, Any]] = None
    alerts: list = []
    game_type: str = "game1"
    session_count: int = 0
