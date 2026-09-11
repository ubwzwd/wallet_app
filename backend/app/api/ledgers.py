"""Ledger, member and invite endpoints (03-backend-api.md §5.8-§5.19).

Declaration order matters in exactly one place: ``POST /ledgers/join`` is a
fixed segment and has to come before the ``/{id}`` routes, otherwise "join"
would be parsed as a ledger UUID and answered with a 422 (§1.3).

Authorization is entirely in ``core/deps.py``: every ``/{id}`` route depends on
:func:`get_ledger_member` (invisible ledger -> 404) and the owner-only ones add
:func:`require_owner` (visible but not allowed -> 403), per §3.2 and §3.3. The
business rules live in ``services/ledger_service.py``, which only ever flushes
— committing the transaction is this module's job.
"""
import datetime as dt
import uuid

from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import LedgerContext, get_ledger_member, require_owner
from app.core.errors import ApiError, ErrorCode
from app.core.ratelimit import Limit, check as ratelimit_check
from app.core.security import get_current_user
from app.models.ledger import Ledger, LedgerMember
from app.models.user import User
from app.schemas.common import ListResponse
from app.schemas.ledger import (
    INVITE_CODE_PATTERN,
    InviteResponse,
    JoinRequest,
    LedgerCounts,
    LedgerCreate,
    LedgerPatch,
    LedgerResponse,
    MemberResponse,
    TransferOwnershipRequest,
)
from app.services import fx, ledger_service

router = APIRouter(prefix="/ledgers", tags=["Ledgers"])

# Joining is limited globally, not per user or per IP: brute forcing a 6 digit
# code is a global problem (§8.2, decision §14.35).
JOIN_BUCKET = "join"
JOIN_BUCKET_KEY = "global"
JOIN_LIMIT = Limit(capacity=3, refill_seconds=3)


def _utcnow() -> dt.datetime:
    """Naive UTC ``now``, the shape every timestamp column stores (§4.5)."""
    return dt.datetime.now(dt.UTC).replace(tzinfo=None)


def _checked_currency(code: str, current: str) -> str:
    """Upper-case ``code`` and require it to be one upstream knows (§5.9, §5.11).

    A code outside the list is 400 ``validation_error``. While Frankfurter is
    unreachable the list cannot be consulted at all, and then the only code
    that still goes through is ``current`` — the currency already in effect
    (the caller's default when creating, the ledger's own when patching). That
    keeps the ordinary path working through an upstream blip without ever
    letting an unverified code become a base currency nothing can convert from;
    anything else surfaces the 503 ``fx_unavailable``.
    """
    currency = code.upper()
    try:
        supported = fx.supported_currencies()
    except ApiError as exc:
        if exc.code != ErrorCode.FX_UNAVAILABLE or currency != current.upper():
            raise
        return currency

    if currency not in supported:
        raise ApiError(
            400, ErrorCode.VALIDATION_ERROR, f"Currency {currency} is not supported"
        )
    return currency


def _ledger_response(
    db: Session, ledger: Ledger, role: str, *, with_counts: bool = False
) -> LedgerResponse:
    """Build the shared ledger body; ``counts`` only for §5.10 and §5.19."""
    counts = (
        LedgerCounts(**ledger_service.ledger_counts(db, ledger.id))
        if with_counts
        else None
    )
    return LedgerResponse(
        id=ledger.id,
        name=ledger.name,
        base_currency=ledger.base_currency,
        role=role,
        member_count=ledger_service.member_count(db, ledger.id),
        created_by=ledger.created_by,
        counts=counts,
        created_at=ledger.created_at,
        updated_at=ledger.updated_at,
    )


def _member_list(db: Session, ledger: Ledger, me: User) -> ListResponse[MemberResponse]:
    """The member list of §5.13: owner first, then ``joined_at`` ascending."""
    rows = db.execute(
        select(LedgerMember, User)
        .join(User, User.id == LedgerMember.user_id)
        .where(LedgerMember.ledger_id == ledger.id)
        .order_by(
            case((LedgerMember.role == ledger_service.ROLE_OWNER, 0), else_=1),
            LedgerMember.joined_at.asc(),
        )
    ).all()

    items = [
        MemberResponse(
            user_id=user.id,
            email=user.email,
            display_name=user.display_name,
            role=member.role,
            joined_at=member.joined_at,
            is_me=user.id == me.id,
        )
        for member, user in rows
    ]
    return ListResponse[MemberResponse](items=items, total=len(items))


# ---------------------------------------------------------------------------
# Fixed segment first: /ledgers/join must not be read as /ledgers/{id} (§1.3)
# ---------------------------------------------------------------------------


@router.post("/join", response_model=LedgerResponse)
def join_ledger(
    payload: JoinRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LedgerResponse:
    """Redeem an invite code and join the ledger behind it (§5.19).

    The rate limit is the very first thing that happens, before the code is
    looked at, which is what makes "429 never consumes a code" true (decision
    §2): the code is only deleted by a successful join.
    """
    ratelimit_check(JOIN_BUCKET, JOIN_BUCKET_KEY, JOIN_LIMIT)

    ledger = ledger_service.redeem_invite(db, current_user, payload.code)
    body = _ledger_response(db, ledger, ledger_service.ROLE_MEMBER, with_counts=True)
    db.commit()
    return body


# ---------------------------------------------------------------------------
# Collection
# ---------------------------------------------------------------------------


@router.get("", response_model=ListResponse[LedgerResponse], response_model_exclude_none=True)
def list_ledgers(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ListResponse[LedgerResponse]:
    """Every ledger the caller belongs to, oldest first (§5.8).

    No ``counts`` and no net worth here — the cards only show the member count
    and the base currency (decision §14.52 A16).
    """
    rows = db.execute(
        select(Ledger, LedgerMember.role)
        .join(LedgerMember, LedgerMember.ledger_id == Ledger.id)
        .where(LedgerMember.user_id == current_user.id)
        .order_by(Ledger.created_at.asc(), Ledger.id.asc())
    ).all()

    # One grouped count for the whole page rather than one query per ledger
    # (§5.8 副作用: "一条带 JOIN ledger_members 的查询 + 一条分组 count").
    ledger_ids = [ledger.id for ledger, _ in rows]
    member_counts: dict[uuid.UUID, int] = {}
    if ledger_ids:
        member_counts = dict(
            db.execute(
                select(LedgerMember.ledger_id, func.count())
                .where(LedgerMember.ledger_id.in_(ledger_ids))
                .group_by(LedgerMember.ledger_id)
            ).all()
        )

    items = [
        LedgerResponse(
            id=ledger.id,
            name=ledger.name,
            base_currency=ledger.base_currency,
            role=role,
            member_count=member_counts.get(ledger.id, 0),
            created_by=ledger.created_by,
            created_at=ledger.created_at,
            updated_at=ledger.updated_at,
        )
        for ledger, role in rows
    ]
    return ListResponse[LedgerResponse](items=items, total=len(items))


@router.post(
    "",
    response_model=LedgerResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
def create_ledger(
    payload: LedgerCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LedgerResponse:
    """Create a ledger with the caller as its owner (§5.9).

    ``base_currency`` defaults to the caller's own default currency; an
    unsupported code is 400 and an eleventh ledger is 409
    ``ledger_limit_reached``.
    """
    currency = _checked_currency(
        payload.base_currency or current_user.base_currency, current_user.base_currency
    )

    ledger = ledger_service.create_ledger(db, current_user, payload.name, currency)
    body = _ledger_response(db, ledger, ledger_service.ROLE_OWNER)
    db.commit()
    return body


# ---------------------------------------------------------------------------
# One ledger
# ---------------------------------------------------------------------------


@router.get("/{id}", response_model=LedgerResponse)
def get_ledger(
    ctx: LedgerContext = Depends(get_ledger_member), db: Session = Depends(get_db)
) -> LedgerResponse:
    """One ledger, with the three counts the delete dialog shows (§5.10)."""
    return _ledger_response(db, ctx.ledger, ctx.member.role, with_counts=True)


@router.patch("/{id}", response_model=LedgerResponse, response_model_exclude_none=True)
def update_ledger(
    payload: LedgerPatch,
    ctx: LedgerContext = Depends(require_owner),
    db: Session = Depends(get_db),
) -> LedgerResponse:
    """Rename a ledger or change its base currency (§5.11); owner only.

    Optimistic concurrency per §4.4: the row is locked, the request's
    ``updated_at`` has to match to the microsecond, and a mismatch is 409
    ``stale_update``. Changing the base currency rewrites nothing — every
    transaction keeps its own currency and amount, conversion happens on read
    (decision §8).
    """
    # ``populate_existing`` is what makes this a compare-and-set: the dependency
    # already put this row in the Session's identity map, and without it the
    # locking SELECT would hand back that same object with its *pre-lock*
    # attributes, so the stamp comparison would use a value read before anyone
    # was locked out (§4.4).
    ledger = db.execute(
        select(Ledger)
        .where(Ledger.id == ctx.ledger.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one()

    if payload.updated_at != ledger.updated_at:
        raise ApiError(
            409,
            ErrorCode.STALE_UPDATE,
            "Ledger was modified by someone else; reload and retry",
        )

    fields = payload.model_dump(exclude_unset=True)
    if fields.get("name") is not None:
        ledger.name = fields["name"]
    if fields.get("base_currency") is not None:
        ledger.base_currency = _checked_currency(
            fields["base_currency"], ledger.base_currency
        )

    ledger.updated_at = _utcnow()
    db.flush()

    body = _ledger_response(db, ledger, ctx.member.role)
    db.commit()
    return body


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_ledger(
    confirm_name: str | None = Query(
        None, description="Must equal the ledger's current name, typed by the user"
    ),
    ctx: LedgerContext = Depends(require_owner),
    db: Session = Depends(get_db),
) -> Response:
    """Delete a ledger and everything in it (§5.12); owner only.

    ``confirm_name`` has to be typed out and match exactly, because the delete
    is unrecoverable: accounts, transactions, events and import batches all go
    with it through the database's ``ON DELETE CASCADE`` (§5.12, decision
    §14.52 A22). Nothing on disk to clean up — uploads are never stored.
    """
    if confirm_name != ctx.ledger.name:
        raise ApiError(
            400,
            ErrorCode.VALIDATION_ERROR,
            "query.confirm_name: must match the ledger name exactly",
        )

    # A plain ``DELETE FROM ledgers``: every child table hangs off the ledger
    # with ``ON DELETE CASCADE``, so the database empties them in the same
    # statement and the ORM never has to walk the graph.
    db.execute(delete(Ledger).where(Ledger.id == ctx.ledger.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------


@router.get("/{id}/members", response_model=ListResponse[MemberResponse])
def list_members(
    ctx: LedgerContext = Depends(get_ledger_member), db: Session = Depends(get_db)
) -> ListResponse[MemberResponse]:
    """Who is in this ledger (§5.13).

    The only place the frontend can turn a transaction's ``created_by`` UUID
    into a name: ``display_name`` when set, otherwise the part of the email in
    front of the ``@`` (decision §14.40).
    """
    return _member_list(db, ctx.ledger, ctx.user)


@router.delete(
    "/{id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def remove_member(
    user_id: uuid.UUID = Path(..., description="The member to remove"),
    ctx: LedgerContext = Depends(require_owner),
    db: Session = Depends(get_db),
) -> Response:
    """Drop someone from the ledger (§5.14); owner only.

    What they created stays — accounts and transactions belong to the ledger,
    not to the person who entered them (decision §2).
    """
    ledger_service.remove_member(db, ctx.ledger, user_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{id}/leave", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def leave_ledger(
    ctx: LedgerContext = Depends(get_ledger_member), db: Session = Depends(get_db)
) -> Response:
    """Leave a ledger on one's own (§5.15).

    An owner has to hand the ledger over first: 409 ``owner_must_transfer``.
    """
    ledger_service.leave(db, ctx.ledger, ctx.user)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{id}/transfer-ownership", response_model=ListResponse[MemberResponse])
def transfer_ownership(
    payload: TransferOwnershipRequest,
    ctx: LedgerContext = Depends(require_owner),
    db: Session = Depends(get_db),
) -> ListResponse[MemberResponse]:
    """Hand the owner role to another member (§5.16); owner only.

    Both rows change in one transaction, so the ledger has exactly one owner at
    every instant; the caller is a plain member as soon as this returns.
    """
    ledger_service.transfer_ownership(db, ctx.ledger, payload.to_user_id)
    body = _member_list(db, ctx.ledger, ctx.user)
    db.commit()
    return body


# ---------------------------------------------------------------------------
# Invites
# ---------------------------------------------------------------------------


@router.post(
    "/{id}/invites", response_model=InviteResponse, status_code=status.HTTP_201_CREATED
)
def create_invite(
    ctx: LedgerContext = Depends(require_owner), db: Session = Depends(get_db)
) -> InviteResponse:
    """Draw a 6 digit invite code, valid for 10 minutes and single use (§5.17).

    The code is shown exactly once — there is no endpoint that lists codes, so
    reloading the page means drawing a new one (decision §2). This ledger's
    expired codes are swept on the way past (decision §14.29).
    """
    invite = ledger_service.issue_invite(db, ctx.ledger, ctx.user)
    body = InviteResponse(
        id=invite.id,
        code=invite.code,
        ledger_id=ctx.ledger.id,
        ledger_name=ctx.ledger.name,
        expires_at=invite.expires_at,
        created_at=invite.created_at,
    )
    db.commit()
    return body


@router.delete(
    "/{id}/invites/{code}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def revoke_invite(
    code: str = Path(..., pattern=INVITE_CODE_PATTERN, description="The 6 digit code"),
    ctx: LedgerContext = Depends(require_owner),
    db: Session = Depends(get_db),
) -> Response:
    """Kill a code before it expires (§5.18, decision §14.52 A2); owner only.

    Revoking is a delete, and a delete is idempotent in one direction only:
    already used, already expired and never issued all answer 404 (§3.3).
    """
    ledger_service.revoke_invite(db, ctx.ledger, code)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
