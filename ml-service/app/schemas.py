"""
Контракт ML-сервиса (pydantic). Эти схемы — формальное описание границы
между Node-бэкендом и ML-сервисом. Подробности в docs/ML_CONTRACT.md.
"""
from __future__ import annotations
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class IMUSample(BaseModel):
    t: float = Field(..., description="мс от старта")
    r: float = Field(0, description="roll, °")
    p: float = Field(0, description="pitch, °")
    y: float = Field(0, description="yaw, °")


class FeaturesRequest(BaseModel):
    imuTimeSeries: List[IMUSample]
    axis: str = "r"


class PredictRequest(BaseModel):
    """Признаки текущей сессии + история (опц.) + тренды (опц.)."""
    features: Optional[Dict[str, Any]] = None
    imuTimeSeries: Optional[List[IMUSample]] = None  # альтернатива: посчитать признаки на лету
    history: List[Dict[str, Any]] = []
    trends: Dict[str, Any] = {}
    axis: str = "r"


class PredictResponse(BaseModel):
    features: Dict[str, Any]
    anomaly: Dict[str, Any]
    recommendations: Dict[str, Any]
    modelVersion: str = "rules-1.0"
