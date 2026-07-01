from datetime import datetime, timezone
from typing import Optional
from beanie import Document, PydanticObjectId
from pymongo import IndexModel, ASCENDING
from pydantic import Field


class DoctorInvite(Document):
    """Одноразовый код-приглашение для регистрации врача (B2B-онбординг).

    Админ/центр генерирует код и передаёт врачу. Врач регистрируется по коду
    через POST /auth/register-doctor и сразу получает роль doctor. Пациент без
    кода врачом стать не может. После использования код помечается used_*.
    """
    code: str
    created_by: PydanticObjectId          # админ, выпустивший код
    used_by: Optional[PydanticObjectId] = None   # врач, использовавший код
    used_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "doctor_invites"
        indexes = [
            IndexModel([("code", ASCENDING)], unique=True),
        ]
