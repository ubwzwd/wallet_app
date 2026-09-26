"""Finance source (account) schemas (03-backend-api.md §5.20-§5.24c).

Accounts belong to a person and are shared into ledgers (decision §14.62):
``SourceResponse`` / ``SourceListResponse`` are the owner's own view under
``/sources``; ``LedgerSourceResponse`` / ``LedgerSourceListResponse`` are the
per-ledger list, where another member's account carries no balance figures.

Money fields are ``Decimal`` quantized to 4 decimal places, exchange rates to
8 (§4.5) — the ``Amount`` / ``Rate`` annotated types (imported from
``app.schemas.common``, the one place they are defined — see that module's
docstring) do the quantizing so the JSON output always has the right number
of digits regardless of how many decimals the caller happened to pass in
(pydantic v2 serializes ``Decimal`` to a string that mirrors its own
exponent, so quantizing on the way in is what fixes the digit count on the
way out).
"""
from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from typing import Literal

from pydantic import Field, field_validator

from app.schemas.common import (
    CURRENCY_PATTERN,
    Amount,
    ApiModel,
    ApiRequestModel,
    Rate,
    UtcDatetime,
)

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
    # Ledgers to share the new account into at once (§5.21); every one must be
    # a ledger the caller is a member of, or nothing is created (404).
    share_to: list[uuid.UUID] = Field(default_factory=list)

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
    """§5.20 (list item) / §5.22 (single) response body — the same shape.

    Under ``/sources`` every field is filled in: the caller owns the account.
    ``LedgerSourceResponse`` reuses the shape for other members' accounts, and
    there ``opening_balance``, the four balance fields and ``shared_to`` are
    ``null`` (§5.24c) — which is why they are nullable here.
    """

    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    type: SourceType
    default_currency: str
    opening_balance: Amount | None
    archived: bool
    archived_at: UtcDatetime | None
    created_by: uuid.UUID
    updated_by: uuid.UUID
    created_at: UtcDatetime
    updated_at: UtcDatetime
    # Ledgers the account is shared into, limited to those the caller is still
    # a member of; ``null`` on another member's account (§5.24c).
    shared_to: list[uuid.UUID] | None
    balance: Amount | None
    balance_base: Amount | None
    balance_rate: Rate | None
    balance_rate_date: dt.date | None
    rate_missing_count: int


class SourceListResponse(ApiModel):
    """§5.20 response: the caller's accounts + total + the three personal totals.

    ``base_currency`` is the caller's ``users.base_currency``. ``assets`` /
    ``liabilities`` / ``net_worth`` cover the caller's non-archived accounts
    and are ``null`` together when one of them cannot be converted into
    ``base_currency`` (§5.20's fallback branch); otherwise all three are present.
    """

    items: list[SourceResponse]
    total: int
    base_currency: str
    assets: Amount | None
    liabilities: Amount | None
    net_worth: Amount | None


class LedgerSourceResponse(SourceResponse):
    """§5.24c list item: ``SourceResponse`` plus two flags.

    ``mine`` — the caller owns the account; ``usable`` — the caller may record
    new entries on it in this ledger right now
    (``not archived and (mine or shared into this ledger)``).
    """

    mine: bool
    usable: bool


class LedgerSourceListResponse(ApiModel):
    """§5.24c response: no totals — a ledger has no net worth (decision §14.62 d)."""

    items: list[LedgerSourceResponse]
    total: int
