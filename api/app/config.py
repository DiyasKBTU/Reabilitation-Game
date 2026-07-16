from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

# Небезопасный дефолт JWT-секрета: с ним токены подделываемы. В проде ОБЯЗАН быть переопределён
# через переменную окружения JWT_SECRET (см. is_default_secret и fail-fast в main.py).
DEFAULT_JWT_SECRET = "dev-secret-change-in-production"

# Минимальная длина боевого JWT-секрета (короче — токены проще подобрать перебором).
MIN_JWT_SECRET_LEN = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Окружение развёртывания: dev | staging | prod.
    # В prod включается fail-fast на небезопасную конфигурацию (см. production_security_errors).
    app_env: str = "dev"

    mongo_uri: str = "mongodb://localhost:27017/rehabgame"
    jwt_secret: str = DEFAULT_JWT_SECRET
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

    @property
    def is_default_secret(self) -> bool:
        """JWT-секрет всё ещё дефолтный (небезопасно для прод-развёртывания)?"""
        return self.jwt_secret == DEFAULT_JWT_SECRET

    @property
    def is_production(self) -> bool:
        """Боевое окружение (APP_ENV=prod|production)? Включает fail-fast проверки."""
        return self.app_env.strip().lower() in {"prod", "production"}

    def production_security_errors(self) -> List[str]:
        """Фатальные проблемы конфигурации для боевого развёртывания (пусто = можно стартовать).

        Проверяется в main.py при APP_ENV=prod: приложение НЕ поднимается с небезопасными
        настройками (лучше явный отказ старта, чем тихо работающий уязвимый сервер).
        """
        errors: List[str] = []
        if self.is_default_secret:
            errors.append(
                "JWT_SECRET использует небезопасный дефолт — задайте случайный секрет "
                f"минимум {MIN_JWT_SECRET_LEN} символов (напр. `openssl rand -base64 48`)."
            )
        elif len(self.jwt_secret) < MIN_JWT_SECRET_LEN:
            errors.append(
                f"JWT_SECRET короче {MIN_JWT_SECRET_LEN} символов — токены проще подобрать перебором."
            )
        if self.demo_mode:
            errors.append(
                "DEMO_MODE=true в проде создаёт учётки со слабыми паролями (demo1234) — отключите."
            )
        return errors


settings = Settings()
