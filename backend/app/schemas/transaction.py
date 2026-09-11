"""Transaction, transfer and pairing schemas (03-backend-api.md §5.25-§5.34).

Sign coupling (amount vs. kind/role), category/kind coupling, and
``refund_of`` legality are business rules and are deliberately **not**
enforced here — they belong to ``app/services/transaction_service.py``
(cross-task contract). This module only checks shape: types, lengths,
enums, and the one date bound (§5.26) that the design calls out as a field
rule rather than a cross-field rule.

Money fields are ``Decimal`` quantized to 4 decimal places, exchange rates
to 8 (§4.5); see the ``Amount`` / ``Rate`` annotated types (defined in
``app.schemas.common``, the one place they and their quantizing helpers
live — see that module's docstring).
"""
from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AfterValidator, ConfigDict, Field, field_validator, model_serializer

from app.schemas.common import (
    CURRENCY_PATTERN,
    Amount,
    ApiModel,
    ApiRequestModel,
    Rate,
    UtcDatetime,
)

Kind = Literal["expense", "income", "refund", "transfer"]
TransferRole = Literal["out", "in"]
TransferSubtype = Literal["plain", "repayment"]
EventName = Literal[
    "created", "updated", "imported", "paired", "unpaired", "refund_linked", "refund_unlinked"
]


def _require_nonzero(value: Decimal) -> Decimal:
    if value == 0:
        raise ValueError("amount must not be zero")
    return value


def _require_positive(value: Decimal) -> Decimal:
    if value <= 0:
        raise ValueError("amount must be greater than 0")
    return value


# A quantized amount that must not be zero (§5.26 ``amount``). ``Annotated``
# nests flatten (PEP 593), so this is exactly ``Amount`` plus one more
# ``AfterValidator``, applied after the quantizing one.
NonzeroAmount = Annotated[Amount, AfterValidator(_require_nonzero)]
# A quantized amount that must be > 0 (§5.30 ``amount_out`` / ``amount_in``).
PositiveAmount = Annotated[Amount, AfterValidator(_require_positive)]


def _reject_none(field_name: str):
    """Build a ``mode="before"`` validator that turns an explicit ``null`` into a 422.

    Used on every ``*Patch`` field that does not accept clearing — omitting the
    field is fine (it never reaches this validator; defaults are not
    validated), but sending ``null`` explicitly is a deliberate "clear" that
    only the handful of nullable fields listed in §5.28 support.
    """

    def _validator(value: object) -> object:
        if value is None:
            raise ValueError(f"{field_name} does not accept null")
        return value

    return _validator


def _check_occurred_at_bound(value: dt.date) -> dt.date:
    """§5.26: not later than tomorrow, judged on the UTC calendar day."""
    today = dt.datetime.now(dt.UTC).date()
    if value > today + dt.timedelta(days=1):
        raise ValueError("occurred_at must not be later than tomorrow (UTC)")
    return value


class TransactionCreate(ApiRequestModel):
    """§5.26 request body for a single (non-transfer-pair) transaction."""

    source_id: uuid.UUID
    kind: Kind
    amount: NonzeroAmount
    currency: str = Field(..., pattern=CURRENCY_PATTERN)
    occurred_at: dt.date
    category_l1: str | None = None
    category_l2: str | None = None
    merchant: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=500)
    refund_of: uuid.UUID | None = None
    transfer_role: TransferRole | None = None
    transfer_subtype: TransferSubtype | None = None
    counterparty: str | None = Field(default=None, max_length=100)

    @field_validator("currency")
    @classmethod
    def _uppercase_currency(cls, value: str) -> str:
        return value.upper()

    @field_validator("occurred_at")
    @classmethod
    def _bound_occurred_at(cls, value: dt.date) -> dt.date:
        return _check_occurred_at_bound(value)


class TransactionPatch(ApiRequestModel):
    """§5.28 request body: every §5.26 field, all optional, plus ``updated_at``.

    Null semantics (§5.28): ``category_l2`` / ``merchant`` / ``note`` /
    ``counterparty`` / ``refund_of`` accept an explicit ``null`` to mean
    "clear this field"; every other field rejects an explicit ``null`` (a
    422) and treats omission as "leave it alone".
    """

    updated_at: UtcDatetime
    source_id: uuid.UUID | None = None
    kind: Kind | None = None
    amount: NonzeroAmount | None = None
    currency: str | None = Field(default=None, pattern=CURRENCY_PATTERN)
    occurred_at: dt.date | None = None
    category_l1: str | None = None
    category_l2: str | None = None
    merchant: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=500)
    refund_of: uuid.UUID | None = None
    transfer_role: TransferRole | None = None
    transfer_subtype: TransferSubtype | None = None
    counterparty: str | None = Field(default=None, max_length=100)

    _reject_null_source_id = field_validator("source_id", mode="before")(
        staticmethod(_reject_none("source_id"))
    )
    _reject_null_kind = field_validator("kind", mode="before")(staticmethod(_reject_none("kind")))
    _reject_null_amount = field_validator("amount", mode="before")(
        staticmethod(_reject_none("amount"))
    )
    _reject_null_currency = field_validator("currency", mode="before")(
        staticmethod(_reject_none("currency"))
    )
    _reject_null_occurred_at = field_validator("occurred_at", mode="before")(
        staticmethod(_reject_none("occurred_at"))
    )
    _reject_null_category_l1 = field_validator("category_l1", mode="before")(
        staticmethod(_reject_none("category_l1"))
    )
    _reject_null_transfer_role = field_validator("transfer_role", mode="before")(
        staticmethod(_reject_none("transfer_role"))
    )
    _reject_null_transfer_subtype = field_validator("transfer_subtype", mode="before")(
        staticmethod(_reject_none("transfer_subtype"))
    )

    @field_validator("currency")
    @classmethod
    def _uppercase_currency(cls, value: str | None) -> str | None:
        return value.upper() if value is not None else value

    @field_validator("occurred_at")
    @classmethod
    def _bound_occurred_at(cls, value: dt.date | None) -> dt.date | None:
        return _check_occurred_at_bound(value) if value is not None else value


class _OptionalRefundFields(ApiModel):
    """Mixin: ``refunded_total`` / ``refundable`` dropped from output when ``None``.

    Both only apply to ``kind == 'expense'`` rows (§5.25); on every other kind
    they are left ``None`` and must not appear in the JSON body at all, rather
    than showing up as ``null`` next to fields that are genuinely nullable
    (``category_l2``, ``note``, ...). §5.25 never needs to distinguish "unset"
    from "explicitly null" for these two fields, so a plain ``is None`` check
    is enough. A wrapping ``model_serializer`` is the field-level way to do
    that: it only pops these two keys when ``None``, so other ``None``-valued
    fields still serialize as ``null`` normally.
    """

    refunded_total: Amount | None = None
    refundable: Amount | None = None

    @model_serializer(mode="wrap")
    def _drop_unset_refund_fields(self, handler):  # type: ignore[no-untyped-def]
        data = handler(self)
        if self.refunded_total is None:
            data.pop("refunded_total", None)
        if self.refundable is None:
            data.pop("refundable", None)
        return data


class TransactionItem(_OptionalRefundFields):
    """§5.25 list item — also the base of §5.27's ``TransactionDetail``."""

    id: uuid.UUID
    ledger_id: uuid.UUID
    source_id: uuid.UUID
    kind: Kind
    amount: Amount
    currency: str
    occurred_at: dt.date
    category_l1: str | None
    category_l2: str | None
    merchant: str | None
    note: str | None
    counterparty: str | None
    transfer_role: TransferRole | None
    transfer_subtype: TransferSubtype | None
    transfer_pair_id: uuid.UUID | None
    refund_of: uuid.UUID | None
    import_batch_id: uuid.UUID | None
    amount_base: Amount | None
    rate_used: Rate | None
    rate_date: dt.date | None
    created_by: uuid.UUID
    updated_by: uuid.UUID
    created_at: UtcDatetime
    updated_at: UtcDatetime


class RefundRef(ApiModel):
    """One entry of §5.27's ``refunds[]`` (and reused for ``other_refunds``)."""

    id: uuid.UUID
    occurred_at: dt.date
    amount: Amount
    currency: str
    note: str | None
    source_id: uuid.UUID


class RefundOrigin(ApiModel):
    """§5.27's ``refund_of_detail`` — the expanded original expense."""

    id: uuid.UUID
    occurred_at: dt.date
    merchant: str | None
    amount: Amount
    currency: str
    source_id: uuid.UUID
    category_l1: str | None
    category_l2: str | None
    refunded_total: Amount
    refundable: Amount
    other_refunds: list[RefundRef]


class PairLeg(ApiModel):
    """The 4-field precis of one leg inside §5.27's ``pair`` (not a full ``TransferLeg``)."""

    transaction_id: uuid.UUID
    source_id: uuid.UUID
    amount: Amount
    currency: str


class _WithInLeg(ApiModel):
    """Base for response models with a leg named ``in`` in JSON.

    ``in`` is a Python keyword, so the attribute is ``in_``; a field alias
    (rather than a wrapping serializer) renames it on the way out *and* keeps
    the model able to re-validate its own dump — ``model_dump(by_alias=True)``
    round-trips through ``model_validate``, and the generated OpenAPI schema
    documents the real wire name ``in`` instead of ``in_``.
    ``populate_by_name=True`` lets service code keep constructing these with
    the ``in_=`` keyword, and ``serialize_by_alias=True`` makes the alias the
    *default* serialization key so plain ``model_dump()``/``model_dump_json()``
    calls (not just FastAPI's own alias-aware response encoding) emit ``in``.
    """

    model_config = ConfigDict(
        from_attributes=True, populate_by_name=True, serialize_by_alias=True
    )


class PairRef(_WithInLeg):
    """§5.27's ``pair``: a precis of the two-legged transfer this row belongs to."""

    pair_id: uuid.UUID
    out: PairLeg
    in_: PairLeg = Field(..., alias="in")


class EventItem(ApiModel):
    """One row of §5.27's ``events[]`` (§7 / decision §14.51)."""

    id: uuid.UUID
    event: EventName
    at: UtcDatetime
    actor_id: uuid.UUID
    client: str | None
    changes: dict[str, dict[str, str | None]] | None
    import_batch_id: uuid.UUID | None


class TransactionDetail(TransactionItem):
    """§5.27 response: the list item plus refunds / origin / pair / events."""

    refunds: list[RefundRef]
    refund_of_detail: RefundOrigin | None
    pair: PairRef | None
    events: list[EventItem]


class TransactionSummary(ApiModel):
    """§5.25's ``summary`` — totals over the filtered result set, not the page."""

    base_currency: str
    expense: Amount
    income: Amount
    net: Amount
    count: int
    rate_missing_count: int


class TransactionListResponse(ApiModel):
    """§5.25 response: ``{items, total, summary}``."""

    items: list[TransactionItem]
    total: int
    summary: TransactionSummary


class TransferCreate(ApiRequestModel):
    """§5.30 request body: create a two-legged transfer in one call."""

    from_source_id: uuid.UUID
    to_source_id: uuid.UUID
    amount_out: PositiveAmount
    currency_out: str | None = Field(default=None, pattern=CURRENCY_PATTERN)
    amount_in: PositiveAmount | None = None
    currency_in: str | None = Field(default=None, pattern=CURRENCY_PATTERN)
    occurred_at: dt.date
    subtype: TransferSubtype
    note: str | None = Field(default=None, max_length=500)

    @field_validator("currency_out", "currency_in")
    @classmethod
    def _uppercase_currency(cls, value: str | None) -> str | None:
        return value.upper() if value is not None else value


class TransferPatch(ApiRequestModel):
    """§5.31 request body: ``occurred_at`` / ``subtype`` / ``note`` write both legs.

    ``note`` accepts an explicit ``null`` (clears both legs' note, per the
    table's ``str | null`` typing); every other field rejects an explicit
    ``null``.
    """

    updated_at: UtcDatetime
    from_source_id: uuid.UUID | None = None
    to_source_id: uuid.UUID | None = None
    amount_out: PositiveAmount | None = None
    currency_out: str | None = Field(default=None, pattern=CURRENCY_PATTERN)
    amount_in: PositiveAmount | None = None
    currency_in: str | None = Field(default=None, pattern=CURRENCY_PATTERN)
    occurred_at: dt.date | None = None
    subtype: TransferSubtype | None = None
    note: str | None = Field(default=None, max_length=500)

    _reject_null_from_source_id = field_validator("from_source_id", mode="before")(
        staticmethod(_reject_none("from_source_id"))
    )
    _reject_null_to_source_id = field_validator("to_source_id", mode="before")(
        staticmethod(_reject_none("to_source_id"))
    )
    _reject_null_amount_out = field_validator("amount_out", mode="before")(
        staticmethod(_reject_none("amount_out"))
    )
    _reject_null_currency_out = field_validator("currency_out", mode="before")(
        staticmethod(_reject_none("currency_out"))
    )
    _reject_null_amount_in = field_validator("amount_in", mode="before")(
        staticmethod(_reject_none("amount_in"))
    )
    _reject_null_currency_in = field_validator("currency_in", mode="before")(
        staticmethod(_reject_none("currency_in"))
    )
    _reject_null_occurred_at = field_validator("occurred_at", mode="before")(
        staticmethod(_reject_none("occurred_at"))
    )
    _reject_null_subtype = field_validator("subtype", mode="before")(
        staticmethod(_reject_none("subtype"))
    )

    @field_validator("currency_out", "currency_in")
    @classmethod
    def _uppercase_currency(cls, value: str | None) -> str | None:
        return value.upper() if value is not None else value


class TransferLeg(ApiModel):
    """One leg's full 16 fields, shared by §5.30 and §5.33 (decision §14.53f)."""

    id: uuid.UUID
    source_id: uuid.UUID
    kind: Literal["transfer"]
    occurred_at: dt.date
    transfer_role: TransferRole
    transfer_subtype: TransferSubtype
    amount: Amount
    currency: str
    counterparty: str | None
    amount_base: Amount | None
    rate_used: Rate | None
    rate_date: dt.date | None
    transfer_pair_id: uuid.UUID
    note: str | None
    created_at: UtcDatetime
    updated_at: UtcDatetime


class TransferResponse(_WithInLeg):
    """§5.30 (create) and §5.33 (pair) response — same shape (decision §14.53f)."""

    pair_id: uuid.UUID
    occurred_at: dt.date
    subtype: TransferSubtype
    note: str | None
    out: TransferLeg
    in_: TransferLeg = Field(..., alias="in")
    updated_at: UtcDatetime


class PairRequest(ApiRequestModel):
    """§5.33 request body."""

    other_transaction_id: uuid.UUID


class UnpairedLeg(ApiModel):
    """One entry of §5.34's ``unpaired[]`` — a subset of ``TransferLeg``'s fields."""

    id: uuid.UUID
    source_id: uuid.UUID
    kind: Literal["transfer"]
    transfer_role: TransferRole
    transfer_subtype: TransferSubtype
    amount: Amount
    currency: str
    transfer_pair_id: uuid.UUID | None
    counterparty: str | None
    updated_at: UtcDatetime


class UnpairResponse(ApiModel):
    """§5.34 response."""

    pair_id: uuid.UUID
    unpaired: list[UnpairedLeg]
