"""Schemas for the /rates endpoints (03-backend-api.md §5.45-§5.47)."""
import datetime as dt
from decimal import Decimal

from pydantic import BaseModel, Field

# ISO 4217 codes are accepted in either case and upper-cased server side (§4.5).
CURRENCY_PATTERN = r"^[A-Za-z]{3}$"


class CurrencyList(BaseModel):
    """§5.45 response: the supported currency code -> name map."""

    currencies: dict[str, str] = Field(
        ...,
        description="Map of currency codes to currency names",
        examples=[{"USD": "United States Dollar", "EUR": "Euro"}],
    )


class ExchangeRateResponse(BaseModel):
    """§5.46 response; ``date`` is the upstream quotation day, not today."""

    base: str = Field(..., description="Base currency code", examples=["USD"])
    date: dt.date = Field(..., description="Quotation day of the rates")
    rates: dict[str, Decimal] = Field(
        ...,
        description="Map of currency codes to rates, 8 decimal places",
        examples=[{"EUR": "0.92000000", "CNY": "7.24500000"}],
    )


class ConversionRequest(BaseModel):
    """§5.47 request body."""

    amount: Decimal = Field(..., gt=0, description="Amount to convert", examples=["100"])
    from_currency: str = Field(..., pattern=CURRENCY_PATTERN, description="Source currency")
    to_currency: str = Field(..., pattern=CURRENCY_PATTERN, description="Target currency")
    on: dt.date | None = Field(
        default=None,
        description="Quotation day to use; omitted means the latest published day",
    )


class ConversionResult(BaseModel):
    """§5.47 response; ``rate`` has 8 decimals, ``converted_amount`` has 4."""

    amount: Decimal = Field(..., description="Original amount")
    from_currency: str = Field(..., description="Source currency code")
    to_currency: str = Field(..., description="Target currency code")
    converted_amount: Decimal = Field(..., description="Converted amount")
    rate: Decimal = Field(..., description="Rate used: 1 from_currency = rate to_currency")
    date: dt.date = Field(..., description="Quotation day of the rate used")
