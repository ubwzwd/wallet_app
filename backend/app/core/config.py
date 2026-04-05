"""
Application configuration using Pydantic Settings.
Reads from environment variables and .env file.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Database
    DATABASE_URL: str = "postgresql://wallet_user:wallet_password@localhost:5432/wallet_db"
    
    # JWT
    SECRET_KEY: str = "your-secret-key-change-this-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    # API
    API_V1_PREFIX: str = "/api/v1"
    PROJECT_NAME: str = "Wallet App API"
    DEBUG: bool = False
    
    # CORS
    ALLOWED_ORIGINS: str = "http://localhost:8081,http://localhost:19006,http://localhost:3000"
    
    # Exchange Rate API
    EXCHANGE_RATE_API_URL: str = "https://api.frankfurter.app"
    
    # Environment
    ENVIRONMENT: str = "development"
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="allow"
    )
    
    @property
    def allowed_origins_list(self) -> list[str]:
        """Parse CORS allowed origins from comma-separated string."""
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",")]


# Global settings instance
settings = Settings()

