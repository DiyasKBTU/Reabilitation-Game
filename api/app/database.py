from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient
from .config import settings


_client: AsyncIOMotorClient | None = None


async def connect_db():
    global _client
    from .models.user import User
    from .models.patient import Patient
    from .models.session import Session
    from .models.score import Score
    from .models.invite import DoctorInvite

    _client = AsyncIOMotorClient(settings.mongo_uri)
    db_name = settings.mongo_uri.rsplit("/", 1)[-1].split("?")[0]
    await init_beanie(
        database=_client[db_name],
        document_models=[User, Patient, Session, Score, DoctorInvite],
    )


async def close_db():
    if _client:
        _client.close()
