from datetime import datetime, timezone
from typing import Optional
from beanie import Document, PydanticObjectId
from pydantic import Field


class Patient(Document):
    user_id: Optional[PydanticObjectId] = None
    doctor_id: Optional[PydanticObjectId] = None
    full_name: str
    diagnosis: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    # Провенанс импорта: source="firebase", source_id = ключ пациента в RTDB.
    # Нужны для идемпотентности импорта (не плодить дубли при повторном запуске).
    source: Optional[str] = None
    source_id: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "patients"
        indexes = ["user_id", "doctor_id", "source_id"]
