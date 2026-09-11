"""Finance source (account) endpoints (03-backend-api.md §5.20-§5.24).

Every route hangs off ``/ledgers/{id}/sources`` and authorizes through
:func:`get_ledger_member`, so an invisible ledger is a 404 before anything
here runs (§3.2). The second ownership check §3.2 asks for is the
``ledger_id = ctx.ledger.id`` clause on every single-account query: an account
of another ledger is a 404, never a 403 (§3.3).

The balance arithmetic itself is not here — ``services/valuation.py`` owns it
(§5.20's formula, decisions §8, §14.2, §14.50) and this module only turns its
result into the response body. Reads commit as well: converting may cache
exchange rate rows, and ``fx`` never commits on its own (see ``api/rates.py``).
"""
import uuid

from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.database import get_db
from app.core.deps import LedgerContext, get_ledger_member
from app.core.errors import ApiError, ErrorCode
from app.models.finance_source import FinanceSource
from app.models.transaction import Transaction
from app.schemas.finance_source import (
    SourceCreate,
    SourceListResponse,
    SourcePatch,
    SourceResponse,
)
from app.services import fx, valuation

router = APIRouter(prefix="/ledgers/{id}/sources", tags=["Finance Sources"])


def _source_body(source: FinanceSource, balance: valuation.SourceBalance) -> SourceResponse:
    """One account row with its five balance fields (§5.20, §5.22)."""
    return SourceResponse(
        id=source.id,
        ledger_id=source.ledger_id,
        name=source.name,
        type=source.type,
        default_currency=source.default_currency,
        opening_balance=source.opening_balance,
        archived=source.archived,
        archived_at=source.archived_at,
        balance=balance.balance,
        balance_base=balance.balance_base,
        balance_rate=balance.balance_rate,
        balance_rate_date=balance.balance_rate_date,
        rate_missing_count=balance.rate_missing_count,
        created_by=source.created_by,
        updated_by=source.updated_by,
        created_at=source.created_at,
        updated_at=source.updated_at,
    )


def _one_body(db: Session, ctx: LedgerContext, source: FinanceSource) -> SourceResponse:
    """``_source_body`` for a single account, valuing it on the way (§5.22)."""
    balances = valuation.source_balances(db, ctx.ledger, [source])
    return _source_body(source, balances[source.id])


def _load(db: Session, ctx: LedgerContext, sid: uuid.UUID, *, lock: bool) -> FinanceSource:
    """One account of *this* ledger, or 404 (§3.2's second ownership check).

    ``lock`` adds ``FOR UPDATE``, which PATCH needs for the compare-and-set of
    §4.4 and DELETE needs so that "no transactions" cannot stop being true
    between the check and the delete (§5.24). ``populate_existing`` makes the
    locking SELECT refresh the row the dependency may already have loaded into
    the identity map — without it the version stamp compared below could be one
    read before anyone was locked out.
    """
    stmt = select(FinanceSource).where(
        FinanceSource.id == sid, FinanceSource.ledger_id == ctx.ledger.id
    )
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)

    source = db.execute(stmt).scalar_one_or_none()
    if source is None:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Account not found")
    return source


@router.get("", response_model=SourceListResponse)
def list_sources(
    include_archived: bool = Query(
        False, description="Include archived accounts in the list"
    ),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> SourceListResponse:
    """Every account of the ledger with its balance and the three totals (§5.20).

    Sorted ``archived ASC, type ASC, name ASC`` so the active accounts come
    first and each type arrives as one contiguous block the frontend can draw
    as a group with a subtotal (decision §14.50).

    ``assets`` / ``liabilities`` / ``net_worth`` cover the **non-archived**
    accounts only, whether or not ``include_archived`` returned the archived
    ones (decision §14.50), and are ``null`` together when a counted account
    could not be converted to the base currency at all.
    """
    stmt = select(FinanceSource).where(FinanceSource.ledger_id == ctx.ledger.id)
    if not include_archived:
        stmt = stmt.where(FinanceSource.archived.is_(False))
    stmt = stmt.order_by(
        FinanceSource.archived.asc(), FinanceSource.type.asc(), FinanceSource.name.asc()
    )
    sources = list(db.execute(stmt).scalars())

    balances = valuation.source_balances(db, ctx.ledger, sources)
    assets, liabilities, net_worth = valuation.net_worth(sources, balances)

    body = SourceListResponse(
        items=[_source_body(source, balances[source.id]) for source in sources],
        total=len(sources),
        base_currency=ctx.ledger.base_currency,
        assets=assets,
        liabilities=liabilities,
        net_worth=net_worth,
    )
    db.commit()    # persist whatever rates the conversion cached
    return body


@router.post("", response_model=SourceResponse, status_code=status.HTTP_201_CREATED)
def create_source(
    payload: SourceCreate,
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> SourceResponse:
    """Create an account (§5.21).

    This is the only place ``default_currency`` can ever be set (§5.23 refuses
    to change it), so the supported-currency check belongs here; ``current`` is
    ``None`` because no currency is in effect yet for an account that does not
    exist. ``opening_balance`` may be negative — that is how a credit card's
    debt is entered (decision §14.52 A13) — and it stays a column on the
    account: creating one never writes a transaction (decision §14.52 B5).
    """
    currency = fx.ensure_supported(payload.default_currency, None)

    now = utcnow()
    source = FinanceSource(
        ledger_id=ctx.ledger.id,
        name=payload.name,
        type=payload.type,
        default_currency=currency,
        opening_balance=payload.opening_balance,
        archived=False,
        archived_at=None,
        created_by=ctx.user.id,
        updated_by=ctx.user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(source)
    db.flush()

    body = _one_body(db, ctx, source)
    db.commit()
    return body


@router.get("/{sid}", response_model=SourceResponse)
def get_source(
    sid: uuid.UUID = Path(..., description="Account id"),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> SourceResponse:
    """One account, the same body as a list item (§5.22).

    No ``assets`` / ``liabilities`` / ``net_worth`` here: those three are
    ledger-level numbers and only the list endpoint gives them.
    """
    source = _load(db, ctx, sid, lock=False)
    body = _one_body(db, ctx, source)
    db.commit()
    return body


@router.patch("/{sid}", response_model=SourceResponse)
def update_source(
    payload: SourcePatch,
    sid: uuid.UUID = Path(..., description="Account id"),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> SourceResponse:
    """Rename, retype, re-open or archive an account (§5.23).

    ``default_currency`` present in the body is 400 ``currency_locked`` even
    when it equals the current currency (decision §14.50): the account currency
    is the basis every historical balance is expressed in, so it is fixed for
    the life of the account. It is answered before the version stamp because
    retrying with a fresh stamp would not make it succeed either.

    Everything else follows §4.4: lock the row, require the stamp to match to
    the microsecond, then write. ``archived`` carries ``archived_at`` with it
    in both directions.
    """
    source = _load(db, ctx, sid, lock=True)

    fields = payload.model_dump(exclude_unset=True)
    if "default_currency" in fields:
        raise ApiError(
            400,
            ErrorCode.CURRENCY_LOCKED,
            "Account currency cannot be changed after creation; "
            "create a new account instead",
        )

    if payload.updated_at != source.updated_at:
        raise ApiError(
            409,
            ErrorCode.STALE_UPDATE,
            "Account was modified by someone else; reload and retry",
        )

    now = utcnow()
    if "name" in fields:
        source.name = fields["name"]
    if "type" in fields:
        source.type = fields["type"]
    if "opening_balance" in fields:
        source.opening_balance = fields["opening_balance"]
    if "archived" in fields and fields["archived"] != source.archived:
        # archived_at is the moment it happened, and null again once re-opened
        # (decision §14.50); the table's CHECK ties the two together.
        source.archived = fields["archived"]
        source.archived_at = now if fields["archived"] else None

    source.updated_by = ctx.user.id
    source.updated_at = now
    db.flush()

    body = _one_body(db, ctx, source)
    db.commit()
    return body


@router.delete("/{sid}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_source(
    sid: uuid.UUID = Path(..., description="Account id"),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> Response:
    """Delete an account that has never been used (§5.24).

    An account with transactions can only be archived (decision §3): deleting
    it would take its history with it. The account row is locked and the count
    runs in the same transaction, so a transaction inserted concurrently either
    waits behind this delete or is seen by the count; the ``ON DELETE RESTRICT``
    on ``transactions.source_id`` is the last line of defence behind that.
    """
    source = _load(db, ctx, sid, lock=True)

    used = db.execute(
        select(func.count())
        .select_from(Transaction)
        .where(
            Transaction.ledger_id == ctx.ledger.id,
            Transaction.source_id == source.id,
        )
    ).scalar_one()
    if used:
        raise ApiError(
            409,
            ErrorCode.SOURCE_HAS_TRANSACTIONS,
            f"Account has {used} transaction(s); archive it instead of deleting it",
        )

    db.delete(source)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
