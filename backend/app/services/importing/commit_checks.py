"""What ``committing.py`` checks before it writes anything (05 §4.3).

Split out of ``committing.py`` for the same reason ``drafts.py`` / ``rules.py``
were split out of ``validation.py``: one file, one job, under 400 lines. The
public names of §0.3 stay in ``committing.py``, which re-exports
:class:`CommitRejected` and :func:`load_context` so callers have one import.

Every rejection here is a *pre*-commit rejection: it happens before the first
INSERT, so "any one row is wrong → nothing is written" costs no rollback.
:func:`assert_pairable` is the exception that runs twice — once here on the
unlocked row, once in ``committing.py`` on the locked one, because another
session may pair the same single leg in between (§4.5 ①).
"""
from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.categories import CATEGORY_VERSION, validate_category
from app.core.errors import ApiError, ErrorCode
from app.models.finance_source import FinanceSource
from app.models.import_batch import ImportBatch, ImportRow
from app.models.ledger import Ledger
from app.models.transaction import Transaction
from app.services import source_access
from app.services.importing.drafts import ImportContext


class CommitRejected(ApiError):
    """A §4.3 rejection carrying the row numbers the user has to fix.

    ``rows`` is an extension field on these codes (03 §5.43): the standard
    ``{detail, code}`` body still applies, so the endpoint renders :meth:`body`
    the way it renders ``ImportFormatInvalid``'s.
    """

    def __init__(
        self, status_code: int, code: str, detail: str, rows: Sequence[int] = ()
    ) -> None:
        super().__init__(status_code, code, detail)
        self.rows = list(rows)

    def body(self) -> dict:
        """The full response body, ``rows`` included (03 §5.43)."""
        return {"detail": self.detail, "code": self.code, "rows": self.rows}


def load_context(db: Session, batch: ImportBatch) -> ImportContext:
    """The read-only context of §0.3 for a batch that is already stored.

    It carries no statement content whatsoever, because it is logged (§6.3).
    """
    source = db.get(FinanceSource, batch.source_id)
    ledger = db.get(Ledger, batch.ledger_id)
    if source is None or ledger is None:  # pragma: no cover - foreign keys
        raise ApiError(404, ErrorCode.NOT_FOUND, "Import batch not found")
    return ImportContext(
        ledger_id=batch.ledger_id,
        source_id=batch.source_id,
        source_currency=source.default_currency,
        source_type=source.type,
        base_currency=ledger.base_currency,
        actor_id=batch.created_by,
        category_version=CATEGORY_VERSION,
    )


def validate_batch(
    db: Session, batch: ImportBatch, ctx: ImportContext
) -> list[ImportRow]:
    """Every check of §4.3, in order; returns the rows that will be booked."""
    if batch.status == "committed":
        raise CommitRejected(
            409, ErrorCode.BATCH_ALREADY_COMMITTED, "This batch is already committed"
        )
    if batch.status != "ready":
        raise CommitRejected(409, ErrorCode.BATCH_NOT_READY, "This batch is not ready")

    source = db.get(FinanceSource, batch.source_id)
    ledger = db.get(Ledger, batch.ledger_id)
    # The target account may have been unshared since the upload (§14.62): the
    # uploader can no longer book on it here, which is the same 404 as a gone
    # account. Archival stays its own 409.
    if (
        source is None
        or ledger is None
        or not source_access.is_usable(db, ctx.actor_id, ledger.id, source)
    ):
        raise CommitRejected(404, ErrorCode.NOT_FOUND, "Account not found")
    if source.archived:
        raise CommitRejected(
            409, ErrorCode.SOURCE_ARCHIVED, f"Account {source.name!r} is archived"
        )

    rows = list(
        db.execute(
            select(ImportRow)
            .where(ImportRow.batch_id == batch.id, ImportRow.status != "skipped")
            .order_by(ImportRow.row_no)
        )
        .scalars()
        .all()
    )
    if not rows:
        raise CommitRejected(
            409, ErrorCode.ROWS_ALL_SKIPPED, "Every row of this batch is skipped"
        )

    incomplete = [row.row_no for row in rows if _is_incomplete(row)]
    if incomplete:
        raise CommitRejected(
            409,
            ErrorCode.BATCH_NOT_READY,
            f"{len(incomplete)} row(s) still miss a date, amount, currency or kind",
            incomplete,
        )
    blank = [r.row_no for r in rows if r.kind != "transfer" and r.category_l1 is None]
    if blank:
        raise CommitRejected(
            409,
            ErrorCode.ROWS_UNCATEGORIZED,
            f"{len(blank)} row(s) still have no category",
            blank,
        )

    for row in rows:
        _validate_row(db, batch, ctx, row)
    return rows


def _is_incomplete(row: ImportRow) -> bool:
    """§4.3: what a transaction cannot be built without."""
    if None in (row.occurred_at, row.amount, row.currency, row.kind) or row.amount == 0:
        return True
    # A transfer needs both of its columns (02 §1.6's CHECKs); a draft can be
    # left without them by a PATCH that only changed ``kind``.
    return row.kind == "transfer" and (
        row.transfer_role is None or row.transfer_subtype is None
    )


def _validate_row(
    db: Session, batch: ImportBatch, ctx: ImportContext, row: ImportRow
) -> None:
    """The per-row 400s of §4.3, raised with the offending row number."""
    try:
        validate_category(str(row.kind), row.category_l1, row.category_l2)
    except ApiError as exc:  # category_invalid / category_kind_mismatch
        raise CommitRejected(exc.status_code, exc.code, exc.detail, [row.row_no]) from exc

    matched = row.matched_transaction_id
    if row.kind == "refund" and matched is not None:
        target = db.get(Transaction, matched)
        if (
            target is None
            or target.ledger_id != batch.ledger_id
            or target.kind != "expense"
        ):
            raise CommitRejected(
                400,
                ErrorCode.REFUND_TARGET_INVALID,
                "refund_of must point at an expense in this ledger",
                [row.row_no],
            )
    if row.kind != "transfer":
        return

    if matched is not None:  # ① pairing wins; the other column is left alone
        assert_pair_target(db, db.get(Transaction, matched), row, batch)
    elif row.counterpart_source_id is not None:  # ②
        far = load_counterpart(db, batch, row)
        # 03 §5.43: this landing builds a pair, it does not tie two existing
        # legs, so §14.53a's downgrade does not reach it — the incoming leg has
        # to be a credit account, as in POST .../transactions/transfer.
        _assert_repayment_target(
            row, ctx.source_type if row.transfer_role == "in" else far.type
        )
    elif row.transfer_role == "in":
        # ③ single leg: no second leg to downgrade, so A11 is enforced outright.
        _assert_repayment_target(row, ctx.source_type)


def _assert_repayment_target(row: ImportRow, in_source_type: str) -> None:
    """Decision §14.52 A11: a ``repayment`` may only land on a credit account."""
    if row.transfer_subtype == "repayment" and in_source_type != "credit":
        raise CommitRejected(
            400,
            ErrorCode.REPAYMENT_TARGET_NOT_CREDIT,
            "A repayment must land on a credit account",
            [row.row_no],
        )


def assert_pairable(
    far: Transaction | None, row: ImportRow, batch: ImportBatch
) -> Transaction:
    """§4.3 / §4.5 ①'s ``pair_invalid`` conditions, judged on the row given."""
    reason: str | None = None
    if far is None or far.ledger_id != batch.ledger_id or far.kind != "transfer":
        reason = "The pair target must be a transfer in this ledger"
    elif far.transfer_pair_id is not None:
        reason = "The pair target is no longer a single leg"
    elif far.transfer_role == row.transfer_role:
        reason = "The two legs must point in opposite directions"
    elif far.source_id == batch.source_id:
        reason = "The two legs must be on different accounts"
    if reason is not None or far is None:
        raise CommitRejected(400, ErrorCode.PAIR_INVALID, str(reason), [row.row_no])
    return far


def assert_pair_target(
    db: Session, far: Transaction | None, row: ImportRow, batch: ImportBatch
) -> Transaction:
    """§4.5 ①'s checks at commit: :func:`assert_pairable`, then §5.33 check 1a.

    Pairing touches the existing leg too, so both legs' accounts must be
    usable by the uploader in this ledger and live — the same rule as
    ``POST .../pair`` (decision §14.62 e). The near leg is the batch's own
    account, already judged by :func:`validate_batch`; this judges the far
    one: someone else's account unshared from here is 404, archived is 409.
    """
    far = assert_pairable(far, row, batch)
    source = db.get(FinanceSource, far.source_id)
    if source is None or not source_access.is_usable(
        db, batch.created_by, batch.ledger_id, source
    ):
        raise CommitRejected(
            404, ErrorCode.NOT_FOUND, "Pair target's account not found", [row.row_no]
        )
    if source.archived:
        raise CommitRejected(
            409,
            ErrorCode.SOURCE_ARCHIVED,
            f"Account {source.name!r} is archived",
            [row.row_no],
        )
    return far


def load_counterpart(db: Session, batch: ImportBatch, row: ImportRow) -> FinanceSource:
    """The counterpart account of §4.5 ②: usable, not archived, not self.

    Usable means usable by the batch's uploader in the batch's ledger — theirs,
    or shared into it (§14.62); a counterpart unshared after review is the same
    404 as an archived or deleted one.
    """
    if row.counterpart_source_id == batch.source_id:
        raise CommitRejected(
            400,
            ErrorCode.SAME_SOURCE,
            "The two legs of a transfer must be on different accounts",
            [row.row_no],
        )
    source = db.get(FinanceSource, row.counterpart_source_id)
    if (
        source is None
        or source.archived
        or not source_access.is_usable(db, batch.created_by, batch.ledger_id, source)
    ):
        raise CommitRejected(
            404, ErrorCode.NOT_FOUND, "Counterpart account not found", [row.row_no]
        )
    return source


def lock_batch(db: Session, batch_id: uuid.UUID) -> ImportBatch:
    """``SELECT ... FOR UPDATE`` on the batch row (§4.7; SQLite ignores it)."""
    batch = db.execute(
        select(ImportBatch)
        .where(ImportBatch.id == batch_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if batch is None:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Import batch not found")
    return batch


def lock_transaction(db: Session, transaction_id: uuid.UUID) -> Transaction | None:
    """Lock one pair target so two batches cannot claim the same single leg.

    The flush matters: this session does not autoflush, and ``populate_existing``
    would otherwise overwrite a pair id written a few rows earlier in the same
    commit with the stale row still in the database — two rows of one batch
    could then both claim the same leg.
    """
    db.flush()
    return db.execute(
        select(Transaction)
        .where(Transaction.id == transaction_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def source_type(db: Session, source_id: uuid.UUID) -> str:
    """One ``finance_sources.type`` lookup (decision §14.48)."""
    source = db.get(FinanceSource, source_id)
    return source.type if source is not None else "other"


def count_where(db: Session, model: type, *criteria) -> int:
    """``SELECT count(*)`` over one model with the given filters."""
    return (
        db.execute(select(func.count()).select_from(model).where(*criteria))
    ).scalar() or 0
