"""Pydantic schemas for currency and exchange rate operations."""
from decimal import Decimal
from typing import Dict, Annotated
from datetime import date

from pydantic import BaseModel, Field

# Type alias for ISO 4217 currency codes
CurrencyCode = Annotated[str, Field(min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")]


class CurrencyList(BaseModel):
    """Response schema for supported currencies list."""
    currencies: Dict[str, str] = Field(
        ...,
        description="Map of currency codes to currency names",
        examples=[{
            "USD": "United States Dollar",
            "EUR": "Euro",
            "CNY": "Chinese Renminbi Yuan"
        }]
    )


class ExchangeRateResponse(BaseModel):
    """Response schema for exchange rate queries."""
    base: str = Field(..., description="Base currency code", examples=["USD"])
    date: str = Field(..., description="Rate date (YYYY-MM-DD)", examples=["2025-10-28"])
    rates: Dict[str, Decimal] = Field(
        ...,
        description="Map of currency codes to exchange rates",
        examples=[{"EUR": 0.92, "GBP": 0.79, "CNY": 7.11}]
    )


class ConversionRequest(BaseModel):
    """Request schema for currency conversion."""
    amount: Decimal = Field(..., gt=0, description="Amount to convert", examples=[100.0])
    from_currency: str = Field(..., min_length=3, max_length=3, description="Source currency code", examples=["USD"])
    to_currency: str = Field(..., min_length=3, max_length=3, description="Target currency code", examples=["EUR"])


class ConversionResult(BaseModel):
    """Response schema for currency conversion."""
    amount: Decimal = Field(..., description="Original amount")
    from_currency: str = Field(..., description="Source currency code")
    to_currency: str = Field(..., description="Target currency code")
    converted_amount: Decimal = Field(..., description="Converted amount")
    rate: Decimal = Field(..., description="Exchange rate used")
    date: str = Field(..., description="Rate date")

