"""Pydantic schemas for FinanceSource management."""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.currency import CurrencyCode


class FinanceSourceCreate(BaseModel):
    """Schema for creating a new finance source."""
    
    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        example="Chase Checking",
        description="Finance source name (e.g., 'Chase Checking', 'Amex Credit')"
    )
    type: str = Field(
        ...,
        pattern="^(checking|savings|credit|other)$",
        example="checking",
        description="Finance source type: checking, savings, credit, or other"
    )
    default_currency: CurrencyCode = Field(
        ...,
        example="USD",
        description="Default currency for this finance source (ISO 4217 code)"
    )


class FinanceSourceUpdate(BaseModel):
    """Schema for updating a finance source (partial update)."""
    
    name: Optional[str] = Field(
        None,
        min_length=1,
        max_length=100,
        example="Chase Checking Updated",
        description="Updated finance source name"
    )
    archived: Optional[bool] = Field(
        None,
        example=False,
        description="Whether the finance source is archived"
    )


class FinanceSourceResponse(BaseModel):
    """Schema for finance source response."""
    
    id: UUID = Field(..., description="Finance source unique identifier")
    user_id: UUID = Field(..., description="Owner user ID")
    name: str = Field(..., example="Chase Checking", description="Finance source name")
    type: str = Field(..., example="checking", description="Finance source type")
    default_currency: CurrencyCode = Field(..., example="USD", description="Default currency")
    archived: bool = Field(..., example=False, description="Whether the finance source is archived")
    created_at: datetime = Field(..., description="Finance source creation timestamp")
    
    class Config:
        from_attributes = True  # Pydantic v2 (was orm_mode in v1)

