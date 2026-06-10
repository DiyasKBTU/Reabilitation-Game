from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mongo_uri: str = "mongodb://localhost:27017/rehabgame"
    jwt_secret: str = "dev-secret-change-in-production"
    jwt_expire_days: int = 30
    allowed_origins: str = "http://localhost:5173,http://localhost:5500,http://localhost:3000"
    admin_username: str = "admin"
    admin_email: str = "admin@example.com"
    admin_password: str = ""
    version: str = "1.0.0"

    # ── Демо-режим (показ инвесторам) ──
    # true → на старте засеваются демо-врач, демо-пациент и пациенты с готовыми сессиями
    # (идемпотентно), а на странице входа появляются кнопки быстрого входа.
    # false → чистая база без демо-данных и кнопок.
    demo_mode: bool = False

    # ── LLM-explainer (клиническое заключение поверх посчитанных метрик) ──
    # По умолчанию ВЫКЛЮЧЕН → используется детерминированный шаблон (без сети/ключа).
    # LLM только перефразирует уже посчитанные числа, не вводит новых (см. ML_SPEC §3.4).
    llm_enabled: bool = False
    llm_provider: str = "none"          # none | openai | claude
    llm_model: str = "gpt-4o-mini"      # для claude напр. claude-haiku-4-5-20251001
    llm_api_key: str = ""
    llm_timeout_sec: float = 15.0

    @property
    def origins_list(self) -> List[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
