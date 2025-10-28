"""Pydantic schemas for Transaction management."""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.currency import CurrencyCode


class TransactionCreate(BaseModel):
    """Schema for creating a new transaction."""
    
    source_id: Optional[UUID] = Field(
        None,
        description="Finance source ID (payment method). If omitted, uses user's default_source_id"
    )
    amount: Decimal = Field(
        ...,
        decimal_places=4,
        description="Transaction amount (positive for income, negative for expense)"
    )
    currency: CurrencyCode = Field(
        ...,
        example="USD",
        description="Currency code (ISO 4217)"
    )
    occurred_at: date = Field(
        ...,
        example="2025-10-28",
        description="Transaction date (YYYY-MM-DD)"
    )
    description: Optional[str] = Field(
        None,
        max_length=500,
        example="Grocery shopping",
        description="Transaction description"
    )
    merchant: Optional[str] = Field(
        None,
        max_length=200,
        example="Whole Foods",
        description="Merchant name"
    )
    tags: Optional[List[str]] = Field(
        default_factory=list,
        example=["food", "groceries"],
        description="List of tags for categorization"
    )


class TransactionUpdate(BaseModel):
    """Schema for updating a transaction (partial update)."""
    
    amount: Optional[Decimal] = Field(
        None,
        decimal_places=4,
        description="Updated transaction amount"
    )
    currency: Optional[CurrencyCode] = Field(
        None,
        description="Updated currency code"
    )
    occurred_at: Optional[date] = Field(
        None,
        description="Updated transaction date"
    )
    description: Optional[str] = Field(
        None,
        max_length=500,
        description="Updated description"
    )
    merchant: Optional[str] = Field(
        None,
        max_length=200,
        description="Updated merchant name"
    )
    tags: Optional[List[str]] = Field(
        None,
        description="Updated list of tags (replaces existing tags)"
    )


class TransactionResponse(BaseModel):
    """Schema for transaction response with currency conversion."""
    
    id: UUID = Field(..., description="Transaction unique identifier")
    user_id: UUID = Field(..., description="Owner user ID")
    source_id: UUID = Field(..., description="Finance source ID (payment method)")
    amount: Decimal = Field(..., description="Original transaction amount")
    currency: CurrencyCode = Field(..., description="Original transaction currency")
    occurred_at: date = Field(..., description="Transaction date")
    description: Optional[str] = Field(None, description="Transaction description")
    merchant: Optional[str] = Field(None, description="Merchant name")
    created_at: datetime = Field(..., description="Record creation timestamp")
    
    # Currency conversion fields (calculated at query time)
    converted_amount: Optional[Decimal] = Field(
        None, 
        description="Amount converted to user's base_currency (null if same currency)"
    )
    conversion_rate: Optional[Decimal] = Field(
        None,
        description="Exchange rate used for conversion (null if same currency)"
    )
    conversion_date: Optional[date] = Field(
        None,
        description="Date of the exchange rate used (null if same currency)"
    )
    
    # Tags
    tags: List[str] = Field(
        default_factory=list,
        description="List of tags for this transaction"
    )
    
    class Config:
        from_attributes = True  # Pydantic v2 (was orm_mode in v1)
