"""Auth endpoint schemas (03-backend-api.md §5.1-§5.2)."""
from typing import Literal

from pydantic import EmailStr, Field, field_validator

from app.schemas.common import ApiModel, ApiRequestModel

CURRENCY_PATTERN = r"^[A-Za-z]{3}$"


class RegisterRequest(ApiRequestModel):
    """§5.1 request body."""

    email: EmailStr
    password: str = Field(..., min_length=8)
    base_currency: str = Field(..., pattern=CURRENCY_PATTERN)
    language: Literal["zh", "en"] = "zh"

    @field_validator("email")
    @classmethod
    def _lowercase_email(cls, value: str) -> str:
        """Emails are stored lower-cased (§5.1)."""
        return value.lower()

    @field_validator("password")
    @classmethod
    def _limit_password_bytes(cls, value: str) -> str:
        """8 <= char length (via min_length) and <= 72 UTF-8 bytes (§5.1, bcrypt limit)."""
        if len(value.encode("utf-8")) > 72:
            raise ValueError("password must be at most 72 bytes when UTF-8 encoded")
        return value

    @field_validator("base_currency")
    @classmethod
    def _uppercase_currency(cls, value: str) -> str:
        return value.upper()


class LoginRequest(ApiRequestModel):
    """§5.2 request body."""

    email: EmailStr
    password: str


class TokenResponse(ApiModel):
    """§5.1 and §5.2 response: a bearer access token."""

    access_token: str
    token_type: str = "bearer"
