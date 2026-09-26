"""
Application configuration using Pydantic Settings.
Reads from environment variables and .env file.
"""
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database
    DATABASE_URL: str = "postgresql://wallet_user:wallet_password@localhost:5432/wallet_db"

    # JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # API
    API_V1_PREFIX: str = "/api/v1"
    PROJECT_NAME: str = "Wallet App API"
    DEBUG: bool = False

    # CORS
    ALLOWED_ORIGINS: str = "http://localhost:8081,http://localhost:19006,http://localhost:3000"

    # Exchange Rate API
    EXCHANGE_RATE_API_URL: str = "https://api.frankfurter.dev/v1"

    # Environment
    ENVIRONMENT: str = "development"

    # Registration switch (decision §0.5)
    REGISTRATION_OPEN: bool = True

    # Statement import (decision §5) — standard CSV only, never stored on disk
    MAX_UPLOAD_MB: int = 2
    IMPORT_MAX_ROWS: int = 2000

    # Exchange rates (decision §8)
    FX_HTTP_TIMEOUT_SECONDS: float = 10

    # Rate limits (decision §2, §9, §14.35, §14.43)
    RATE_LIMIT_LOGIN_PER_MINUTE: int = 10
    RATE_LIMIT_REGISTER_PER_HOUR: int = 5
    RATE_LIMIT_JOIN_QPS: float = Field(default=1, gt=0)
    RATE_LIMIT_IMPORTS_PER_HOUR: int = 10

    # Soft limits (decision §2)
    MAX_LEDGERS_PER_USER: int = 10
    MAX_MEMBERS_PER_LEDGER: int = 10
    # Accounts one person may own, archived ones included (decision §14.62)
    MAX_SOURCES_PER_USER: int = 50

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="allow"
    )

    @field_validator("SECRET_KEY")
    @classmethod
    def secret_key_must_be_set(cls, v: str) -> str:
        """Reject empty or sentinel SECRET_KEY values so startup fails loudly (H-08)."""
        if not v or v.startswith("CHANGE_ME"):
            raise ValueError(
                "SECRET_KEY must be set to a real secret; empty or CHANGE_ME_* sentinel values "
                "are rejected"
            )
        return v

    @property
    def allowed_origins_list(self) -> list[str]:
        """Parse CORS allowed origins from comma-separated string."""
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",")]


# Global settings instance
settings = Settings()
