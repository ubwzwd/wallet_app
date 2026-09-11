"""Finance source (account) schemas (03-backend-api.md §5.20-§5.24).

Money fields are ``Decimal`` quantized to 4 decimal places, exchange rates to
8 (§4.5) — the ``Amount`` / ``Rate`` annotated types (imported from
``app.schemas.transaction``, the one place they are defined — see that
module's docstring) do the quantizing so the JSON output always has the
right number of digits regardless of how many decimals the caller happened
to pass in (pydantic v2 serializes ``Decimal`` to a string that mirrors its
own exponent, so quantizing on the way in is what fixes the digit count on
the way out).
"""
from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from typing import Literal

from pydantic import Field, field_validator

from app.schemas.common import CURRENCY_PATTERN, ApiModel, ApiRequestModel, UtcDatetime
from app.schemas.transaction import Amount, Rate

SourceType = Literal["checking", "credit", "cash", "other"]


class SourceCreate(ApiRequestModel):
    """§5.21 request body.

    ``default_currency`` can only be set here — §5.23 refuses to change it
    once the account exists (decision §14.50), so this is the one place a
    format check on it belongs.
    """

    name: str = Field(..., min_length=1, max_length=100)
    type: SourceType
    default_currency: str = Field(..., pattern=CURRENCY_PATTERN)
    opening_balance: Amount = Decimal("0.0000")

    @field_validator("name", mode="before")
    @classmethod
    def _strip_name(cls, value: object) -> object:
        """Trim first; ``min_length`` / ``max_length`` then judge the real name."""
        return value.strip() if isinstance(value, str) else value

    @field_validator("default_currency")
    @classmethod
    def _uppercase_currency(cls, value: str) -> str:
        return value.upper()


class SourcePatch(ApiRequestModel):
    """§5.23 request body: ``updated_at`` is the optimistic-concurrency stamp (§4.4).

    ``name`` / ``type`` / ``opening_balance`` / ``archived`` follow ``LedgerPatch``'s
    rule: omitting one means "leave it alone", an explicit ``null`` is a 422.
    ``default_currency`` is deliberately *not* validated or restricted here —
    decision §14.50 makes changing it a 400 ``currency_locked``, but that is
    the endpoint's call to make (it needs to tell "field present" from "field
    absent" via ``model_fields_set`` regardless of the value given); the
    schema only needs to let the field through without tripping
    ``extra="forbid"``.
    """

    updated_at: UtcDatetime
    name: str | None = Field(default=None, min_length=1, max_length=100)
    type: SourceType | None = None
    opening_balance: Amount | None = None
    archived: bool | None = None
    default_currency: str | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _strip_name(cls, value: object) -> object:
        """Refuse ``null``, then trim so the bounds judge the real name."""
        if value is None:
            raise ValueError("name does not accept null")
        return value.strip() if isinstance(value, str) else value

    @field_validator("type", mode="before")
    @classmethod
    def _reject_null_type(cls, value: object) -> object:
        if value is None:
            raise ValueError("type does not accept null")
        return value

    @field_validator("opening_balance", mode="before")
    @classmethod
    def _reject_null_opening_balance(cls, value: object) -> object:
        if value is None:
            raise ValueError("opening_balance does not accept null")
        return value

    @field_validator("archived", mode="before")
    @classmethod
    def _reject_null_archived(cls, value: object) -> object:
        if value is None:
            raise ValueError("archived does not accept null")
        return value


class SourceResponse(ApiModel):
    """§5.20 (list item) / §5.22 (single) response body — the same shape."""

    id: uuid.UUID
    ledger_id: uuid.UUID
    name: str
    type: SourceType
    default_currency: str
    opening_balance: Amount
    archived: bool
    archived_at: UtcDatetime | None
    balance: Amount
    balance_base: Amount | None
    balance_rate: Rate | None
    balance_rate_date: dt.date | None
    rate_missing_count: int
    created_by: uuid.UUID
    updated_by: uuid.UUID
    created_at: UtcDatetime
    updated_at: UtcDatetime


class SourceListResponse(ApiModel):
    """§5.20 response: items + total + the three ledger-level totals.

    ``assets`` / ``liabilities`` / ``net_worth`` are ``null`` together when
    the upstream rate service is fully unavailable (§5.20's fallback branch);
    otherwise all three are always present.
    """

    items: list[SourceResponse]
    total: int
    base_currency: str
    assets: Amount | None
    liabilities: Amount | None
    net_worth: Amount | None
