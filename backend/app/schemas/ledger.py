"""Ledger, membership and invite schemas (03-backend-api.md §5.8-§5.19)."""
import uuid
from typing import Literal

from pydantic import Field, field_validator

from app.schemas.common import ApiModel, ApiRequestModel, UtcDatetime

CURRENCY_PATTERN = r"^[A-Za-z]{3}$"
INVITE_CODE_PATTERN = r"^[0-9]{6}$"


class LedgerCounts(ApiModel):
    """The three counts shown in the delete-confirmation dialog (§5.10, §5.19)."""

    transactions: int
    sources: int
    import_batches: int


class LedgerResponse(ApiModel):
    """Response for §5.8-§5.11 and §5.19.

    ``counts`` is only populated by ``GET /ledgers/{id}`` (§5.10) and
    ``POST /ledgers/join`` (§5.19); every other endpoint that returns this
    shape (§5.8, §5.9, §5.11) leaves it ``None``.
    """

    id: uuid.UUID
    name: str
    base_currency: str
    role: Literal["owner", "member"]
    member_count: int
    created_by: uuid.UUID
    counts: LedgerCounts | None = None
    created_at: UtcDatetime
    updated_at: UtcDatetime


class LedgerCreate(ApiRequestModel):
    """§5.9 request body."""

    name: str = Field(..., min_length=1, max_length=100)
    base_currency: str | None = Field(default=None, pattern=CURRENCY_PATTERN)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name must not be blank")
        return stripped

    @field_validator("base_currency")
    @classmethod
    def _uppercase_currency(cls, value: str | None) -> str | None:
        return value.upper() if value is not None else value


class LedgerPatch(ApiRequestModel):
    """§5.11 request body: ``updated_at`` is the optimistic-concurrency stamp (§4.4)."""

    updated_at: UtcDatetime
    name: str | None = Field(default=None, min_length=1, max_length=100)
    base_currency: str | None = Field(default=None, pattern=CURRENCY_PATTERN)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("name must not be blank")
        return stripped

    @field_validator("base_currency")
    @classmethod
    def _uppercase_currency(cls, value: str | None) -> str | None:
        return value.upper() if value is not None else value


class MemberResponse(ApiModel):
    """§5.13 (and §5.16) response item."""

    user_id: uuid.UUID
    email: str
    display_name: str | None
    role: Literal["owner", "member"]
    joined_at: UtcDatetime
    is_me: bool


class InviteResponse(ApiModel):
    """§5.17 response."""

    id: uuid.UUID
    code: str
    ledger_id: uuid.UUID
    ledger_name: str
    expires_at: UtcDatetime
    created_at: UtcDatetime


class JoinRequest(ApiRequestModel):
    """§5.19 request body."""

    code: str = Field(..., pattern=INVITE_CODE_PATTERN)


class TransferOwnershipRequest(ApiRequestModel):
    """§5.16 request body."""

    to_user_id: uuid.UUID
