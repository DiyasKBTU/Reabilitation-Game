from datetime import datetime, timezone
from typing import Optional, Dict, Any
from beanie import Document, PydanticObjectId
from pydantic import Field


class Patient(Document):
    user_id: Optional[PydanticObjectId] = None
    doctor_id: Optional[PydanticObjectId] = None
    full_name: str
    # ИИН (12 цифр) — национальный идентификатор ребёнка. Служит ЛОГИНОМ пациента (User.username =
    # iin), поэтому не забывается. Опционален → старые карточки/тест-данные не ломаются.
    iin: Optional[str] = None
    diagnosis: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    # Калибровка: персональная стартовая точка по каждой игре {game_type: baseline}.
    # baseline = {session_id, features, calibrated_at, game_name}. Первая аналитически
    # пригодная сессия в игре фиксируется как калибровочная (см. api/app/calibration.py);
    # прогресс пациента считается ОТНОСИТЕЛЬНО неё (важно для ДЦП — «норма» у каждого своя).
    # Опционально → старые карточки не ломаются, baseline бэкфиллится из ранней сессии на лету.
    baselines: Dict[str, Any] = Field(default_factory=dict)
    # Провенанс импорта: source="firebase", source_id = ключ пациента в RTDB.
    # Нужны для идемпотентности импорта (не плодить дубли при повторном запуске).
    source: Optional[str] = None
    source_id: Optional[str] = None
    # Тестовая карта (создана админом для проверки). Реальных пациентов не затрагивает.
    is_test: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "patients"
        indexes = ["user_id", "doctor_id", "source_id"]
