"""Personal account endpoints (03-backend-api.md §5.20-§5.24b, decision §14.62).

Accounts belong to a person, not to a ledger: everything under ``/sources``
authorizes with :func:`get_current_user` alone and every query carries
``owner_id = caller``. Somebody else's account id is a 404 here even when it is
shared into a ledger the caller belongs to (§3.2, §3.3) — the per-ledger view
of other members' accounts is ``GET /ledgers/{id}/sources`` (``finance_sources.py``).

The balance arithmetic is not here — ``services/valuation.py`` owns it (§5.20's
formula, decisions §8, §14.2, §14.50, §14.62 f): balances cover the account's
transactions in every ledger and are valued in the owner's
``users.base_currency``. Reads commit as well: converting may cache exchange
rate rows, and ``fx`` never commits on its own (see ``api/rates.py``).

Sharing (§5.24a / §5.24b) only adds or removes ``ledger_sources`` rows; it
changes no transaction and writes no ``transaction_events``.
"""
import uuid
from collections.abc import Iterable, Sequence

from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
from app.core.database import get_db
from app.core.errors import ApiError, ErrorCode
from app.core.security import get_current_user
from app.models.finance_source import FinanceSource
from app.models.import_batch import ImportBatch
from app.models.ledger import LedgerMember
from app.models.ledger_source import LedgerSource
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.finance_source import (
    SourceCreate,
    SourceListResponse,
    SourcePatch,
    SourceResponse,
)
from app.services import fx, source_access, valuation

router = APIRouter(prefix="/sources", tags=["sources"])


# ---------------------------------------------------------------------------
# Helpers shared with ``finance_sources.py``
# ---------------------------------------------------------------------------


def shared_to_map(
    db: Session, user_id: uuid.UUID, source_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """``source_id -> [ledger_id, …]`` it is shared into, member ledgers only.

    ``shared_to`` lists only the ledgers ``user_id`` still belongs to (§5.20):
    the join on ``ledger_members`` drops any other. Ordered by share time so
    the list is stable between calls.
    """
    ids = list(source_ids)
    result: dict[uuid.UUID, list[uuid.UUID]] = {sid: [] for sid in ids}
    if not ids:
        return result
    rows = db.execute(
        select(LedgerSource.source_id, LedgerSource.ledger_id)
        .join(
            LedgerMember,
            (LedgerMember.ledger_id == LedgerSource.ledger_id)
            & (LedgerMember.user_id == user_id),
        )
        .where(LedgerSource.source_id.in_(ids))
        .order_by(LedgerSource.shared_at.asc(), LedgerSource.ledger_id.asc())
    ).all()
    for source_id, ledger_id in rows:
        result[source_id].append(ledger_id)
    return result


def owner_fields(
    source: FinanceSource,
    balance: valuation.SourceBalance,
    shared_to: list[uuid.UUID],
) -> dict:
    """Every ``SourceResponse`` field of an account the caller owns (§5.20)."""
    return {
        "id": source.id,
        "owner_id": source.owner_id,
        "name": source.name,
        "type": source.type,
        "default_currency": source.default_currency,
        "opening_balance": source.opening_balance,
        "archived": source.archived,
        "archived_at": source.archived_at,
        "created_by": source.created_by,
        "updated_by": source.updated_by,
        "created_at": source.created_at,
        "updated_at": source.updated_at,
        "shared_to": shared_to,
        "balance": balance.balance,
        "balance_base": balance.balance_base,
        "balance_rate": balance.balance_rate,
        "balance_rate_date": balance.balance_rate_date,
        "rate_missing_count": balance.rate_missing_count,
    }


def owner_rows(
    db: Session, user: User, sources: Sequence[FinanceSource]
) -> tuple[dict[uuid.UUID, dict], dict[uuid.UUID, valuation.SourceBalance]]:
    """``SourceResponse`` fields per account the caller owns, plus the balances.

    One share query and one balance aggregation cover all of them; values are
    in the caller's ``users.base_currency`` (decision §14.62 f).
    """
    balances = valuation.source_balances(db, user.base_currency, sources)
    shares = shared_to_map(db, user.id, [source.id for source in sources])
    rows = {
        source.id: owner_fields(source, balances[source.id], shares[source.id])
        for source in sources
    }
    return rows, balances


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _not_found() -> ApiError:
    return ApiError(404, ErrorCode.NOT_FOUND, "Account not found")


def _load_own(
    db: Session, user: User, sid: uuid.UUID, *, lock: bool
) -> FinanceSource:
    """One account the caller owns, or 404 — somebody else's id included.

    ``lock`` adds ``FOR UPDATE``, which PATCH needs for the compare-and-set of
    §4.4 and DELETE needs so that "nothing refers to it" cannot stop being
    true between the check and the delete (§5.24). ``populate_existing`` makes
    the locking SELECT refresh a row already in the identity map, so the
    version stamp compared below is the one read under the lock.
    """
    stmt = select(FinanceSource).where(
        FinanceSource.id == sid, FinanceSource.owner_id == user.id
    )
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    source = db.execute(stmt).scalar_one_or_none()
    if source is None:
        raise _not_found()
    return source


def _member_ledger_ids(
    db: Session, user_id: uuid.UUID, ledger_ids: Iterable[uuid.UUID]
) -> set[uuid.UUID]:
    """The subset of ``ledger_ids`` the user is a member of (owner or member)."""
    ids = set(ledger_ids)
    if not ids:
        return set()
    return set(
        db.execute(
            select(LedgerMember.ledger_id).where(
                LedgerMember.user_id == user_id, LedgerMember.ledger_id.in_(ids)
            )
        ).scalars()
    )


def _require_member(db: Session, user: User, lid: uuid.UUID) -> None:
    """404 unless the caller belongs to ledger ``lid`` (missing ledger included)."""
    if lid not in _member_ledger_ids(db, user.id, [lid]):
        raise ApiError(404, ErrorCode.NOT_FOUND, "Ledger not found")


def _share(db: Session, user: User, source: FinanceSource, lid: uuid.UUID) -> None:
    """Insert ``ledger_sources(lid, source)`` unless it is already there.

    Idempotent: an existing row keeps its first ``shared_by`` / ``shared_at``.
    The insert runs in a savepoint so that a concurrent share of the same pair
    (primary key conflict) is absorbed as "already shared" instead of failing.
    """
    exists = db.get(LedgerSource, (lid, source.id))
    if exists is not None:
        return
    try:
        with db.begin_nested():
            db.add(
                LedgerSource(
                    ledger_id=lid,
                    source_id=source.id,
                    shared_by=user.id,
                    shared_at=utcnow(),
                )
            )
    except IntegrityError:
        pass    # someone shared it a moment ago: the result is the same


def _one_body(db: Session, user: User, source: FinanceSource) -> SourceResponse:
    rows, _balances = owner_rows(db, user, [source])
    return SourceResponse(**rows[source.id])


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=SourceListResponse)
def list_sources(
    include_archived: bool = Query(
        False, description="Include archived accounts in the list"
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SourceListResponse:
    """The caller's accounts with balances and the three personal totals (§5.20).

    Sorted ``archived ASC, type ASC, name ASC`` so the active accounts come
    first and each type arrives as one contiguous block (decision §14.50).
    ``assets`` / ``liabilities`` / ``net_worth`` cover the caller's
    **non-archived** accounts only, whether or not ``include_archived``
    returned the archived ones, and are ``null`` together when a counted
    account could not be converted to the caller's base currency.
    """
    stmt = select(FinanceSource).where(FinanceSource.owner_id == current_user.id)
    if not include_archived:
        stmt = stmt.where(FinanceSource.archived.is_(False))
    stmt = stmt.order_by(
        FinanceSource.archived.asc(),
        FinanceSource.type.asc(),
        FinanceSource.name.asc(),
        FinanceSource.id.asc(),
    )
    sources = list(db.execute(stmt).scalars())

    rows, balances = owner_rows(db, current_user, sources)
    bodies = [SourceResponse(**rows[source.id]) for source in sources]
    assets, liabilities, net_worth = valuation.net_worth(sources, balances)

    body = SourceListResponse(
        items=bodies,
        total=len(bodies),
        base_currency=current_user.base_currency,
        assets=assets,
        liabilities=liabilities,
        net_worth=net_worth,
    )
    db.commit()    # persist whatever rates the conversion cached
    return body


@router.post("", response_model=SourceResponse, status_code=status.HTTP_201_CREATED)
def create_source(
    payload: SourceCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SourceResponse:
    """Create an account owned by the caller, optionally shared at once (§5.21).

    Checks run before anything is written, so a refusal leaves no account
    behind: every ``share_to`` ledger must be one the caller belongs to (404
    otherwise, duplicates count once), and the caller may own at most
    ``MAX_SOURCES_PER_USER`` accounts, archived ones included (409
    ``source_limit_reached``). ``default_currency`` can only be set here (§5.23
    refuses to change it). ``opening_balance`` is a column, never a
    transaction (decision §14.52 B5).
    """
    share_to = list(dict.fromkeys(payload.share_to))    # de-duplicated, order kept
    if len(_member_ledger_ids(db, current_user.id, share_to)) != len(share_to):
        raise ApiError(404, ErrorCode.NOT_FOUND, "Ledger not found")

    if source_access.count_owned(db, current_user.id) >= settings.MAX_SOURCES_PER_USER:
        raise ApiError(
            409,
            ErrorCode.SOURCE_LIMIT_REACHED,
            f"You already have {settings.MAX_SOURCES_PER_USER} accounts "
            "(archived ones included); delete one before creating another",
        )

    currency = fx.ensure_supported(payload.default_currency, None)

    now = utcnow()
    source = FinanceSource(
        owner_id=current_user.id,
        name=payload.name,
        type=payload.type,
        default_currency=currency,
        opening_balance=payload.opening_balance,
        archived=False,
        archived_at=None,
        created_by=current_user.id,
        updated_by=current_user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(source)
    db.flush()
    for lid in share_to:
        db.add(
            LedgerSource(
                ledger_id=lid,
                source_id=source.id,
                shared_by=current_user.id,
                shared_at=now,
            )
        )
    db.flush()

    body = _one_body(db, current_user, source)
    db.commit()
    return body


@router.get("/{sid}", response_model=SourceResponse)
def get_source(
    sid: uuid.UUID = Path(..., description="Account id"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SourceResponse:
    """One of the caller's accounts, the same body as a list item (§5.22)."""
    source = _load_own(db, current_user, sid, lock=False)
    body = _one_body(db, current_user, source)
    db.commit()
    return body


@router.patch("/{sid}", response_model=SourceResponse)
def update_source(
    payload: SourcePatch,
    sid: uuid.UUID = Path(..., description="Account id"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SourceResponse:
    """Rename, retype, re-open or archive one of the caller's accounts (§5.23).

    ``default_currency`` present in the body is 400 ``currency_locked`` even
    when it equals the current currency (decision §14.50); it is answered
    before the version stamp because retrying with a fresh stamp would not
    make it succeed either. Everything else follows §4.4: lock the row,
    require the stamp to match to the microsecond, then write. ``archived``
    carries ``archived_at`` with it in both directions; shares are untouched.
    """
    source = _load_own(db, current_user, sid, lock=True)

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
            "Account was modified elsewhere; reload and retry",
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

    source.updated_by = current_user.id
    source.updated_at = now
    db.flush()

    body = _one_body(db, current_user, source)
    db.commit()
    return body


@router.delete("/{sid}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_source(
    sid: uuid.UUID = Path(..., description="Account id"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Delete one of the caller's accounts that nothing refers to (§5.24).

    A transaction or an import batch in **any** ledger — including ledgers the
    caller cannot see — keeps the account alive (409 ``source_has_transactions``;
    archive it instead, decision §3). The detail never names the ledger. The
    account row is locked so a transaction inserted concurrently either waits
    behind this delete or is seen by the check; the foreign keys on
    ``transactions.source_id`` / ``import_batches.source_id`` are the last line
    of defence. Its ``ledger_sources`` rows go with it (``ON DELETE CASCADE``).
    """
    source = _load_own(db, current_user, sid, lock=True)

    used = db.execute(
        select(func.count())
        .select_from(Transaction)
        .where(Transaction.source_id == source.id)
    ).scalar_one()
    if used:
        raise ApiError(
            409,
            ErrorCode.SOURCE_HAS_TRANSACTIONS,
            f"Account has {used} transaction(s); archive it instead of deleting it",
        )
    batches = db.execute(
        select(func.count())
        .select_from(ImportBatch)
        .where(ImportBatch.source_id == source.id)
    ).scalar_one()
    if batches:
        raise ApiError(
            409,
            ErrorCode.SOURCE_HAS_TRANSACTIONS,
            f"Account is the target of {batches} import(s); "
            "archive it instead of deleting it",
        )

    db.delete(source)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/{sid}/ledgers/{lid}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def share_source(
    sid: uuid.UUID = Path(..., description="Account id"),
    lid: uuid.UUID = Path(..., description="Ledger id"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Share one of the caller's accounts into a ledger they belong to (§5.24a).

    Afterwards the other members there can use it too. Idempotent: an existing
    share keeps its first ``shared_by`` / ``shared_at``. An archived account
    can be shared — archival is judged when the account is used. Not the
    owner, or not a member of ``lid`` (or no such ledger): 404 either way.
    """
    source = _load_own(db, current_user, sid, lock=False)
    _require_member(db, current_user, lid)
    _share(db, current_user, source, lid)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{sid}/ledgers/{lid}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def unshare_source(
    sid: uuid.UUID = Path(..., description="Account id"),
    lid: uuid.UUID = Path(..., description="Ledger id"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Withdraw a share (§5.24b); idempotent, same 404 rule as §5.24a.

    The other members can no longer record new entries on the account in that
    ledger; the transactions already recorded on it stay exactly as they are.
    """
    source = _load_own(db, current_user, sid, lock=False)
    _require_member(db, current_user, lid)
    db.execute(
        delete(LedgerSource).where(
            LedgerSource.ledger_id == lid, LedgerSource.source_id == source.id
        )
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
