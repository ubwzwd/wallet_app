"""What ``imports.py``'s eight routes are made of (03-backend-api.md §5.37-§5.44).

**This module has no ``router``** — ``app.api.iter_routers()`` imports it and
skips it, exactly as it skips anything else without one. It exists because the
eight routes of §5.37-§5.44 and everything they apply do not fit one file under
the 400-line budget; the split is the same one ``services/importing`` made
between ``committing.py`` and ``commit_checks.py``: the routes stay readable,
the rules they apply live next door.

What lives here is §4.1's draft-row rules — §5.41 / §5.42's patching, including
the all-or-nothing guarantee the bulk endpoint needs — plus the three loaders
and the error shorthands the routes share. Reading §5.37's request body is
``import_upload.py``; §4.9's derived fields are ``import_batches.py``.
"""
from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy.orm import Session

from app.core.categories import validate_category
from app.core.clock import utcnow
from app.core.config import settings
from app.core.deps import LedgerContext
from app.core.errors import ApiError, ErrorCode
from app.models.finance_source import FinanceSource
from app.models.import_batch import ImportBatch, ImportRow
from app.models.transaction import Transaction
from app.schemas.importing import ImportRowsBulkRowPatch
from app.services import source_access
from app.services.importing import flagging
from app.services.importing.commit_checks import assert_pair_target, load_counterpart
from app.services.importing.drafts import ImportContext, RowDraft
from app.services.importing.rules import sanitize_category

#: §2.6's 2 MB ceiling, on the payload itself (§5.37's 413).
MAX_BYTES = settings.MAX_UPLOAD_MB * 1024 * 1024

MAX_FILENAME = 200  # §5.37: display only, control characters filtered out
#: §4.1: changing ``kind`` drops what the old kind's flagging had decided.
CANDIDATE_FLAGS = ("refund_candidate", "transfer_candidate")
#: The patch fields that put the sign and its ``kind`` back under discussion.
_SIGN_INPUTS = {"amount", "kind", "transfer_role"}
#: …and the ones that put each of the two link columns back under discussion.
_MATCH_INPUTS = {"matched_transaction_id", "kind"}
_PAIR_INPUTS = {"matched_transaction_id", "kind", "transfer_role"}
_LINK_INPUTS = {"counterpart_source_id", "kind"}

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
    patch: ImportRowsBulkRowPatch,
    *,
    bulk: bool,
) -> None:
    """Apply one patch to every row, or leave all of them exactly as they were.

    The session is never flushed in between (``autoflush`` is off everywhere),
    so putting the saved column values back undoes a partial run — and it undoes
    only *these* rows, unlike a ``rollback()``, which would also throw away
    whatever else the caller's transaction is holding.

    ``bulk`` decides the shape of the refusal, not its content: §5.42 wants
    ``detail`` to name the offending row even when the call happened to carry a
    single id, while §5.41 has only one row to talk about.
    """
    saved = [{name: getattr(row, name) for name in _ROW_STATE} for row in rows]
    now = utcnow()
    rekinded: list[ImportRow] = []
    for row in rows:
        try:
            if _apply_patch(db, ctx, batch, row, patch, now):
                rekinded.append(row)
        except ApiError as exc:
            for target, state in zip(rows, saved):
                for name, value in state.items():
                    setattr(target, name, value)
            detail = f"row {row.row_no}: {exc.detail}" if bulk else exc.detail
            raise ApiError(exc.status_code, exc.code, detail, exc.headers) from exc
    if rekinded:
        _rerun_candidates(db, ctx, batch, rekinded, now)
    batch.updated_at = now


def _apply_patch(
    db: Session,
    ctx: LedgerContext,
    batch: ImportBatch,
    row: ImportRow,
    patch: ImportRowsBulkRowPatch,
    now: dt.datetime,
) -> bool:
    """§4.1's rules for one row; returns whether ``kind`` changed."""
    data = patch.model_dump(exclude_unset=True)
    new_status = data.pop("status", None)
    kind_changed = "kind" in data and data["kind"] != row.kind
    for name, value in data.items():
        setattr(row, _PATCH_COLUMNS.get(name, name), value)
    if data:
        # §4.1: the server rewrites ``hint`` after an edit, so a note about a
        # value the user has since corrected disappears. Only a status-only
        # patch keeps it: nothing it says has been invalidated.
        row.hint = None

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
    return kind_changed


def _check_row(
    db: Session, ctx: LedgerContext, batch: ImportBatch, row: ImportRow, touched: set[str]
) -> None:
    """§5.41's error table, judged on what the request put on the row.

    Every rule below runs only when the request named a field that feeds it.
    That distinction matters because a draft row is allowed to be loose:
    decision §1.3 and §2.8's rules 9/10 store an unparseable amount as ``0`` and
    never clear a merchant off a transfer line, so judging the whole row would
    make the importer's own output unpatchable — ``{"status": "skipped"}``
    included, which is the one way out §5.41 gives the user. Setting a bad value
    is still a 400; living with one the file arrived with is not.

    The two link columns are the sharpest case, because §3 fills them in by
    itself: ``flag_duplicates`` writes ``matched_transaction_id`` on *any* kind
    of row that has exactly one same-day same-amount twin — an expense row
    included, which the "needs a refund or transfer row" rule below would
    otherwise freeze forever, and skipping such a row is precisely what that
    flag is for. ``flag_transfer_candidates`` likewise pre-fills
    ``counterpart_source_id``, which the world can invalidate afterwards (the
    account gets archived). Neither is a value the user chose, so neither is
    re-judged until the user touches it; commit re-runs both anyway
    (``commit_checks._validate_row``), which is where §5.43's error table puts
    them, and ``committing._build`` reads ``matched_transaction_id`` only for a
    refund row, so a leftover books correctly.
    """
    if row.kind == "transfer":
        if row.merchant and touched & {"merchant", "kind"}:
            raise invalid("a transfer row must not carry a merchant")
        if row.transfer_role is None or row.transfer_subtype is None:
            raise invalid("a transfer row needs transfer_role and transfer_subtype")
    elif row.counterpart_source_id is not None and touched & _LINK_INPUTS:
        raise invalid("counterpart_source_id only applies to a transfer row")

    _check_category(row, touched)
    _check_sign(row, touched)

    matched = row.matched_transaction_id
    if matched is not None and touched & _MATCH_INPUTS:
        if row.kind == "refund":
            _check_refund_target(db, ctx, matched)
        elif row.kind != "transfer":
            raise invalid("matched_transaction_id needs a refund or transfer row")
    if matched is not None and row.kind == "transfer" and touched & _PAIR_INPUTS:
        # The six conditions of §5.33 (400 pair_invalid) plus check 1a on the far leg's
        # account (404 / 409), judged on the draft — the same gate commit applies, so review
        # cannot accept a pair that commit would refuse.
        assert_pair_target(db, db.get(Transaction, matched), row, batch)
    if row.counterpart_source_id is not None and touched & _LINK_INPUTS:
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


def _check_sign(row: ImportRow, touched: set[str]) -> None:
    """§5.26's sign rule, which the CHECKs of 02 §1.6 enforce again at commit.

    Only for a row whose sign the request had a hand in: §2.4 ⑤ already made
    every *imported* row agree with its own ``kind``, except where §2.8 rule 10
    had nothing to parse and stored ``0``. Such a row is not an error the user
    can be asked to fix before skipping it.
    """
    amount, kind = row.amount, row.kind
    if amount is None or kind is None or not touched & _SIGN_INPUTS:
        return
    positive = amount > 0
    if kind == "expense" and positive:
        raise invalid("an expense amount must be negative")
    if kind == "income" and not positive:
        raise invalid("an income amount must be positive")
    if kind == "refund" and not positive:
        raise invalid("a refund amount must be positive")
    if kind == "transfer":
        if row.transfer_role == "out" and positive:
            raise invalid("an outgoing transfer amount must be negative")
        if row.transfer_role == "in" and not positive:
            raise invalid("an incoming transfer amount must be positive")


def _rerun_candidates(
    db: Session,
    ctx: LedgerContext,
    batch: ImportBatch,
    rows: list[ImportRow],
    now: dt.datetime,
) -> None:
    """§4.1: look the §3.2 / §3.3 candidates up again for a row that changed kind.

    Only the lookup that belongs to the *new* kind runs. §3.2's other trigger —
    money arriving on a credit card — is deliberately left out here: it may
    rewrite ``kind`` itself, and a user who just said "this is income" must not
    be answered with "no, it is a refund". An ``expense`` or ``income`` row has
    no candidates at all, which is why the three fields §4.1 clears stay clear.
    """
    source = db.get(FinanceSource, batch.source_id)
    ictx = ImportContext(
        ledger_id=ctx.ledger.id,
        source_id=batch.source_id,
        source_currency=source.default_currency,
        source_type=source.type,
        base_currency=ctx.ledger.base_currency,
        # Candidates are judged for the uploader, whoever edits the row: commit judges
        # usability for ``batch.created_by`` (``commit_checks.load_context``), so review must
        # not offer a leg that commit will refuse, nor drop one it would accept.
        actor_id=batch.created_by,
        category_version=batch.skill_version,
    )
    drafts = {row.id: _as_draft(row) for row in rows if row.kind in ("refund", "transfer")}
    if not drafts:
        return
    refunds = [draft for draft in drafts.values() if draft.kind == "refund"]
    transfers = [draft for draft in drafts.values() if draft.kind == "transfer"]
    if refunds:
        flagging.flag_refund_candidates(db, ictx, refunds)
    if transfers:
        flagging.flag_transfer_candidates(db, ictx, transfers)
    for row in rows:
        draft = drafts.get(row.id)
        if draft is None:
            continue
        row.matched_transaction_id = draft.matched_transaction_id
        row.counterpart_source_id = draft.counterpart_source_id
        row.category_l1, row.category_l2 = draft.category_l1, draft.category_l2
        row.flags = sorted(draft.flags)
        row.hint = draft.hint
        row.updated_at = now


def _as_draft(row: ImportRow) -> RowDraft:
    """The in-memory shape ``services/importing/flagging`` works on (§0.3)."""
    return RowDraft(
        row_no=row.row_no,
        occurred_at=row.occurred_at,
        amount=row.amount,
        currency=row.currency,
        kind=row.kind,
        transfer_role=row.transfer_role,
        transfer_subtype=row.transfer_subtype,
        merchant=row.merchant,
        note=row.note,
        category_l1=row.category_l1,
        category_l2=row.category_l2,
        source_ref=row.source_ref,
        counterparty=row.counterparty,
        hint=row.hint,
        flags=set(row.flags or ()),
    )


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
# Loaders and error shorthands
# ---------------------------------------------------------------------------


def load_source(db: Session, ctx: LedgerContext, source_id: uuid.UUID) -> FinanceSource:
    """§5.37 step 3: the target account of this file, or 404 / 409.

    It has to be usable by the uploader in this ledger — theirs, or shared into
    it (§3.2, §14.62); anything else is a 404, an archived one a 409.
    """
    source = source_access.load_usable_source(db, ctx.user.id, ctx.ledger, source_id)
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
