from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from beanie import Document, PydanticObjectId
from pydantic import Field


class Session(Document):
    patient_id: PydanticObjectId
    doctor_id: Optional[PydanticObjectId] = None
    game_type: str = "game1"
    game_name: str = "Space Catcher"
    score: int = 0
    max_combo: int = 0
    zone_hits: int = 0
    duration_sec: float = 0.0
    level: int = 1
    imu_time_series: List[Dict[str, Any]] = Field(default_factory=list)
    features: Optional[Dict[str, Any]] = None
    # Признаки по вторичным осям управления (multi-axis игры, напр. pitch в City Driver):
    # {ось: feature-словарь extract_features}. Первичная ось хранится в `features` и идёт в модель;
    # эти оси — дополнительная картина для врача, в модель аномалий НЕ подаются. Опционально → старые
    # сессии не ломаются. См. api/app/ml/games.py:SECONDARY_AXES.
    axis_features: Optional[Dict[str, Any]] = None
    label: Optional[Dict[str, Any]] = None
    # Агрегаты устройства из Firebase (strengthIndex, movementCount, enduranceSec,
    # финальный снимок углов). Не используются ML напрямую, но сохраняются для отображения
    # и как сырые данные на будущее (CLAUDE.md: не удалять сырые данные).
    device_metrics: Optional[Dict[str, Any]] = None
    # Провенанс импорта: source="firebase", source_id = ключ сессии в RTDB.
    # Идемпотентность: повторный импорт того же экспорта не создаёт дубли.
    source: Optional[str] = None
    source_id: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "sessions"
        indexes = ["patient_id", "game_type", "created_at", "source_id"]
