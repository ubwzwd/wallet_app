"""Commit a draft batch into transactions, and undo it (05 §4.3-§4.8).

:func:`commit_batch` runs §4.3's pre-commit checks (in ``commit_checks.py``),
§4.4's field mapping, the three transfer landings of §4.5 and the event trail of
§4.6; :func:`delete_batch` is §4.8 — ``ready`` discards the drafts, ``committed``
reverts: untie the pairs this batch tied, then delete its transactions and
itself. Both are all-or-nothing inside the caller's transaction (§4.7):
**flush, never commit**, the endpoint owns it, so a row that trips a CHECK
leaves the batch exactly as it was, still ``ready``.

Rules that exist elsewhere are called, not copied:
:func:`~app.core.categories.validate_category`,
:func:`~app.services.transaction_service.unify_subtype`, :mod:`app.services.events`.

Two places where 03 §5.43 and 05 disagree; this stage reads 03 before 05, so 03
wins and the difference is marked where it happens:

* the two legs built from ``counterpart_source_id`` (§4.5 ②) are a *new* pair,
  not a pairing of two existing legs, so decision §14.53a's unification does not
  reach them: a ``repayment`` row whose incoming leg misses a credit account is
  400 ``repayment_target_not_credit``, as through ``POST
  .../transactions/transfer`` (05 §4.5 ② would downgrade it to ``plain``).
* ``created_by`` / ``updated_by`` are the **committing** user (03 §5.43), which
  is what every other write path here does; 05 §4.4 maps them to the uploader.
"""
from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Callable, Literal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models.import_batch import ImportBatch, ImportRow
from app.models.transaction import Transaction
from app.services import events, transaction_service
from app.services.importing.commit_checks import (
    CommitRejected,
    assert_pairable,
    count_where,
    load_context,
    lock_batch,
    lock_transaction,
    source_type,
    validate_batch,
)
from app.services.importing.drafts import ImportContext
from app.services.valuation import quantize_amount

# Re-exported so one import gives a caller the whole §4 contract.
__all__ = ["CommitRejected", "CommitResult", "DeleteResult", "commit_batch",
           "delete_batch", "load_context"]

#: §4.7: flush every N rows so a CHECK violation surfaces early on big batches.
FLUSH_EVERY = 200

#: ``record(tx, event, changes=None)`` bound to one operation (see _recorder).
Recorder = Callable[..., None]


@dataclass(frozen=True)
class CommitResult:
    """What one commit wrote (§0.3 names the first two fields).

    The rest is what 03 §5.43's response body needs on top of them, counted
    here so the endpoint does not have to walk the rows a second time.
    """

    transaction_count: int
    paired_count: int  # rows tied to a single leg that already existed (§4.5 ①)
    created_transfer_pairs: int = 0  # brand new two-leg transfers (§4.5 ②)
    linked_refunds: int = 0  # refund rows that carried a ``refund_of``
    skipped_rows: int = 0
    committed_at: dt.datetime | None = None


@dataclass(frozen=True)
class DeleteResult:
    """What a discard / revert did, or would do under ``dry_run`` (§4.8)."""

    mode: Literal["discard", "revert"]
    transaction_count: int
    orphaned_refunds: int  # refunds *outside* this batch losing their original
    refunds_in_batch: int  # refunds *inside* it; their originals get room back
    deleted: bool


def commit_batch(
    db: Session, batch_id: uuid.UUID, actor_id: uuid.UUID, client: str | None
) -> CommitResult:
    """Book every non-skipped row of one batch (§4.3-§4.7).

    ``client`` is the request's ``X-Client`` and reaches every event written
    here; ``actor_id`` is whoever presses commit, not necessarily the uploader
    (§4.6).
    """
    batch = lock_batch(db, batch_id)
    ctx = load_context(db, batch)
    rows = validate_batch(db, batch, ctx)

    now = utcnow()
    record = _recorder(db, batch, actor_id, client, now)
    created: list[Transaction] = []
    booked: list[tuple[ImportRow, Transaction]] = []
    paired = pairs = refunds = 0

    for index, row in enumerate(rows, start=1):
        if row.kind == "transfer":
            legs = _commit_transfer(db, row, batch, ctx, record, now, actor_id)
            paired += 1 if row.matched_transaction_id is not None else 0
            pairs += 1 if len(legs) == 2 else 0
        else:
            legs = [_build(row, batch, actor_id, now)]
            refunds += 1 if legs[0].refund_of is not None else 0
        db.add_all(legs)
        booked.append((row, legs[0]))  # two-leg rows point at the near leg
        created.extend(legs)
        if index % FLUSH_EVERY == 0:
            db.flush()

    # The back-references only go in once their target rows are in the table:
    # neither import_rows.transaction_id nor transaction_events.transaction_id
    # is an ORM relationship, so the unit of work cannot order them itself.
    db.flush()
    for row, near in booked:
        row.transaction_id = near.id
    for tx in created:
        record(tx, "imported")  # §4.6: changes is NULL, the whole row is new

    batch.status = "committed"
    batch.committed_at = batch.updated_at = now
    db.flush()
    return CommitResult(
        transaction_count=len(created),
        paired_count=paired,
        created_transfer_pairs=pairs,
        linked_refunds=refunds,
        skipped_rows=count_where(
            db, ImportRow, ImportRow.batch_id == batch_id, ImportRow.status == "skipped"
        ),
        committed_at=now,
    )


def _commit_transfer(
    db: Session,
    row: ImportRow,
    batch: ImportBatch,
    ctx: ImportContext,
    record: Recorder,
    now: dt.datetime,
    actor_id: uuid.UUID,
) -> list[Transaction]:
    """The three landings of §4.5; returns the rows to insert, near leg first."""
    near = _build(row, batch, actor_id, now)

    # ① tie this row to a single leg already in the ledger (decision §14.34).
    if row.matched_transaction_id is not None:
        # Judged again on the locked row: another session may have paired it
        # since the pre-commit check, and then this batch rolls back whole.
        far = assert_pairable(lock_transaction(db, row.matched_transaction_id), row, batch)
        was_counterparty, was_subtype = far.counterparty, far.transfer_subtype
        pair_id = uuid.uuid4()
        # The account that decides "repayment" is the one the money lands on.
        near_is_incoming = row.transfer_role == "in"
        in_type = ctx.source_type if near_is_incoming else source_type(db, far.source_id)
        subs = (row.transfer_subtype, far.transfer_subtype)
        out_sub, in_sub = subs[::-1] if near_is_incoming else subs
        subtype = transaction_service.unify_subtype(out_sub, in_sub, in_type)

        near.transfer_pair_id, near.transfer_subtype = pair_id, subtype
        near.counterparty = None
        far.transfer_pair_id, far.transfer_subtype = pair_id, subtype
        far.counterparty = None  # decision §14.34: the text cannot survive this
        far.updated_by, far.updated_at = actor_id, now
        record(
            far,
            "paired",
            {
                "transfer_pair_id": {"before": None, "after": str(pair_id)},
                "counterparty": {
                    "before": events.serialize(was_counterparty),
                    "after": None,
                },
            },
        )
        if was_subtype != subtype:  # §4.6: the rewrite is an edit of its own
            record(
                far,
                "updated",
                events.diff_changes(
                    {"transfer_subtype": was_subtype}, {"transfer_subtype": subtype}
                ),
            )
        return [near]

    # ② the other account is in the app but has no leg yet: build both of them.
    if row.counterpart_source_id is not None:
        pair_id = uuid.uuid4()
        near.transfer_pair_id, near.counterparty = pair_id, None
        far = _build(row, batch, actor_id, now)
        far.source_id = row.counterpart_source_id
        far.amount = -near.amount  # same date and currency as this leg (§4.5 ②)
        far.transfer_role = "out" if row.transfer_role == "in" else "in"
        far.transfer_pair_id, far.counterparty, far.merchant = pair_id, None, None
        return [near, far]

    # ③ single leg: the counterparty text is all there is (decision §14.10).
    near.transfer_pair_id = None
    near.counterparty = row.counterparty
    return [near]


def _build(
    row: ImportRow, batch: ImportBatch, actor_id: uuid.UUID, now: dt.datetime
) -> Transaction:
    """One draft row as a transaction, per §4.4's mapping."""
    transfer = row.kind == "transfer"
    return Transaction(
        id=uuid.uuid4(),  # set here so import_rows.transaction_id can be filled
        ledger_id=batch.ledger_id,
        source_id=batch.source_id,  # one file, one target account (decision §5)
        occurred_at=row.occurred_at,
        amount=_signed_amount(row),
        currency=row.currency,
        kind=row.kind,
        transfer_role=row.transfer_role if transfer else None,
        transfer_subtype=row.transfer_subtype if transfer else None,
        transfer_pair_id=None,
        counterparty=None,  # only a single-leg transfer keeps one (§4.4)
        merchant=row.merchant,
        note=row.note,
        category_l1=row.category_l1,
        category_l2=row.category_l2,
        # Decision §14.7: pre-filled or hand-picked, a refund row's match is its
        # original. §3.2 cleared the column before looking for candidates, so
        # nothing else can be sitting in it.
        refund_of=row.matched_transaction_id if row.kind == "refund" else None,
        import_batch_id=batch.id,  # what a revert goes by (§4.8)
        created_by=actor_id,
        updated_by=actor_id,
        created_at=now,
        updated_at=now,
    )


def _signed_amount(row: ImportRow) -> Decimal:
    """§4.4: the sign follows ``kind`` (§2.4 ⑤ already corrected the draft)."""
    amount = quantize_amount(abs(Decimal(str(row.amount))))
    outgoing = row.kind == "expense" or (
        row.kind == "transfer" and row.transfer_role == "out"
    )
    return -amount if outgoing else amount


def delete_batch(
    db: Session,
    batch_id: uuid.UUID,
    actor_id: uuid.UUID,
    client: str | None = None,
    dry_run: bool = False,
) -> DeleteResult:
    """Discard a ``ready`` batch or revert a ``committed`` one (§4.8).

    Both make the batch disappear (decision §14.22: there is no third status).
    ``dry_run`` only counts the two consequences of B24 and writes nothing.
    """
    batch = lock_batch(db, batch_id)
    mode: Literal["discard", "revert"] = (
        "revert" if batch.status == "committed" else "discard"
    )
    ids = select(Transaction.id).where(Transaction.import_batch_id == batch_id)
    tx_ids = list(db.execute(ids).scalars().all())

    # B24: two opposite directions, counted (and worded) apart.
    orphaned = count_where(
        db,
        Transaction,
        Transaction.kind == "refund",
        Transaction.refund_of.in_(tx_ids),
        Transaction.import_batch_id.is_distinct_from(batch_id),
    )
    in_batch = count_where(
        db,
        Transaction,
        Transaction.id.in_(tx_ids),
        Transaction.kind == "refund",
        Transaction.refund_of.isnot(None),
    )
    if dry_run:
        return DeleteResult(mode, len(tx_ids), orphaned, in_batch, deleted=False)

    _unpair_survivors(db, batch, actor_id, client)
    # Core deletes in the order 03 §5.44 writes them: the transactions (their
    # own events follow through ON DELETE CASCADE, and a refund outside the
    # batch keeps its row with refund_of set to NULL), the draft rows, the
    # batch. Deleting the rows outright rather than leaning on the cascade
    # keeps the ORM from trying to null their NOT NULL ``batch_id`` first.
    for stmt in (
        delete(Transaction).where(Transaction.import_batch_id == batch_id),
        delete(ImportRow).where(ImportRow.batch_id == batch_id),
        delete(ImportBatch).where(ImportBatch.id == batch_id),
    ):
        # "fetch" keeps the session honest: the objects these statements remove
        # are evicted instead of lingering in the identity map as rows that no
        # longer exist.
        db.execute(stmt.execution_options(synchronize_session="fetch"))
    db.flush()
    # The database also rewrote rows nobody asked it about: a refund outside
    # the batch had its ``refund_of`` set to NULL (decision §1.1). Expire so a
    # caller that had already loaded one does not keep the stale value.
    db.expire_all()
    return DeleteResult(mode, len(tx_ids), orphaned, in_batch, deleted=True)


def _unpair_survivors(
    db: Session, batch: ImportBatch, actor_id: uuid.UUID, client: str | None
) -> None:
    """Untie the pairs of §4.5 ① before their imported leg is deleted.

    Without this the surviving leg would keep a ``transfer_pair_id`` no second
    leg answers to, and its timeline would not explain why it came loose. Its
    ``counterparty`` stays NULL: the text was cleared when the pair was tied and
    only the ``paired`` event's ``changes`` still remembers it (§4.8).
    """
    pair_ids = list(
        db.execute(
            select(Transaction.transfer_pair_id).where(
                Transaction.import_batch_id == batch.id,
                Transaction.transfer_pair_id.isnot(None),
            )
        )
        .scalars()
        .all()
    )
    if not pair_ids:
        return

    survivors = (
        db.execute(
            select(Transaction)
            .where(
                Transaction.transfer_pair_id.in_(pair_ids),
                Transaction.import_batch_id.is_distinct_from(batch.id),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        .scalars()
        .all()
    )
    now = utcnow()
    record = _recorder(db, batch, actor_id, client, now)
    for far in survivors:
        was_pair = far.transfer_pair_id
        far.transfer_pair_id = None
        far.updated_by, far.updated_at = actor_id, now
        record(
            far,
            "unpaired",
            {"transfer_pair_id": {"before": str(was_pair), "after": None}},
        )
    db.flush()  # land the untying before the deletes


def _recorder(
    db: Session,
    batch: ImportBatch,
    actor_id: uuid.UUID,
    client: str | None,
    at: dt.datetime,
) -> Recorder:
    """``record(tx, event, changes=None)`` for one import operation (§4.6).

    Every event of a commit or revert shares batch, actor, client and instant.
    """

    def record(
        tx: Transaction, event: str, changes: dict[str, dict] | None = None
    ) -> None:
        events.record(
            db,
            ledger_id=batch.ledger_id,
            transaction_id=tx.id,
            actor_id=actor_id,
            event=event,  # type: ignore[arg-type]
            changes=changes,
            import_batch_id=batch.id,
            client=client,
            at=at,
        )

    return record
