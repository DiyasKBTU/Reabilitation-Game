from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


class IMUSample(BaseModel):
    t: float
    r: float = 0.0
    p: float = 0.0
    y: float = 0.0


class SessionCreate(BaseModel):
    patient_id: Optional[str] = None
    score: int = 0
    max_combo: int = 0
    zone_hits: int = 0
    duration_sec: float = 0.0
    level: int = 1
    game_type: str = "game1"
    game_name: str = "Space Catcher"
    # Направляемая калибровка: клиент явно помечает сессию как калибровочную → её признаки
    # становятся (перезаписывают) персональный baseline пациента. См. api/app/calibration.py.
    is_calibration: bool = False
    # Метрики калибровки (2 оси + точность/реакция), посчитанные на клиенте. Опционально.
    calibration: Optional[Dict[str, Any]] = None
    # Игровые метрики реакции на препятствия (City Driver): {reactionMs, avoidanceRate, hazardCount}.
    performance: Optional[Dict[str, Any]] = None
    imu_time_series: List[Dict[str, Any]] = []


class SessionLabelIn(BaseModel):
    pain: Optional[int] = None
    fatigue: Optional[int] = None
    quality: Optional[int] = None


class SessionOut(BaseModel):
    id: str
    patient_id: str
    game_type: str
    game_name: str
    score: int
    max_combo: int
    zone_hits: int
    duration_sec: float
    level: int
    features: Optional[Dict[str, Any]] = None
    performance: Optional[Dict[str, Any]] = None
    label: Optional[Dict[str, Any]] = None
    is_calibration: bool = False
    created_at: datetime
