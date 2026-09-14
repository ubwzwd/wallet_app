"""What ``imports.py``'s eight routes are made of (03-backend-api.md §5.37-§5.44).

**This module has no ``router``** — ``app.api.iter_routers()`` imports it and
skips it, exactly as it skips anything else without one. It exists because the
eight routes of §5.37-§5.44 plus §4.9's derived fields and §4.1's draft-row
rules do not fit one file under the 400-line budget; the split is the same one
``services/importing`` made between ``committing.py`` and ``commit_checks.py``:
the routes stay readable, the rules they apply live next door.

Three groups live here:

* **Reading §5.37's request** — the multipart half is parsed here rather than
  through ``request.form()``, because Starlette's parser spools a part over
  1 MB into a temporary *file* and decision §14.28 leaves the backend no
  filesystem state at all. Bytes in, drafts out, nothing touches disk.
* **Patching draft rows** (§5.41 / §5.42, 05 §4.1), including the all-or-nothing
  guarantee the bulk endpoint needs.
* **Building a batch payload** — the six derived fields of §4.9, computed fresh
  (02 §1.7 stores no redundant counters).
"""
from __future__ import annotations

import datetime as dt
import uuid
from collections import Counter, defaultdict
from decimal import Decimal

from fastapi import Request
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.categories import validate_category
from app.core.clock import utcnow
from app.core.config import settings
from app.core.deps import LedgerContext
from app.core.errors import ApiError, ErrorCode
from app.models.finance_source import FinanceSource
from app.models.import_batch import ImportBatch, ImportRow
from app.models.transaction import Transaction
from app.schemas.importing import ImportBatchResponse, ImportRowPatch, PasteUploadRequest
from app.services import valuation
from app.services.importing.commit_checks import assert_pairable, load_counterpart
from app.services.importing.drafts import RowDraft
from app.services.importing.rules import sanitize_category

#: §2.6's 2 MB ceiling, plus the slack a multipart envelope adds around a file
#: that sits exactly at it. The stream is cut at the sum; the 413 of §5.37 is
#: decided on the payload itself.
MAX_BYTES = settings.MAX_UPLOAD_MB * 1024 * 1024
ENVELOPE_SLACK = 64 * 1024

MAX_FILENAME = 200  # §5.37: display only, control characters filtered out
FLAG_NAMES = ("duplicate", "refund_candidate", "transfer_candidate", "needs_review")
ROW_STATUSES = ("pending", "edited", "skipped")
#: §4.1: changing ``kind`` drops what the old kind's flagging had decided.
CANDIDATE_FLAGS = ("refund_candidate", "transfer_candidate")

# The batch columns that go out verbatim (02 §1.7 names, decision §14.53e).
_BATCH_COLUMNS = (
    "id", "ledger_id", "source_id", "source", "filename", "size_bytes",
    "skill_version", "status", "row_count", "warnings", "created_by",
    "created_at", "updated_at", "committed_at",
)

# Wire field -> column, for the one field whose names differ (decision §14.41).
_PATCH_COLUMNS = {"date": "occurred_at"}

# What a patch may move, and therefore what has to be put back when a bulk
# patch is refused half way through (§5.42: all or nothing).
_ROW_STATE = (
    "status", "occurred_at", "amount", "currency", "kind", "merchant", "note",
    "category_l1", "category_l2", "matched_transaction_id",
    "counterpart_source_id", "counterparty", "transfer_role",
    "transfer_subtype", "hint", "flags", "updated_at",
)


# ---------------------------------------------------------------------------
# §5.37's two request bodies
# ---------------------------------------------------------------------------


async def read_request(request: Request) -> tuple[uuid.UUID, bytes | str, str | None]:
    """``(source_id, payload, filename)``; ``filename`` is ``None`` for a paste."""
    body = await _read_capped(request)
    content_type = request.headers.get("content-type", "")
    if content_type.lower().startswith("multipart/form-data"):
        fields = _parse_multipart(body, content_type)
        if "file" not in fields or "source_id" not in fields:
            raise invalid_form("multipart body needs a file and a source_id part")
        filename, data = fields["file"]
        return _as_uuid(fields["source_id"][1]), data, _clean_filename(filename)
    try:
        paste = PasteUploadRequest.model_validate_json(body)
    except ValidationError as exc:
        raise invalid_form(f"body: {exc.error_count()} invalid field(s)") from exc
    return paste.source_id, paste.text, None


async def _read_capped(request: Request) -> bytes:
    """Read the body, giving up as soon as it passes the ceiling (§5.37 step 4).

    The cap runs before the target account is looked up, because ``source_id``
    is *inside* the body: a body too large to read is a 413 with nothing to say
    about the account it names.
    """
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_BYTES + ENVELOPE_SLACK:
            raise too_large()
        chunks.append(chunk)
    return b"".join(chunks)


def _parse_multipart(body: bytes, content_type: str) -> dict[str, tuple[str | None, bytes]]:
    """Split a ``multipart/form-data`` body into ``{name: (filename, bytes)}``.

    Deliberately minimal: §5.37's form has exactly two parts, neither of which
    is streamed anywhere, and the whole upload stays in memory (§4.11).
    """
    boundary = _params(content_type.partition(";")[2]).get("boundary")
    if not boundary:
        raise invalid_form("multipart body has no boundary")
    fields: dict[str, tuple[str | None, bytes]] = {}
    for part in body.split(b"--" + boundary.encode("utf-8", "replace"))[1:-1]:
        head, sep, payload = part.lstrip(b"\r\n").partition(b"\r\n\r\n")
        if not sep:
            continue
        disposition: dict[str, str] = {}
        for line in head.decode("utf-8", "replace").splitlines():
            name, _, value = line.partition(":")
            if name.strip().lower() == "content-disposition":
                disposition = _params(value)
        if "name" in disposition:
            if payload.endswith(b"\r\n"):
                payload = payload[:-2]
            fields[disposition["name"]] = (disposition.get("filename"), payload)
    return fields


def _params(text: str) -> dict[str, str]:
    """``form-data; name="file"; filename="a.csv"`` -> its parameters, unquoted."""
    values: dict[str, str] = {}
    for chunk in text.split(";"):
        key, sep, value = chunk.partition("=")
        if sep:
            values[key.strip().lower()] = value.strip().strip('"')
    return values


def _clean_filename(name: str | None) -> str:
    """§5.37: display only — no path, no control characters, at most 200 chars."""
    text = "".join(ch for ch in (name or "") if ch.isprintable()).strip()
    text = text.replace("\\", "/").rsplit("/", 1)[-1]
    return text[:MAX_FILENAME] or "upload.csv"


def _as_uuid(raw: bytes) -> uuid.UUID:
    try:
        return uuid.UUID(raw.decode("utf-8", "replace").strip())
    except ValueError as exc:
        raise invalid_form("source_id is not a UUID") from exc


# ---------------------------------------------------------------------------
# Draft rows: storing (§5.37) and patching (§5.41 / §5.42)
# ---------------------------------------------------------------------------


def draft_row(batch_id: uuid.UUID, draft: RowDraft, now: dt.datetime) -> ImportRow:
    """One validated :class:`RowDraft` as an ``import_rows`` row (02 §1.8)."""
    return ImportRow(
        batch_id=batch_id,
        row_no=draft.row_no,
        status="pending",
        occurred_at=draft.occurred_at,
        amount=draft.amount,
        currency=draft.currency,
        kind=draft.kind,
        transfer_role=draft.transfer_role,
        transfer_subtype=draft.transfer_subtype,
        merchant=draft.merchant,
        note=draft.note,
        category_l1=draft.category_l1,
        category_l2=draft.category_l2,
        source_ref=draft.source_ref,
        hint=draft.hint,
        flags=sorted(draft.flags),
        matched_transaction_id=draft.matched_transaction_id,
        counterpart_source_id=draft.counterpart_source_id,
        counterparty=draft.counterparty,
        created_at=now,
        updated_at=now,
    )


def patch_rows(
    db: Session,
    ctx: LedgerContext,
    batch: ImportBatch,
    rows: list[ImportRow],
    patch: ImportRowPatch,
) -> None:
    """Apply one patch to every row, or leave all of them exactly as they were.

    The session is never flushed in between (``autoflush`` is off everywhere),
    so putting the saved column values back undoes a partial run — and it undoes
    only *these* rows, unlike a ``rollback()``, which would also throw away
    whatever else the caller's transaction is holding.
    """
    saved = [{name: getattr(row, name) for name in _ROW_STATE} for row in rows]
    now = utcnow()
    for row in rows:
        try:
            _apply_patch(db, ctx, batch, row, patch, now)
        except ApiError as exc:
            for target, state in zip(rows, saved):
                for name, value in state.items():
                    setattr(target, name, value)
            detail = exc.detail if len(rows) == 1 else f"row {row.row_no}: {exc.detail}"
            raise ApiError(exc.status_code, exc.code, detail, exc.headers) from exc
    batch.updated_at = now


def _apply_patch(
    db: Session,
    ctx: LedgerContext,
    batch: ImportBatch,
    row: ImportRow,
    patch: ImportRowPatch,
    now: dt.datetime,
) -> None:
    """§4.1's rules for one row: apply, re-check, then set the row's status."""
    data = patch.model_dump(exclude_unset=True)
    new_status = data.pop("status", None)
    kind_changed = "kind" in data and data["kind"] != row.kind
    for name, value in data.items():
        setattr(row, _PATCH_COLUMNS.get(name, name), value)

    if kind_changed:
        # §4.1: a link found under the old kind would be written into
        # ``refund_of`` or used as a pairing target by §4.4 / §4.5 under the new
        # one, so both go — unconditionally, with the flags that produced them.
        row.matched_transaction_id = None
        row.counterpart_source_id = None
        row.flags = [name for name in (row.flags or ()) if name not in CANDIDATE_FLAGS]
    if row.kind != "transfer":
        row.transfer_role = None
        row.transfer_subtype = None

    _check_row(db, ctx, batch, row, touched=set(data))
    # Any edit makes the row ``edited``; only an explicit "skipped" is different
    # (§5.41's state diagram, decision §14.52 B13: there is no "confirmed").
    row.status = "skipped" if new_status == "skipped" else "edited"
    row.updated_at = now


def _check_row(
    db: Session, ctx: LedgerContext, batch: ImportBatch, row: ImportRow, touched: set[str]
) -> None:
    """§5.41's error table, judged on the row *after* the edit."""
    if row.kind == "transfer":
        if row.merchant:
            raise invalid("a transfer row must not carry a merchant")
        if row.transfer_role is None or row.transfer_subtype is None:
            raise invalid("a transfer row needs transfer_role and transfer_subtype")
    elif row.counterpart_source_id is not None:
        raise invalid("counterpart_source_id only applies to a transfer row")

    _check_category(row, touched)
    _check_sign(row)

    matched = row.matched_transaction_id
    if matched is not None:
        if row.kind == "refund":
            _check_refund_target(db, ctx, matched)
        elif row.kind == "transfer":
            # The six conditions of §5.33, judged on the draft (400 pair_invalid).
            assert_pairable(db.get(Transaction, matched), row, batch)
        else:
            raise invalid("matched_transaction_id needs a refund or transfer row")
    if row.counterpart_source_id is not None:
        load_counterpart(db, batch, row)  # 404 not_found / 400 same_source (§14.53c)


def _check_category(row: ImportRow, touched: set[str]) -> None:
    """A category the request named is judged strictly; one left over is repaired.

    A draft may sit without a category (decision §1.3), so "no category" is
    never an error here — that is commit's ``rows_uncategorized``. But a category
    that no longer fits the row's ``kind`` has to go somewhere: if this request
    named it, the answer is a 400; if the request only changed ``kind`` and left
    the category behind, §2.4 ⑦'s repair clears it and says so in the ``hint``.
    """
    if row.kind is None:
        return
    if row.category_l1 is None:
        row.category_l2 = None  # a second level without a first means nothing
        return
    if touched & {"category_l1", "category_l2"}:
        validate_category(row.kind, row.category_l1, row.category_l2)
        return
    category_l1, category_l2, hint = sanitize_category(
        row.kind, row.category_l1, row.category_l2
    )
    if hint:
        row.category_l1, row.category_l2, row.hint = category_l1, category_l2, hint


def _check_sign(row: ImportRow) -> None:
    """§5.26's sign rule, which the CHECKs of 02 §1.6 enforce again at commit."""
    amount, kind = row.amount, row.kind
    if amount is None or kind is None:
        return
    positive = amount > 0
    if kind == "expense" and positive:
        raise invalid("an expense amount must be negative")
    if kind in ("income", "refund") and not positive:
        raise invalid(f"a {kind} amount must be positive")
    if kind == "transfer":
        if row.transfer_role == "out" and positive:
            raise invalid("an outgoing transfer amount must be negative")
        if row.transfer_role == "in" and not positive:
            raise invalid("an incoming transfer amount must be positive")


def _check_refund_target(db: Session, ctx: LedgerContext, matched: uuid.UUID) -> None:
    """§5.26's ``refund_of`` rule: an expense of this ledger, or nothing."""
    target = db.get(Transaction, matched)
    if target is None or target.ledger_id != ctx.ledger.id or target.kind != "expense":
        raise ApiError(
            400,
            ErrorCode.REFUND_TARGET_INVALID,
            "matched_transaction_id must point at an expense in this ledger",
        )


# ---------------------------------------------------------------------------
# Batch payload (§4.9's derived fields)
# ---------------------------------------------------------------------------


def batch_items(
    db: Session, ctx: LedgerContext, batches: list[ImportBatch]
) -> list[ImportBatchResponse]:
    """Batch rows plus the six derived fields of §4.9, for any number of batches.

    Three queries whatever the page size: the account names, the draft rows of
    every batch on the page, and one ``convert_rows`` for the net amounts.

    ``net_amount`` is in the ledger's base currency (income + refund - expense;
    transfers and skipped rows left out, §4.9). A row still missing a date, an
    amount or a currency, and a row whose currency has no usable rate, add
    nothing rather than being counted at face value — a foreign figure added to
    a base-currency sum would simply be wrong. ``uncategorized_count`` leaves
    skipped rows out too: §5.37 calls it "the ones that must be filled in before
    commit", and commit only looks at rows it will actually book (05 §4.2).
    """
    if not batches:
        return []
    names = dict(
        db.execute(
            select(FinanceSource.id, FinanceSource.name).where(
                FinanceSource.id.in_({batch.source_id for batch in batches})
            )
        ).all()
    )
    flags: dict[uuid.UUID, Counter] = defaultdict(Counter)
    statuses: dict[uuid.UUID, Counter] = defaultdict(Counter)
    uncategorized: Counter = Counter()
    owners: list[uuid.UUID] = []
    convertible: list[tuple[Decimal, str, dt.date]] = []

    rows = db.execute(
        select(
            ImportRow.batch_id,
            ImportRow.status,
            ImportRow.flags,
            ImportRow.kind,
            ImportRow.category_l1,
            ImportRow.amount,
            ImportRow.currency,
            ImportRow.occurred_at,
        ).where(ImportRow.batch_id.in_([batch.id for batch in batches]))
    ).all()
    for batch_id, row_status, row_flags, kind, category_l1, amount, currency, day in rows:
        statuses[batch_id][row_status] += 1
        for name in row_flags or ():
            flags[batch_id][name] += 1
        skipped, transfer = row_status == "skipped", kind == "transfer"
        if not skipped and not transfer and category_l1 is None:
            uncategorized[batch_id] += 1
        if skipped or transfer or None in (amount, currency, day):
            continue
        owners.append(batch_id)
        convertible.append((amount, currency, day))

    net: dict[uuid.UUID, Decimal] = defaultdict(Decimal)
    for owner, value in zip(
        owners, valuation.convert_rows(db, convertible, ctx.ledger.base_currency)
    ):
        if value is not None:
            net[owner] += value[0]

    return [
        ImportBatchResponse.model_validate(
            {
                **{name: getattr(batch, name) for name in _BATCH_COLUMNS},
                "source_name": names.get(batch.source_id, ""),
                "net_amount": valuation.quantize_amount(net[batch.id]),
                "base_currency": ctx.ledger.base_currency,
                "flags_summary": {name: flags[batch.id][name] for name in FLAG_NAMES},
                "row_status_summary": {
                    name: statuses[batch.id][name] for name in ROW_STATUSES
                },
                "uncategorized_count": uncategorized[batch.id],
            }
        )
        for batch in batches
    ]


# ---------------------------------------------------------------------------
# Loaders and error shorthands
# ---------------------------------------------------------------------------


def load_source(db: Session, ctx: LedgerContext, source_id: uuid.UUID) -> FinanceSource:
    """§5.37 step 3: the target account of this file, or 404 / 409."""
    source = db.get(FinanceSource, source_id)
    if source is None or source.ledger_id != ctx.ledger.id:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Account not found")
    if source.archived:
        raise ApiError(409, ErrorCode.SOURCE_ARCHIVED, f"Account {source.name!r} is archived")
    return source


def load_batch(db: Session, ctx: LedgerContext, bid: uuid.UUID) -> ImportBatch:
    """A batch of *this* ledger; anything else is 404 (§3.3)."""
    batch = db.get(ImportBatch, bid)
    if batch is None or batch.ledger_id != ctx.ledger.id:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Import batch not found")
    return batch


def ready_batch(db: Session, ctx: LedgerContext, bid: uuid.UUID) -> ImportBatch:
    """The same, but a committed batch's drafts can no longer be edited (§5.41)."""
    batch = load_batch(db, ctx, bid)
    if batch.status != "ready":
        raise ApiError(409, ErrorCode.BATCH_NOT_READY, "This batch is not ready")
    return batch


def too_large() -> ApiError:
    return ApiError(
        413,
        ErrorCode.FILE_TOO_LARGE,
        f"Import files are limited to {settings.MAX_UPLOAD_MB} MB",
    )


def invalid_form(detail: str) -> ApiError:
    return ApiError(422, ErrorCode.VALIDATION_ERROR, detail)


def invalid(detail: str) -> ApiError:
    return ApiError(400, ErrorCode.VALIDATION_ERROR, detail)
