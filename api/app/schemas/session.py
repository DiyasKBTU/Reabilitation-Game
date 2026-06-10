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
    label: Optional[Dict[str, Any]] = None
    created_at: datetime
