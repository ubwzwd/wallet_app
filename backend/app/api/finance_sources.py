"""The accounts a member sees inside one ledger (03-backend-api.md §5.24c).

Accounts belong to people and are shared into ledgers (decision §14.62), so
this module keeps only the read side: ``GET /ledgers/{id}/sources`` feeds every
account picker of the ledger (record, transfer, import, review) and resolves
the account names on its transactions. Creating, editing, deleting and sharing
an account live under the personal ``/sources`` endpoints (``sources.py``); the
four ledger-scoped write routes of earlier versions are gone without aliases
(decision §14.42).

The list is the union of three groups, computed by
:func:`source_access.visible_source_ids`: the caller's own accounts, accounts
other members shared into this ledger, and accounts this ledger's
transactions or import batches refer to that are in neither group (listed so
the UI can name them, never usable). Another member's account carries no
balance (§14.62 c): its ``opening_balance``, balance fields and ``shared_to``
are ``null``. The caller's own rows are valued exactly as ``GET /sources``
values them — across ledgers, in the caller's ``users.base_currency``.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.sources import owner_rows
from app.core.database import get_db
from app.core.deps import LedgerContext, get_ledger_member
from app.models.finance_source import FinanceSource
from app.schemas.finance_source import LedgerSourceListResponse, LedgerSourceResponse
from app.services import source_access

router = APIRouter(prefix="/ledgers/{id}/sources", tags=["Finance Sources"])

# The picker order the frontend groups by (its ``SOURCE_TYPE_ORDER``, §5.24c).
SOURCE_TYPE_ORDER = ("checking", "credit", "cash", "other")
_TYPE_RANK = {name: rank for rank, name in enumerate(SOURCE_TYPE_ORDER)}


def _foreign_body(
    source: FinanceSource, *, usable: bool
) -> LedgerSourceResponse:
    """A row for someone else's account: identity only, no money (§14.62 c)."""
    return LedgerSourceResponse(
        id=source.id,
        owner_id=source.owner_id,
        name=source.name,
        type=source.type,
        default_currency=source.default_currency,
        opening_balance=None,
        archived=source.archived,
        archived_at=source.archived_at,
        created_by=source.created_by,
        updated_by=source.updated_by,
        created_at=source.created_at,
        updated_at=source.updated_at,
        shared_to=None,
        balance=None,
        balance_base=None,
        balance_rate=None,
        balance_rate_date=None,
        rate_missing_count=0,
        mine=False,
        usable=usable,
    )


@router.get("", response_model=LedgerSourceListResponse)
def list_ledger_sources(
    include_archived: bool = Query(
        False,
        description="Include archived accounts among the caller's own and the "
        "shared ones; accounts only referenced by entries are always listed",
    ),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> LedgerSourceListResponse:
    """Every account the caller sees in this ledger, flagged ``mine`` / ``usable``.

    ``usable`` = ``not archived and (mine or shared into this ledger)``: whether
    the caller may record new entries on it here right now. Sorted by the
    fixed type order, then by name. No totals — a ledger has no net worth
    (decision §14.62 d).
    """
    flags = source_access.visible_source_ids(
        db, ctx.user.id, ctx.ledger.id, include_archived
    )
    sources: list[FinanceSource] = []
    if flags:
        sources = list(
            db.execute(
                select(FinanceSource).where(FinanceSource.id.in_(list(flags)))
            ).scalars()
        )
    sources.sort(
        key=lambda s: (_TYPE_RANK.get(s.type, len(_TYPE_RANK)), s.name, str(s.id))
    )

    own = [source for source in sources if flags[source.id][0]]
    own_rows, _balances = owner_rows(db, ctx.user, own)

    items: list[LedgerSourceResponse] = []
    for source in sources:
        mine, shared = flags[source.id]
        usable = not source.archived and (mine or shared)
        if mine:
            items.append(
                LedgerSourceResponse(**own_rows[source.id], mine=True, usable=usable)
            )
        else:
            items.append(_foreign_body(source, usable=usable))

    body = LedgerSourceListResponse(items=items, total=len(items))
    db.commit()    # persist whatever rates the conversion cached
    return body
