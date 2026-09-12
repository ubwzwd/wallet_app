"""Transaction, transfer and pairing endpoints (03-backend-api.md §5.25-§5.34).

Declaration order is load bearing (§1.3): the three ``/transfer`` routes are
fixed segments and have to be declared before ``/{tid}`` and ``/{tid}/pair``,
otherwise ``transfer`` would be parsed as a transaction UUID and answered with
a 422.

This module is deliberately thin. Authorization is ``core/deps.py``
(:func:`get_ledger_member`; an invisible ledger is a 404, §3.3), every write
rule lives in ``services/transaction_service.py``, conversion to the ledger's
base currency in ``services/valuation.py``, and the operation trail in
``services/events.py``. What is left here is the read side of §5.25 / §5.27 —
filters, paging, the summary block and the four extra groups of the detail
body — plus committing the transaction the services only flush into.
"""
import datetime as dt
import uuid
from collections.abc import Sequence
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.core import categories
from app.core.database import get_db
from app.core.deps import (
    LedgerContext,
    Pagination,
    client_name,
    get_ledger_member,
    pagination,
)
from app.core.errors import ApiError, ErrorCode
from app.models.finance_source import FinanceSource
from app.models.import_batch import ImportBatch
from app.models.transaction import Transaction
from app.schemas.common import CURRENCY_PATTERN
from app.schemas.transaction import (
    EventItem,
    Kind,
    PairLeg,
    PairRef,
    PairRequest,
    RefundOrigin,
    RefundRef,
    TransactionCreate,
    TransactionDetail,
    TransactionItem,
    TransactionListResponse,
    TransactionPatch,
    TransactionSummary,
    TransferCreate,
    TransferLeg,
    TransferPatch,
    TransferResponse,
    UnpairedLeg,
    UnpairResponse,
)
from app.services import events, transaction_service, valuation
from app.services.transaction_service import SingleTxInput, TransferInput

router = APIRouter(prefix="/ledgers/{id}/transactions", tags=["Transactions"])

# The columns §5.25's item and §5.27's detail share, read straight off the row.
_ROW_FIELDS: tuple[str, ...] = (
    "id",
    "ledger_id",
    "source_id",
    "kind",
    "amount",
    "currency",
    "occurred_at",
    "category_l1",
    "category_l2",
    "merchant",
    "note",
    "counterparty",
    "transfer_role",
    "transfer_subtype",
    "transfer_pair_id",
    "refund_of",
    "import_batch_id",
    "created_by",
    "updated_by",
    "created_at",
    "updated_at",
)

# The columns of one leg in §5.30 / §5.33's transfer object (decision §14.53f).
_LEG_FIELDS: tuple[str, ...] = (
    "id",
    "source_id",
    "kind",
    "occurred_at",
    "transfer_role",
    "transfer_subtype",
    "amount",
    "currency",
    "counterparty",
    "transfer_pair_id",
    "note",
    "created_at",
    "updated_at",
)


# ---------------------------------------------------------------------------
# Response building
# ---------------------------------------------------------------------------


def _valuation_fields(value: valuation.Valuation | None) -> dict[str, object]:
    """The three conversion fields, all ``None`` when no rate could be found."""
    if value is None:
        return {"amount_base": None, "rate_used": None, "rate_date": None}
    return {
        "amount_base": value.amount_base,
        "rate_used": value.rate_used,
        "rate_date": value.rate_date,
    }


def _row_fields(tx: Transaction) -> dict[str, object]:
    return {field: getattr(tx, field) for field in _ROW_FIELDS}


def _item(
    tx: Transaction,
    value: valuation.Valuation | None,
    totals: dict[uuid.UUID, tuple[Decimal, Decimal]],
) -> TransactionItem:
    """One §5.25 list item; ``refunded_total`` / ``refundable`` only on expenses."""
    refunded, refundable = totals.get(tx.id, (None, None))
    return TransactionItem(
        **_row_fields(tx),
        **_valuation_fields(value),
        refunded_total=refunded,
        refundable=refundable,
    )


def _expense_totals(
    db: Session, ctx: LedgerContext, rows: list[Transaction]
) -> dict[uuid.UUID, tuple[Decimal, Decimal]]:
    """``refunded_total`` / ``refundable`` for the expense rows of one page (§5.25).

    One aggregate for the whole page, never one query per row.
    """
    expense_ids = [row.id for row in rows if row.kind == "expense"]
    if not expense_ids:
        return {}
    return transaction_service.refund_totals(db, ctx.ledger, expense_ids)


def _value_one(
    db: Session, ctx: LedgerContext, tx: Transaction
) -> valuation.Valuation | None:
    """Convert a single row on its own ``occurred_at`` (§6.4)."""
    return valuation.value_transactions(db, ctx.ledger.base_currency, [tx])[0]


def _single_body(db: Session, ctx: LedgerContext, tx: Transaction) -> TransactionItem:
    """The §5.26 / §5.28 response body: a list item for one freshly written row."""
    return _item(tx, _value_one(db, ctx, tx), _expense_totals(db, ctx, [tx]))


def _leg_body(
    db: Session, ctx: LedgerContext, legs: tuple[Transaction, Transaction]
) -> tuple[TransferLeg, TransferLeg]:
    """Both legs of a transfer, each converted on its own date (§5.30, §6.4)."""
    out_leg, in_leg = legs
    values = valuation.value_transactions(
        db, ctx.ledger.base_currency, [out_leg, in_leg]
    )
    return tuple(  # type: ignore[return-value]
        TransferLeg(
            **{field: getattr(leg, field) for field in _LEG_FIELDS},
            **_valuation_fields(value),
        )
        for leg, value in zip(legs, values, strict=True)
    )


def _transfer_body(
    db: Session, ctx: LedgerContext, legs: tuple[Transaction, Transaction]
) -> TransferResponse:
    """§5.30 / §5.31 / §5.33 share one shape; the top level is the **outgoing** leg.

    A pair tied together by §5.33 may carry two different dates and two
    different notes; taking the summary from the outgoing leg makes the top
    level the same no matter which leg the caller came in through (decision
    §14.53a).
    """
    out_leg, in_leg = legs
    out_body, in_body = _leg_body(db, ctx, legs)
    return TransferResponse(
        pair_id=out_leg.transfer_pair_id,
        occurred_at=out_leg.occurred_at,
        subtype=out_leg.transfer_subtype,
        note=out_leg.note,
        out=out_body,
        in_=in_body,
        updated_at=max(out_leg.updated_at, in_leg.updated_at),
    )


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------


def _check_filter_category(l1: str | None, l2: str | None) -> None:
    """§5.25: both filter codes must exist, and ``l2`` must sit under ``l1``.

    This is not :func:`categories.validate_category` — a filter has no ``kind``
    to be consistent with, so only the code table is consulted.
    """
    if l1 is not None and categories.find(l1) is None:
        raise ApiError(400, ErrorCode.CATEGORY_INVALID, f"unknown category_l1: {l1}")
    if l2 is None:
        return

    parents = [
        code
        for code in categories.ALL_L1_CODES
        if any(child.code == l2 for child in categories.find(code).children)
    ]
    if not parents:
        raise ApiError(400, ErrorCode.CATEGORY_INVALID, f"unknown category_l2: {l2}")
    if l1 is not None and l1 not in parents:
        raise ApiError(
            400,
            ErrorCode.CATEGORY_INVALID,
            f"category_l2 {l2!r} does not belong to category_l1 {l1!r}",
        )


def _check_sources(db: Session, ctx: LedgerContext, source_ids: list[uuid.UUID]) -> None:
    """Every ``source_id`` filter value has to be an account of this ledger (§5.25)."""
    if not source_ids:
        return
    wanted = set(source_ids)
    found = set(
        db.execute(
            select(FinanceSource.id).where(
                FinanceSource.ledger_id == ctx.ledger.id,
                FinanceSource.id.in_(wanted),
            )
        )
        .scalars()
        .all()
    )
    if wanted - found:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Account not found")


def _check_batch(db: Session, ctx: LedgerContext, batch_id: uuid.UUID | None) -> None:
    """The ``import_batch_id`` filter has to name a batch of this ledger (§14.46)."""
    if batch_id is None:
        return
    batch = db.get(ImportBatch, batch_id)
    if batch is None or batch.ledger_id != ctx.ledger.id:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Import batch not found")


def _filtered_query(
    ctx: LedgerContext,
    *,
    q: str | None,
    kinds: list[str],
    category_l1: str | None,
    category_l2: str | None,
    source_ids: list[uuid.UUID],
    date_from: dt.date | None,
    date_to: dt.date | None,
    currency: str | None,
    import_batch_id: uuid.UUID | None,
) -> Select:
    """Step 1 of §5.25: everything except the base-currency amount range."""
    stmt = select(Transaction).where(Transaction.ledger_id == ctx.ledger.id)

    if q:
        # ``%`` and ``_`` are ordinary characters to whoever typed them into a
        # search box, so they are escaped instead of acting as wildcards.
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        stmt = stmt.where(
            or_(
                Transaction.merchant.ilike(pattern, escape="\\"),
                Transaction.note.ilike(pattern, escape="\\"),
            )
        )
    if kinds:
        stmt = stmt.where(Transaction.kind.in_(kinds))
    if category_l1 is not None:
        stmt = stmt.where(Transaction.category_l1 == category_l1)
    if category_l2 is not None:
        stmt = stmt.where(Transaction.category_l2 == category_l2)
    if source_ids:
        stmt = stmt.where(Transaction.source_id.in_(source_ids))
    if date_from is not None:
        stmt = stmt.where(Transaction.occurred_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(Transaction.occurred_at <= date_to)
    if currency is not None:
        stmt = stmt.where(Transaction.currency == currency.upper())
    if import_batch_id is not None:
        stmt = stmt.where(Transaction.import_batch_id == import_batch_id)

    # Stable paging: the two display keys plus the primary key (§5.25).
    return stmt.order_by(
        Transaction.occurred_at.desc(), Transaction.created_at.desc(), Transaction.id
    )


def _sql_groups(
    db: Session, stmt: Select
) -> list[tuple[str, str, dt.date, Decimal, int]]:
    """``(kind, currency, occurred_at, sum(amount), count)`` straight from SQL.

    One ``GROUP BY`` over the filtered set, the same shape
    ``valuation._amount_groups`` builds for balances (§5.20) — including its
    quantizing of the subtotal, because ``func.sum`` is floating point on
    SQLite and ``str()`` would otherwise carry a representation error into the
    conversion.
    """
    rows = stmt.order_by(None).subquery()
    return [
        (
            kind,
            currency.upper(),
            occurred_at,
            valuation.quantize_amount(Decimal(str(subtotal))),
            int(count),
        )
        for kind, currency, occurred_at, subtotal, count in db.execute(
            select(
                rows.c.kind,
                rows.c.currency,
                rows.c.occurred_at,
                func.sum(rows.c.amount),
                func.count(),
            ).group_by(rows.c.kind, rows.c.currency, rows.c.occurred_at)
        )
    ]


def _python_groups(
    rows: Sequence[Transaction],
) -> list[tuple[str, str, dt.date, Decimal, int]]:
    """The same grouping as :func:`_sql_groups`, over rows already in memory.

    The amount-bound path decides what matches in Python (decision §14.49), so
    its selection cannot be re-expressed in SQL; grouping the surviving rows
    here is what keeps its ``summary`` arithmetic identical to the fast path's
    instead of merely equivalent.
    """
    groups: dict[tuple[str, str, dt.date], list] = {}
    for row in rows:
        key = (row.kind, row.currency.upper(), row.occurred_at)
        bucket = groups.setdefault(key, [valuation.ZERO, 0])
        bucket[0] += Decimal(row.amount)
        bucket[1] += 1
    return [
        (kind, currency, on, valuation.quantize_amount(subtotal), count)
        for (kind, currency, on), (subtotal, count) in groups.items()
    ]


def _grouped_summary(
    db: Session,
    ctx: LedgerContext,
    groups: Sequence[tuple[str, str, dt.date, Decimal, int]],
    *,
    count: int,
    rate_missing_extra: int = 0,
) -> dict:
    """§5.25's ``summary`` from ``(kind, currency, day, subtotal, rows)`` groups.

    Both list paths feed this one function — the fast path from SQL, the
    amount-bound path from the rows it kept — so the block cannot drift between
    them: adding a bound that excludes nothing has to leave every figure alone.
    One conversion per group means the number of rows converted depends on how
    many (kind, currency, day) combinations the filter hit, never on how many
    transactions did.

    The arithmetic is §5.25's to the letter: expenses are all negative, so the
    absolute value of a group's subtotal is the sum of the row absolutes;
    transfer legs take no part in the three amounts but a group that could not
    be valued still contributes its rows to ``rate_missing_count``.
    ``rate_missing_extra`` carries the rows the caller already dropped for
    having no rate (the bound path), which no group can account for any more.
    """
    converted = valuation.convert_rows(
        db,
        [(subtotal, currency, on) for _kind, currency, on, subtotal, _n in groups],
        ctx.ledger.base_currency,
    )

    totals = {"expense": valuation.ZERO, "income": valuation.ZERO, "refund": valuation.ZERO}
    rate_missing_count = rate_missing_extra
    for (kind, _currency, _on, _subtotal, rows_in_group), value in zip(
        groups, converted, strict=True
    ):
        if value is None:
            rate_missing_count += rows_in_group
            continue
        if kind not in totals:
            continue    # transfer legs, deliberately (decision §14.52 A14)
        amount_base = valuation.quantize_amount(value[0])
        totals[kind] += abs(amount_base) if kind == "expense" else amount_base

    return {
        "base_currency": ctx.ledger.base_currency.upper(),
        "expense": valuation.quantize_amount(totals["expense"]),
        "income": valuation.quantize_amount(totals["income"]),
        "net": valuation.quantize_amount(
            totals["income"] - totals["expense"] + totals["refund"]
        ),
        "count": count,
        "rate_missing_count": rate_missing_count,
    }


def _load_transaction(db: Session, ctx: LedgerContext, tid: uuid.UUID) -> Transaction:
    """One transaction of this ledger, or 404 — a foreign one is invisible (§3.3)."""
    tx = db.get(Transaction, tid)
    if tx is None or tx.ledger_id != ctx.ledger.id:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Transaction not found")
    return tx


def _refund_rows(
    db: Session, ctx: LedgerContext, origin_id: uuid.UUID
) -> list[Transaction]:
    """Refund rows pointing at one expense, oldest first (§5.27).

    Scoped to the ledger like every other read here (§3.3). ``refund_of`` is
    only ever written within one ledger, so on healthy data the predicate
    changes no answer; it is there so the read does not *depend* on that
    invariant. ``ix_transactions_refund_of`` still drives the lookup.
    """
    return list(
        db.execute(
            select(Transaction)
            .where(
                Transaction.ledger_id == ctx.ledger.id,
                Transaction.refund_of == origin_id,
                Transaction.kind == "refund",
            )
            .order_by(Transaction.occurred_at.asc(), Transaction.created_at.asc())
        )
        .scalars()
        .all()
    )


def _refund_ref(tx: Transaction) -> RefundRef:
    return RefundRef(
        id=tx.id,
        occurred_at=tx.occurred_at,
        amount=tx.amount,
        currency=tx.currency,
        note=tx.note,
        source_id=tx.source_id,
    )


def _refund_origin(
    db: Session, ctx: LedgerContext, tx: Transaction
) -> RefundOrigin | None:
    """§5.27's ``refund_of_detail``: the original expense, expanded.

    ``None`` on anything that is not a refund, and on a refund whose original
    was deleted (the FK set ``refund_of`` to NULL, decision §1.1) — the UI
    reads that as "the original is gone".
    """
    if tx.kind != "refund" or tx.refund_of is None:
        return None
    origin = db.get(Transaction, tx.refund_of)
    if origin is None or origin.ledger_id != ctx.ledger.id:
        return None

    refunded, refundable = transaction_service.refund_totals(
        db, ctx.ledger, [origin.id]
    )[origin.id]
    return RefundOrigin(
        id=origin.id,
        occurred_at=origin.occurred_at,
        merchant=origin.merchant,
        amount=origin.amount,
        currency=origin.currency,
        source_id=origin.source_id,
        category_l1=origin.category_l1,
        category_l2=origin.category_l2,
        refunded_total=refunded,
        refundable=refundable,
        # "Have I already refunded this twice?" — this row itself is not part
        # of the answer (decision §14.52 A25).
        other_refunds=[
            _refund_ref(row)
            for row in _refund_rows(db, ctx, origin.id)
            if row.id != tx.id
        ],
    )


def _pair_ref(db: Session, ctx: LedgerContext, tx: Transaction) -> PairRef | None:
    """§5.27's ``pair``: the four-field precis of the other leg, or ``None``.

    A half-broken pair (one leg deleted by hand) degrades to ``None`` rather
    than failing the read; ``transfer_pair_incomplete`` belongs to the write
    endpoints of §5.31 / §5.34.
    """
    if tx.transfer_pair_id is None:
        return None
    legs = list(
        db.execute(
            select(Transaction).where(
                Transaction.ledger_id == ctx.ledger.id,
                Transaction.transfer_pair_id == tx.transfer_pair_id,
            )
        )
        .scalars()
        .all()
    )
    out_legs = [leg for leg in legs if leg.transfer_role == "out"]
    in_legs = [leg for leg in legs if leg.transfer_role == "in"]
    if len(out_legs) != 1 or len(in_legs) != 1:
        return None

    def precis(leg: Transaction) -> PairLeg:
        return PairLeg(
            transaction_id=leg.id,
            source_id=leg.source_id,
            amount=leg.amount,
            currency=leg.currency,
        )

    return PairRef(
        pair_id=tx.transfer_pair_id, out=precis(out_legs[0]), in_=precis(in_legs[0])
    )


# ---------------------------------------------------------------------------
# Two-leg transfers: fixed segments, declared before /{tid} (§1.3)
# ---------------------------------------------------------------------------


@router.post(
    "/transfer", response_model=TransferResponse, status_code=status.HTTP_201_CREATED
)
def create_transfer(
    payload: TransferCreate,
    ctx: LedgerContext = Depends(get_ledger_member),
    client: Optional[str] = Depends(client_name),
    db: Session = Depends(get_db),
) -> TransferResponse:
    """Book both legs of a transfer in one transaction (§5.30).

    Either both legs land or neither does — the whole point of having this
    endpoint instead of two ``POST /transactions`` calls.
    """
    legs = transaction_service.create_transfer(
        db,
        ctx.ledger,
        ctx.user.id,
        TransferInput(**payload.model_dump()),
        client,
    )
    body = _transfer_body(db, ctx, legs)
    db.commit()
    return body


@router.get("/transfer/{pair_id}", response_model=TransferResponse)
def get_transfer(
    pair_id: uuid.UUID = Path(..., description="Transfer pair id"),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> TransferResponse:
    """Read a pair as one object (§5.30a, added 2026-09-12 for the frontend's
    ``/l/:ledgerId/transfers/:pairId`` route, 04 §1.2).

    Same shape as §5.30 / §5.31 / §5.33; a pair with one leg is a 409
    ``transfer_pair_incomplete``, an unknown or foreign pair a 404.
    """
    legs = transaction_service.get_pair(db, ctx.ledger, pair_id)
    return _transfer_body(db, ctx, legs)


@router.patch("/transfer/{pair_id}", response_model=TransferResponse)
def update_transfer(
    payload: TransferPatch,
    pair_id: uuid.UUID = Path(..., description="Transfer pair id"),
    ctx: LedgerContext = Depends(get_ledger_member),
    client: Optional[str] = Depends(client_name),
    db: Session = Depends(get_db),
) -> TransferResponse:
    """Edit a pair as one object (§5.31).

    ``occurred_at`` / ``subtype`` / ``note`` are written to both legs when the
    request names them; amounts, currencies and accounts belong to one leg
    each. The version token is the newer of the two legs' stamps (§4.4).
    """
    changes = payload.model_dump(exclude_unset=True, exclude={"updated_at"})
    legs = transaction_service.update_transfer(
        db, ctx.ledger, ctx.user.id, pair_id, changes, payload.updated_at, client
    )
    body = _transfer_body(db, ctx, legs)
    db.commit()
    return body


@router.delete("/transfer/{pair_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transfer(
    pair_id: uuid.UUID = Path(..., description="Transfer pair id"),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> Response:
    """Delete every leg of a pair (§5.32); a half-broken pair is deleted too."""
    transaction_service.delete_transfer(db, ctx.ledger, pair_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/transfer/{pair_id}/unpair", response_model=UnpairResponse)
def unpair_transfer(
    pair_id: uuid.UUID = Path(..., description="Transfer pair id"),
    ctx: LedgerContext = Depends(get_ledger_member),
    client: Optional[str] = Depends(client_name),
    db: Session = Depends(get_db),
) -> UnpairResponse:
    """Turn a pair back into two independent single legs (§5.34).

    Nothing but ``transfer_pair_id`` moves: amounts, dates, accounts and
    subtypes stay, and ``counterparty`` is left empty on purpose.
    """
    legs = transaction_service.unpair(db, ctx.ledger, ctx.user.id, pair_id, client)
    body = UnpairResponse(
        pair_id=pair_id,
        unpaired=[UnpairedLeg.model_validate(leg) for leg in legs],
    )
    db.commit()
    return body


# ---------------------------------------------------------------------------
# The list and one transaction
# ---------------------------------------------------------------------------


@router.get("", response_model=TransactionListResponse)
def list_transactions(
    q: Optional[str] = Query(None, description="ILIKE over merchant and note"),
    kind: Optional[list[Kind]] = Query(None, description="Repeatable; matched as IN"),
    category_l1: Optional[str] = Query(None),
    category_l2: Optional[str] = Query(None),
    source_id: Optional[list[uuid.UUID]] = Query(None, description="Repeatable"),
    date_from: Optional[dt.date] = Query(None, alias="from"),
    date_to: Optional[dt.date] = Query(None, alias="to"),
    currency: Optional[str] = Query(None, pattern=CURRENCY_PATTERN),
    min_amount: Optional[Decimal] = Query(None, ge=0),
    max_amount: Optional[Decimal] = Query(None, ge=0),
    import_batch_id: Optional[uuid.UUID] = Query(None),
    page: Pagination = Depends(pagination),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> TransactionListResponse:
    """The filtered, paged transaction list with its summary block (§5.25).

    §5.25's implementation order has two paths, and which one runs depends on
    whether the request named an amount bound:

    * **No bound — the fast path.** SQL alone decides what matches, so ``total``
      is a ``COUNT(*)``, one page of rows comes back, and only those rows are
      converted. ``summary`` still covers the whole filtered set, as one
      ``GROUP BY (kind, currency, occurred_at)`` aggregate (:func:`_grouped_summary`).
    * **``min_amount`` / ``max_amount`` given.** The bound compares
      base-currency amounts (decision §14.49), which SQL cannot do, so every
      matching row is converted, filtered in Python, counted and only then cut
      into a page. A row without a rate cannot satisfy a bound and drops out,
      so here ``count == total`` counts only the rows that could be valued
      (§5.25, sync 2026-09-12).

    Either way ``summary`` is computed over the **whole** filtered set, which is
    why it does not change while paging (decision §14.52 A14), and both paths
    hand the same ``(kind, currency, day)`` groups to the same arithmetic, so
    a bound that excludes nothing leaves every figure exactly where it was.
    """
    if min_amount is not None and max_amount is not None and min_amount > max_amount:
        raise ApiError(
            422, ErrorCode.VALIDATION_ERROR, "min_amount must not exceed max_amount"
        )
    text = q.strip() if q is not None else None
    _check_filter_category(category_l1, category_l2)
    _check_sources(db, ctx, source_id or [])
    _check_batch(db, ctx, import_batch_id)

    stmt = _filtered_query(
        ctx,
        q=text or None,
        kinds=list(kind or []),
        category_l1=category_l1,
        category_l2=category_l2,
        source_ids=list(source_id or []),
        date_from=date_from,
        date_to=date_to,
        currency=currency,
        import_batch_id=import_batch_id,
    )
    if min_amount is None and max_amount is None:
        total = db.execute(
            select(func.count()).select_from(stmt.order_by(None).subquery())
        ).scalar_one()
        page_rows = list(
            db.execute(stmt.limit(page.limit).offset(page.offset)).scalars().all()
        )
        page_values = valuation.value_transactions(
            db, ctx.ledger.base_currency, page_rows
        )
        summary = _grouped_summary(db, ctx, _sql_groups(db, stmt), count=total)
    else:
        rows = list(db.execute(stmt).scalars().all())
        values = valuation.value_transactions(db, ctx.ledger.base_currency, rows)

        # Rows that could not be valued are dropped by the amount bound, but
        # §5.25's "some rows could not be converted" signal must survive that.
        dropped_missing = sum(1 for value in values if value is None)
        kept = [
            (row, value)
            for row, value in zip(rows, values, strict=True)
            # A row without a rate has no comparable amount at all, so it
            # cannot satisfy a bound; it drops out of the range query.
            if value is not None
            and (min_amount is None or abs(value.amount_base) >= min_amount)
            and (max_amount is None or abs(value.amount_base) <= max_amount)
        ]
        rows = [row for row, _value in kept]
        values = [value for _row, value in kept]

        total = len(rows)
        # Same grouping, same conversion, same arithmetic as the fast path —
        # a bound that excludes nothing must not move a figure (§5.25).
        summary = _grouped_summary(
            db,
            ctx,
            _python_groups(rows),
            count=total,
            rate_missing_extra=dropped_missing,
        )
        window = slice(page.offset, page.offset + page.limit)
        page_rows, page_values = rows[window], values[window]

    totals = _expense_totals(db, ctx, page_rows)

    body = TransactionListResponse(
        items=[
            _item(row, value, totals)
            for row, value in zip(page_rows, page_values, strict=True)
        ],
        total=total,
        summary=TransactionSummary(**summary),
    )
    # Converting wrote fresh rows into the rate cache; without this commit they
    # would be discarded with the session and every render would go upstream
    # again (§6.3, same reason ``api/rates.py`` commits on GET).
    db.commit()
    return body


@router.post("", response_model=TransactionItem, status_code=status.HTTP_201_CREATED)
def create_transaction(
    payload: TransactionCreate,
    ctx: LedgerContext = Depends(get_ledger_member),
    client: Optional[str] = Depends(client_name),
    db: Session = Depends(get_db),
) -> TransactionItem:
    """Book one transaction (§5.26); two-leg transfers go through §5.30."""
    tx = transaction_service.create_single(
        db,
        ctx.ledger,
        ctx.user.id,
        SingleTxInput(**payload.model_dump()),
        client,
    )
    body = _single_body(db, ctx, tx)
    db.commit()
    return body


@router.get("/{tid}", response_model=TransactionDetail)
def get_transaction(
    tid: uuid.UUID = Path(..., description="Transaction id"),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> TransactionDetail:
    """One transaction with its refunds, origin, pair and event trail (§5.27)."""
    tx = _load_transaction(db, ctx, tid)
    # Both are None on every kind but expense, which drops them from the body.
    refunded, refundable = _expense_totals(db, ctx, [tx]).get(tx.id, (None, None))
    refunds = _refund_rows(db, ctx, tx.id) if tx.kind == "expense" else []

    body = TransactionDetail(
        **_row_fields(tx),
        **_valuation_fields(_value_one(db, ctx, tx)),
        refunded_total=refunded,
        refundable=refundable,
        refunds=[_refund_ref(row) for row in refunds],
        refund_of_detail=_refund_origin(db, ctx, tx),
        pair=_pair_ref(db, ctx, tx),
        events=[EventItem.model_validate(row) for row in events.list_for(db, tx.id)],
    )
    # Keeps the rate rows the conversions above cached (§6.3); see the list.
    db.commit()
    return body


@router.patch("/{tid}", response_model=TransactionItem)
def update_transaction(
    payload: TransactionPatch,
    tid: uuid.UUID = Path(..., description="Transaction id"),
    ctx: LedgerContext = Depends(get_ledger_member),
    client: Optional[str] = Depends(client_name),
    db: Session = Depends(get_db),
) -> TransactionItem:
    """Edit one transaction (§5.28); a leg of a pair is 409 ``use_transfer_endpoint``.

    Only the fields the request actually carried are passed on — the service
    validates the finished row, not the edit.
    """
    tx = _load_transaction(db, ctx, tid)
    changes = payload.model_dump(exclude_unset=True, exclude={"updated_at"})
    tx = transaction_service.update_single(
        db, ctx.ledger, ctx.user.id, tx, changes, payload.updated_at, client
    )
    body = _single_body(db, ctx, tx)
    db.commit()
    return body


@router.delete("/{tid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    tid: uuid.UUID = Path(..., description="Transaction id"),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> Response:
    """Delete exactly one row (§5.29); its events go with it through the cascade."""
    tx = _load_transaction(db, ctx, tid)
    transaction_service.delete_single(db, ctx.ledger, tx)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{tid}/pair", response_model=TransferResponse)
def pair_transaction(
    payload: PairRequest,
    tid: uuid.UUID = Path(..., description="Transaction id"),
    ctx: LedgerContext = Depends(get_ledger_member),
    client: Optional[str] = Depends(client_name),
    db: Session = Depends(get_db),
) -> TransferResponse:
    """Tie two single-leg transfers into one pair (§5.33).

    No optimistic concurrency (§5.33): a second caller racing for the same leg
    loses on the "must still be a single leg" check with 400 ``pair_invalid``.
    """
    legs = transaction_service.pair(
        db, ctx.ledger, ctx.user.id, tid, payload.other_transaction_id, client
    )
    body = _transfer_body(db, ctx, legs)
    db.commit()
    return body
