"""Pydantic schemas for user-related requests and responses."""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    """Schema for user registration."""
    email: EmailStr
    password: str = Field(..., min_length=8, description="Password must be at least 8 characters")
    base_currency: str = Field(..., min_length=3, max_length=3, description="ISO 4217 currency code")


class UserLogin(BaseModel):
    """Schema for user login."""
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    """Schema for user information in responses."""
    id: UUID
    email: str
    base_currency: str
    default_source_id: UUID | None = None
    created_at: datetime

    class Config:
        from_attributes = True  # Pydantic v2: enable ORM mode


class UserUpdate(BaseModel):
    """Schema for partial user profile update (PATCH /auth/me)."""
    base_currency: str | None = Field(
        None,
        min_length=3,
        max_length=3,
        description="ISO 4217 currency code",
    )
    default_source_id: UUID | None = Field(
        None,
        description="ID of user's default finance source",
    )


class Token(BaseModel):
    """Schema for JWT token response."""
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    """Schema for decoded JWT token data."""
    user_id: str

