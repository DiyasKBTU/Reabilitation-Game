from datetime import datetime, timezone
from typing import Literal
from beanie import Document
from pymongo import IndexModel, ASCENDING
from pydantic import Field


class User(Document):
    username: str
    email: str
    password_hash: str
    role: Literal["patient", "doctor", "admin"] = "patient"
    platform_access: bool = True
    database_access: bool = True
    # Тестовая учётка (создана админом для проверки/игры). Изолирована от реальных пациентов
    # (свой patient_id), помечается в UI и полностью удаляется через DELETE /admin/test-users.
    is_test: bool = False
    # Согласие на обработку персональных данных (дано при регистрации). Для медданных это
    # требование этики/безопасности; опционально (default False) — старые учётки не ломаются.
    consent: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "users"
        indexes = [
            IndexModel([("username", ASCENDING)], unique=True),
            IndexModel([("email", ASCENDING)], unique=True),
        ]
