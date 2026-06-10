from datetime import datetime, timezone
from beanie import Document, PydanticObjectId
from pydantic import Field


class Score(Document):
    patient_id: PydanticObjectId
    username: str
    game_type: str = "game1"
    score: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "scores"
        indexes = ["game_type", "score", "created_at"]
