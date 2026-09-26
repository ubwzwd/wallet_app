"""Ledger, membership and invite schemas (03-backend-api.md §5.8-§5.19)."""
import uuid
from typing import Literal

from pydantic import Field, field_validator

from app.schemas.common import CURRENCY_PATTERN, ApiModel, ApiRequestModel, UtcDatetime

INVITE_CODE_PATTERN = r"^[0-9]{6}$"


class LedgerCounts(ApiModel):
    """The three counts shown in the delete-confirmation dialog (§5.10, §5.19).

    ``sources`` counts the accounts *shared into* the ledger (its
    ``ledger_sources`` rows, decision §14.62 f) — deleting the ledger only
    withdraws those shares, it never deletes an account.
    """

    transactions: int
    sources: int
    import_batches: int


class LedgerResponse(ApiModel):
    """The ledger body of §5.8, §5.9 and §5.11 — no ``counts``.

    The three counts are expensive enough to be worth asking for, so the two
    endpoints that do hand them out return :class:`LedgerDetailResponse`
    instead. Keeping them out of this class is what makes ``counts`` absent
    from the list, create and patch bodies rather than present and ``null``.
    """

    id: uuid.UUID
    name: str
    base_currency: str
    role: Literal["owner", "member"]
    member_count: int
    created_by: uuid.UUID
    created_at: UtcDatetime
    updated_at: UtcDatetime


class LedgerDetailResponse(LedgerResponse):
    """§5.10 and §5.19: the same body plus the delete-dialog counts."""

    counts: LedgerCounts


class LedgerCreate(ApiRequestModel):
    """§5.9 request body.

    ``name`` is stripped *before* its length is measured, so "   " is one
    character short of the bound rather than three characters long, and
    ``base_currency`` may be omitted or ``null`` — both mean "the caller's own
    default currency" (§5.9).
    """

    name: str = Field(..., min_length=1, max_length=100)
    base_currency: str | None = Field(default=None, pattern=CURRENCY_PATTERN)

    @field_validator("name", mode="before")
    @classmethod
    def _strip_name(cls, value: object) -> object:
        """Trim first; ``min_length`` / ``max_length`` then judge the real name."""
        return value.strip() if isinstance(value, str) else value

    @field_validator("base_currency")
    @classmethod
    def _uppercase_currency(cls, value: str | None) -> str | None:
        return value.upper() if value is not None else value


class LedgerPatch(ApiRequestModel):
    """§5.11 request body: ``updated_at`` is the optimistic-concurrency stamp (§4.4).

    Both editable fields follow ``MePatch``'s rule: omitting one means "leave
    it alone" (the default is never validated and stays out of
    ``model_fields_set``), while an explicit ``null`` is a 422 — there is no
    such thing as a ledger without a name or without a base currency. The
    ``str | None`` annotation is the honest one for the omitted case; the
    ``mode="before"`` validators are what refuse the null.
    """

    updated_at: UtcDatetime
    name: str | None = Field(default=None, min_length=1, max_length=100)
    base_currency: str | None = Field(default=None, pattern=CURRENCY_PATTERN)

    @field_validator("name", mode="before")
    @classmethod
    def _strip_name(cls, value: object) -> object:
        """Refuse ``null``, then trim so the bounds judge the real name."""
        if value is None:
            raise ValueError("name does not accept null")
        return value.strip() if isinstance(value, str) else value

    @field_validator("base_currency", mode="before")
    @classmethod
    def _reject_null_currency(cls, value: object) -> object:
        if value is None:
            raise ValueError("base_currency does not accept null")
        return value

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
