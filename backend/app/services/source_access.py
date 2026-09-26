"""Who may use which account in which ledger (decision §14.62).

Accounts belong to a person (``finance_sources.owner_id``) and are shared into
ledgers through ``ledger_sources`` rows. One definition drives every check and
every list in the API:

    an account is *usable* by user U in ledger L when
    ``owner_id == U`` or a ``ledger_sources(L, account)`` row exists,
    and it is not archived.

Archival is judged separately by the callers (409 ``source_archived``); an
account that is not usable for any other reason is 404 ``not_found``, never
403 (§3.2). Like the other services, nothing here commits: the endpoint owns
the transaction.
"""
import uuid

from sqlalchemy import delete, exists, func, select, union
from sqlalchemy.orm import Session

from app.core.errors import ApiError, ErrorCode
from app.models.finance_source import FinanceSource
from app.models.import_batch import ImportBatch
from app.models.ledger import Ledger
from app.models.ledger_source import LedgerSource
from app.models.transaction import Transaction


def usable_source_ids(
    db: Session, user_id: uuid.UUID, ledger_id: uuid.UUID
) -> set[uuid.UUID]:
    """Accounts ``user_id`` may record new entries on in ``ledger_id``.

    The caller's own live accounts (usable in any ledger they are in, §14.62 b)
    plus the live accounts other members shared into this ledger (§14.62 c).
    Archived accounts are left out on both sides.
    """
    own = select(FinanceSource.id).where(
        FinanceSource.owner_id == user_id,
        FinanceSource.archived.is_(False),
    )
    shared = (
        select(FinanceSource.id)
        .join(LedgerSource, LedgerSource.source_id == FinanceSource.id)
        .where(
            LedgerSource.ledger_id == ledger_id,
            FinanceSource.archived.is_(False),
        )
    )
    return set(db.execute(union(own, shared)).scalars())


def _is_shared(db: Session, ledger_id: uuid.UUID, source_id: uuid.UUID) -> bool:
    """True when a ``ledger_sources(ledger_id, source_id)`` row exists."""
    return bool(
        db.execute(
            select(
                exists().where(
                    LedgerSource.ledger_id == ledger_id,
                    LedgerSource.source_id == source_id,
                )
            )
        ).scalar_one()
    )


def is_usable(
    db: Session, user_id: uuid.UUID, ledger_id: uuid.UUID, source: FinanceSource
) -> bool:
    """Ownership / sharing half of the §14.62 rule, archival not considered.

    The caller owns the account, or its owner shared it into this ledger.
    Archival is a separate 409 (``source_archived``) the caller decides on.
    """
    if source.owner_id == user_id:
        return True
    return _is_shared(db, ledger_id, source.id)


def load_usable_source(
    db: Session, user_id: uuid.UUID, ledger: Ledger, source_id: object
) -> FinanceSource:
    """The account ``source_id`` if ``user_id`` may use it in ``ledger``.

    A missing id and an account that is neither the caller's nor shared into
    this ledger look the same: 404 ``not_found`` (§3.2, §14.62). An archived
    account is returned as is — the caller answers 409 ``source_archived``.
    """
    source = db.get(FinanceSource, source_id) if source_id is not None else None
    if source is None or not is_usable(db, user_id, ledger.id, source):
        raise ApiError(404, ErrorCode.NOT_FOUND, "Account not found")
    return source


def visible_source_ids(
    db: Session, user_id: uuid.UUID, ledger_id: uuid.UUID, include_archived: bool
) -> dict[uuid.UUID, tuple[bool, bool]]:
    """Every account ``GET /ledgers/{id}/sources`` lists, with two flags.

    The three groups of the ledger account list (§5.24c):

    1. the caller's own accounts;
    2. accounts other members shared into this ledger;
    3. accounts this ledger's transactions or import batches point at that are
       in neither group above — always listed, so the UI can resolve names.

    ``include_archived=False`` drops archived accounts from groups 1 and 2
    only; group 3 is listed whatever its state. The value is
    ``(mine, shared)``: whether the caller owns the account, and whether it is
    shared into this ledger — true facts about the account, whichever group
    brought it in. ``usable`` is then ``not archived and (mine or shared)``.
    """
    own_all = set(
        db.execute(
            select(FinanceSource.id, FinanceSource.archived).where(
                FinanceSource.owner_id == user_id
            )
        ).all()
    )
    shared_all = set(
        db.execute(
            select(FinanceSource.id, FinanceSource.archived)
            .join(LedgerSource, LedgerSource.source_id == FinanceSource.id)
            .where(LedgerSource.ledger_id == ledger_id)
        ).all()
    )
    mine_ids = {sid for sid, _ in own_all}
    shared_ids = {sid for sid, _ in shared_all}

    listed = {
        sid for sid, archived in own_all | shared_all if include_archived or not archived
    }
    referenced = set(
        db.execute(
            union(
                select(Transaction.source_id).where(Transaction.ledger_id == ledger_id),
                select(ImportBatch.source_id).where(ImportBatch.ledger_id == ledger_id),
            )
        ).scalars()
    )
    return {
        sid: (sid in mine_ids, sid in shared_ids) for sid in listed | referenced
    }


def unshare_all_of_member(db: Session, ledger_id: uuid.UUID, user_id: uuid.UUID) -> int:
    """Withdraw every share ``user_id`` put into ``ledger_id``; the row count.

    Called when a member is removed or leaves (§14.62): the accounts they own
    stop being usable by the others there. The transactions already recorded on
    them stay untouched, and the accounts themselves are not deleted.
    """
    result = db.execute(
        delete(LedgerSource).where(
            LedgerSource.ledger_id == ledger_id,
            LedgerSource.source_id.in_(
                select(FinanceSource.id).where(FinanceSource.owner_id == user_id)
            ),
        )
    )
    return int(result.rowcount or 0)


def count_owned(db: Session, user_id: uuid.UUID) -> int:
    """Accounts owned by ``user_id``, archived ones included.

    This is the number compared with ``MAX_SOURCES_PER_USER`` before a new
    account is created (409 ``source_limit_reached``).
    """
    return int(
        db.execute(
            select(func.count())
            .select_from(FinanceSource)
            .where(FinanceSource.owner_id == user_id)
        ).scalar_one()
    )
