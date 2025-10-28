"""Pydantic schemas for Account management."""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.currency import CurrencyCode


class AccountCreate(BaseModel):
    """Schema for creating a new account."""
    
    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        example="Chase Checking",
        description="Account name (e.g., 'Chase Checking', 'Amex Credit')"
    )
    type: str = Field(
        ...,
        pattern="^(checking|savings|credit|other)$",
        example="checking",
        description="Account type: checking, savings, credit, or other"
    )
    default_currency: CurrencyCode = Field(
        ...,
        example="USD",
        description="Default currency for this account (ISO 4217 code)"
    )


class AccountUpdate(BaseModel):
    """Schema for updating an account (partial update)."""
    
    name: Optional[str] = Field(
        None,
        min_length=1,
        max_length=100,
        example="Chase Checking Updated",
        description="Updated account name"
    )
    archived: Optional[bool] = Field(
        None,
        example=False,
        description="Whether the account is archived"
    )


class AccountResponse(BaseModel):
    """Schema for account response."""
    
    id: UUID = Field(..., description="Account unique identifier")
    user_id: UUID = Field(..., description="Owner user ID")
    name: str = Field(..., example="Chase Checking", description="Account name")
    type: str = Field(..., example="checking", description="Account type")
    default_currency: CurrencyCode = Field(..., example="USD", description="Default currency")
    archived: bool = Field(..., example=False, description="Whether the account is archived")
    created_at: datetime = Field(..., description="Account creation timestamp")
    
    class Config:
        from_attributes = True  # Pydantic v2 (was orm_mode in v1)

