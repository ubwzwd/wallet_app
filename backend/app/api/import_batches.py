"""§4.9's derived batch fields (05 §4.9, 03-backend-api.md §5.37-§5.39).

**No ``router`` here** — ``app.api.iter_routers()`` imports this module and
skips it, exactly as it skips anything else without one.

``import_batches`` stores no counters (02 §1.7): every number a batch shows is
computed from its draft rows at read time. Doing that row by row would mean
pulling up to 50 x 2000 rows into Python for one page of history, so the counts
are aggregates the database computes, and only the two columns no aggregate can
reach — the JSON ``flags`` array, and the ``(amount, currency, date)`` triples
``valuation`` needs — are read back as rows.
"""
from __future__ import annotations

import datetime as dt
import uuid
from collections import Counter, defaultdict
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import LedgerContext
from app.models.finance_source import FinanceSource
from app.models.import_batch import ImportBatch, ImportRow
from app.schemas.importing import ImportBatchResponse
from app.services import valuation

FLAG_NAMES = ("duplicate", "refund_candidate", "transfer_candidate", "needs_review")
ROW_STATUSES = ("pending", "edited", "skipped")

# The batch columns that go out verbatim (02 §1.7 names, decision §14.53e).
_BATCH_COLUMNS = (
    "id", "ledger_id", "source_id", "source", "filename", "size_bytes",
    "skill_version", "status", "row_count", "warnings", "created_by",
    "created_at", "updated_at", "committed_at",
)


#: The rows commit would book, and therefore the only ones §4.9 counts or adds
#: up: a skipped row is not pending work, and a transfer moves no money.
_BOOKABLE = (
    ImportRow.status != "skipped",
    ImportRow.kind.is_distinct_from("transfer"),
)


def batch_items(
    db: Session, ctx: LedgerContext, batches: list[ImportBatch]
) -> list[ImportBatchResponse]:
    """Batch rows plus the six derived fields of §4.9, for any number of batches.

    Five queries whatever the page size: the account names, two ``GROUP BY``
    aggregates, the ``flags`` arrays, the rows that carry money — plus one
    ``convert_rows`` for the net amounts.

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
    ids = [batch.id for batch in batches]
    names = dict(
        db.execute(
            select(FinanceSource.id, FinanceSource.name).where(
                FinanceSource.id.in_({batch.source_id for batch in batches})
            )
        ).all()
    )

    statuses: dict[uuid.UUID, Counter] = defaultdict(Counter)
    for batch_id, row_status, count in db.execute(
        select(ImportRow.batch_id, ImportRow.status, func.count())
        .where(ImportRow.batch_id.in_(ids))
        .group_by(ImportRow.batch_id, ImportRow.status)
    ).all():
        statuses[batch_id][row_status] = count

    uncategorized = dict(
        db.execute(
            select(ImportRow.batch_id, func.count())
            .where(ImportRow.batch_id.in_(ids), *_BOOKABLE, ImportRow.category_l1.is_(None))
            .group_by(ImportRow.batch_id)
        ).all()
    )

    flags: dict[uuid.UUID, Counter] = defaultdict(Counter)
    for batch_id, row_flags in db.execute(
        select(ImportRow.batch_id, ImportRow.flags).where(ImportRow.batch_id.in_(ids))
    ).all():
        for name in row_flags or ():
            flags[batch_id][name] += 1

    net = _net_amounts(db, ctx, ids)
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
                "uncategorized_count": uncategorized.get(batch.id, 0),
            }
        )
        for batch in batches
    ]


def _net_amounts(
    db: Session, ctx: LedgerContext, ids: list[uuid.UUID]
) -> dict[uuid.UUID, Decimal]:
    """§4.9's ``net_amount`` per batch, in the ledger's base currency."""
    owners: list[uuid.UUID] = []
    money: list[tuple[Decimal, str, dt.date]] = []
    for batch_id, amount, currency, day in db.execute(
        select(
            ImportRow.batch_id, ImportRow.amount, ImportRow.currency, ImportRow.occurred_at
        ).where(
            ImportRow.batch_id.in_(ids),
            *_BOOKABLE,
            ImportRow.amount.is_not(None),
            ImportRow.currency.is_not(None),
            ImportRow.occurred_at.is_not(None),
        )
    ).all():
        owners.append(batch_id)
        money.append((amount, currency, day))

    net: dict[uuid.UUID, Decimal] = defaultdict(Decimal)
    for owner, value in zip(
        owners, valuation.convert_rows(db, money, ctx.ledger.base_currency)
    ):
        if value is not None:
            net[owner] += value[0]
    return net
