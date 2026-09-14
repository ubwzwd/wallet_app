"""Import batch / draft row schemas (03-backend-api.md §5.37-§5.44).

This module only shapes the wire contract: types, enums, lengths, the
explicit-null semantics §5.41 spells out field by field, and the "date" vs.
"occurred_at" name split (decision §14.41's 02-D-3 — the database column and
the ``RowDraft`` dataclass in ``app.services.importing.validation`` are named
``occurred_at`` like ``transactions.occurred_at``, but the file's fixed
header and every wire field stay ``date``). Category legality, sign-vs-kind
coupling, refund/pair legality, and every other cross-field or cross-table
rule are deliberately left to ``app.services.importing`` (cross-task
contract, 05-import-and-llm.md §0.3) — this file must not import it.

Batch field names mirror ``import_batches`` column names one-for-one
(decision §14.53e); draft row field names mirror ``import_rows`` column
names one-for-one except ``date``/``occurred_at`` above. Money fields are
``Decimal`` quantized to 4 decimal places (§4.5) via the ``Amount`` /
``NonzeroAmount`` annotated types (``NonzeroAmount`` imported from
``app.schemas.transaction`` — the one place "must not be zero" is defined —
rather than redefined here; see that module's docstring for why the zero
check is shape-level, not a business rule).
"""
from __future__ import annotations

import datetime as dt
import uuid
from typing import Literal

from pydantic import AliasChoices, Field, field_validator, model_serializer

from app.schemas.common import (
    CURRENCY_PATTERN,
    Amount,
    ApiModel,
    ApiRequestModel,
    UtcDatetime,
)
from app.schemas.transaction import Kind, NonzeroAmount, TransferRole, TransferSubtype

# The four flags §3 / decision §5, §14.31, §14.34 ever produces — no fifth value exists
# (the old "merged duplicate" flag was retired by decision §14.31).
ImportFlag = Literal["duplicate", "refund_candidate", "transfer_candidate", "needs_review"]
ImportBatchStatus = Literal["ready", "committed"]
ImportRowStatus = Literal["pending", "edited", "skipped"]
ImportSource = Literal["csv", "paste"]
DeleteMode = Literal["discard", "revert"]


class PasteUploadRequest(ApiRequestModel):
    """§5.37 branch B: the JSON body for pasting CSV text (the multipart branch has no schema —
    the endpoint reads ``file`` / ``source_id`` straight off ``Form``/``File``)."""

    source_id: uuid.UUID
    text: str


class ImportFlagsSummary(ApiModel):
    """§5.37's ``flags_summary``: one count per flag, always all four keys (decision §14.52 A17)."""

    duplicate: int
    refund_candidate: int
    transfer_candidate: int
    needs_review: int


class ImportRowStatusSummary(ApiModel):
    """§5.37's ``row_status_summary``: one count per row status (decision §14.52 B13)."""

    pending: int
    edited: int
    skipped: int


class ImportBatchResponse(ApiModel):
    """§5.38 / §5.39 batch shape (also the ``batch`` half of §5.37's 201 body).

    Field names before ``source_name`` mirror ``import_batches`` (02-database.md §1.7)
    one-for-one (decision §14.53e); ``source_name`` / ``net_amount`` / `base_currency`` /
    ``flags_summary`` / ``row_status_summary`` / ``uncategorized_count`` are derived —
    computed fresh by the service layer on every read, not stored columns.
    """

    id: uuid.UUID
    ledger_id: uuid.UUID
    source_id: uuid.UUID
    source_name: str
    source: ImportSource
    filename: str | None
    size_bytes: int
    skill_version: str
    status: ImportBatchStatus
    row_count: int
    net_amount: Amount
    base_currency: str
    flags_summary: ImportFlagsSummary
    row_status_summary: ImportRowStatusSummary
    uncategorized_count: int
    warnings: list[str] = []
    created_by: uuid.UUID
    created_at: UtcDatetime
    updated_at: UtcDatetime
    committed_at: UtcDatetime | None

    @field_validator("warnings", mode="before")
    @classmethod
    def _default_warnings(cls, value: object) -> object:
        """The ``warnings`` column is nullable; the wire contract never sends ``null``."""
        return [] if value is None else value


class ImportRowResponse(ApiModel):
    """§5.40 draft row item — one-for-one with ``import_rows`` (02-database.md §1.8)
    except ``date`` (decision §14.41's 02-D-3: the wire/file field is ``date``, the
    column and the ``RowDraft`` dataclass field are ``occurred_at``).

    Every business column but ``row_no`` / ``status`` can be ``None`` on a draft
    (validation is deliberately looser than a real transaction's, decision §1.3) —
    that looseness is the DB's and the service's rule, not enforced again here.
    """

    id: uuid.UUID
    batch_id: uuid.UUID
    row_no: int
    status: ImportRowStatus
    date: dt.date | None = Field(
        default=None, validation_alias=AliasChoices("date", "occurred_at")
    )
    amount: Amount | None
    currency: str | None
    kind: Kind | None
    merchant: str | None
    note: str | None
    category_l1: str | None
    category_l2: str | None
    source_ref: str | None
    flags: list[ImportFlag]
    matched_transaction_id: uuid.UUID | None
    counterpart_source_id: uuid.UUID | None
    counterparty: str | None
    transfer_role: TransferRole | None
    transfer_subtype: TransferSubtype | None
    hint: str | None
    transaction_id: uuid.UUID | None

    @field_validator("flags", mode="before")
    @classmethod
    def _default_flags(cls, value: object) -> object:
        """The ``flags`` column is nullable; the wire contract always sends an array."""
        return [] if value is None else value


def _reject_null_status(value: object) -> object:
    """§5.41: every editable field but ``status`` accepts an explicit ``null`` (a "clear").

    ``status`` is the one exception in that table — it stays ``str`` typed, not
    ``str | null``, because there is no "unset" row status to clear it to.
    """
    if value is None:
        raise ValueError("status does not accept null")
    return value


class ImportRowsBulkRowPatch(ApiRequestModel):
    """§5.42's per-row patch: the fields one request may set on **many** rows at once.

    This is §5.41's editable set minus the three per-row link fields
    (``matched_transaction_id`` / ``counterpart_source_id`` / ``counterparty``),
    which §5.41 adds back in :class:`ImportRowPatch` below.

    Why narrower, when 03 §5.42 says "exactly the same editable fields as
    §5.41": 05 §4.1 names those three fields specifically and gives the reason —
    they identify *one* counterpart for *one* row, so applying one value to a
    selection is meaningless at best and harmful at worst. The same
    ``matched_transaction_id`` on two rows is a guaranteed 400 ``pair_invalid``
    from the second row on at commit time (§4.4 / §4.5: a transaction pairs with
    exactly one leg, a refund links to one original). 03 §5.42's sentence is a
    blanket cross-reference to §5.41's field *set*, while 05 §4.1 is a rule
    written about these three fields by name and with a reason, so the specific
    rule is the one followed here (ruling to be recorded as decision §14.55).
    Sending one is therefore an unknown field and a 422 under
    ``ApiRequestModel``'s ``extra='forbid'`` — the per-row endpoint (§5.41) is
    where a link is set.

    Null semantics (§5.41): every field below accepts an explicit ``null`` to mean
    "clear this field" *except* ``status``, which rejects one (a 422) — omission
    always means "leave it alone" and is what ``exclude_unset=True`` reads back out.
    """

    status: ImportRowStatus | None = None
    date: dt.date | None = None
    amount: NonzeroAmount | None = None
    currency: str | None = Field(default=None, pattern=CURRENCY_PATTERN)
    kind: Kind | None = None
    merchant: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=500)
    category_l1: str | None = None
    category_l2: str | None = None
    transfer_role: TransferRole | None = None
    transfer_subtype: TransferSubtype | None = None

    _reject_null_status = field_validator("status", mode="before")(
        staticmethod(_reject_null_status)
    )

    @field_validator("currency")
    @classmethod
    def _uppercase_currency(cls, value: str | None) -> str | None:
        return value.upper() if value is not None else value


class ImportRowPatch(ImportRowsBulkRowPatch):
    """§5.41 editable fields, all optional; ``updated_at`` is not part of this body —
    draft rows do not use optimistic concurrency, the last write wins.

    Everything :class:`ImportRowsBulkRowPatch` takes, plus the three per-row link
    fields only a single-row request may set (05 §4.1, see that class's docstring).

    ``row_no`` / ``source_ref`` / ``flags`` / ``hint`` / ``transaction_id`` are
    read-only and simply absent from this model, so sending them is an unknown
    field and a 422 (``ApiRequestModel``'s ``extra='forbid'``) — likewise
    ``source_id``, which §5.41 explicitly keeps out of the editable set (decision
    §14.52 A5: one file, one target account; the counterpart account is a
    separate field, ``counterpart_source_id``).
    """

    matched_transaction_id: uuid.UUID | None = None
    counterpart_source_id: uuid.UUID | None = None
    counterparty: str | None = Field(default=None, max_length=100)

    @field_validator("counterparty", mode="before")
    @classmethod
    def _strip_counterparty(cls, value: object) -> object:
        """Decision §14.10: ``strip()`` first, an empty result stores as ``null``."""
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value


class ImportRowsBulkPatch(ApiRequestModel):
    """§5.42 request body: the same one ``patch`` applied to 1..500 rows at once."""

    row_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=500)
    patch: ImportRowsBulkRowPatch


class ImportRowsBulkResult(ApiModel):
    """§5.42 response: how many rows changed, plus their full post-patch shape."""

    updated: int
    rows: list[ImportRowResponse]


class ImportUploadResult(ApiModel):
    """§5.37's 201 body: the new batch plus every draft row, given in full (no paging)."""

    batch: ImportBatchResponse
    rows: list[ImportRowResponse]


class ImportCommitResult(ApiModel):
    """§5.43 response."""

    batch_id: uuid.UUID
    status: Literal["committed"]
    created_transactions: int
    created_transfer_pairs: int
    paired_existing_transfers: int
    linked_refunds: int
    skipped_rows: int
    committed_at: UtcDatetime


class ImportDeleteResult(ApiModel):
    """§5.44 response — the one delete endpoint that isn't a bare 204 (decision §14.43's 03-6).

    ``would_delete_transactions`` is only present for a ``?dry_run=1`` call and
    ``deleted_transactions`` only for a real delete — never both, matching the two
    example bodies exactly. A wrapping serializer drops whichever of the pair is
    unset, the same technique ``transaction.py``'s ``_OptionalRefundFields`` uses for
    ``refunded_total``/``refundable`` (see that module's docstring).
    """

    batch_id: uuid.UUID
    mode: DeleteMode
    would_delete_transactions: int | None = None
    deleted_transactions: int | None = None
    orphaned_refunds: int
    refunds_in_batch: int
    deleted: bool

    @model_serializer(mode="wrap")
    def _drop_the_other_count(self, handler):  # type: ignore[no-untyped-def]
        data = handler(self)
        if self.would_delete_transactions is None:
            data.pop("would_delete_transactions", None)
        else:
            data.pop("deleted_transactions", None)
        return data
