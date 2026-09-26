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
import uuid

from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
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
    LedgerDetailResponse,
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

# The burst §8.2 allows; the bucket refills completely in ``JOIN_BURST /
# RATE_LIMIT_JOIN_QPS`` seconds, so the default QPS of 1 is "3 attempts, and
# three seconds to fill back up".
JOIN_BURST = 3


def _join_limit() -> Limit:
    """The global join bucket, sized from ``RATE_LIMIT_JOIN_QPS`` (§8.2).

    Built per request rather than at import time so the setting is read where
    it can still be changed (tests, a process restarted with a new env).
    """
    return Limit(
        capacity=JOIN_BURST, refill_seconds=JOIN_BURST / settings.RATE_LIMIT_JOIN_QPS
    )


def _ledger_body(db: Session, ledger: Ledger, role: str) -> LedgerResponse:
    """The ledger body §5.8, §5.9 and §5.11 return — no ``counts``."""
    return LedgerResponse(
        id=ledger.id,
        name=ledger.name,
        base_currency=ledger.base_currency,
        role=role,
        member_count=ledger_service.member_count(db, ledger.id),
        created_by=ledger.created_by,
        created_at=ledger.created_at,
        updated_at=ledger.updated_at,
    )


def _ledger_detail(db: Session, ledger: Ledger, role: str) -> LedgerDetailResponse:
    """The same body plus the three counts, for §5.10 and §5.19."""
    # ``dict(model)`` hands over the raw field values, so the timestamps are
    # not serialized to strings and parsed back on the way into the subclass.
    return LedgerDetailResponse(
        **dict(_ledger_body(db, ledger, role)),
        counts=LedgerCounts(**ledger_service.ledger_counts(db, ledger.id)),
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


@router.post("/join", response_model=LedgerDetailResponse)
def join_ledger(
    payload: JoinRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LedgerDetailResponse:
    """Redeem an invite code and join the ledger behind it (§5.19).

    The rate limit is the very first thing that happens, before the code is
    looked at, which is what makes "429 never consumes a code" true (decision
    §2): the code is only deleted by a successful join.

    A refused redemption commits too. ``redeem_invite`` sweeps the expired rows
    carrying this code on its way past (decision §14.29), and rolling that
    delete back together with the error would leave the dead rows in the table
    forever — nothing ever looks at them again.
    """
    ratelimit_check(JOIN_BUCKET, JOIN_BUCKET_KEY, _join_limit())

    try:
        ledger = ledger_service.redeem_invite(db, current_user, payload.code)
    except ApiError:
        db.commit()
        raise
    body = _ledger_detail(db, ledger, ledger_service.ROLE_MEMBER)
    db.commit()
    return body


# ---------------------------------------------------------------------------
# Collection
# ---------------------------------------------------------------------------


@router.get("", response_model=ListResponse[LedgerResponse])
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


@router.post("", response_model=LedgerResponse, status_code=status.HTTP_201_CREATED)
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
    currency = fx.ensure_supported(
        payload.base_currency or current_user.base_currency, current_user.base_currency
    )

    ledger = ledger_service.create_ledger(db, current_user, payload.name, currency)
    body = _ledger_body(db, ledger, ledger_service.ROLE_OWNER)
    db.commit()
    return body


# ---------------------------------------------------------------------------
# One ledger
# ---------------------------------------------------------------------------


@router.get("/{id}", response_model=LedgerDetailResponse)
def get_ledger(
    ctx: LedgerContext = Depends(get_ledger_member), db: Session = Depends(get_db)
) -> LedgerDetailResponse:
    """One ledger, with the three counts the delete dialog shows (§5.10)."""
    return _ledger_detail(db, ctx.ledger, ctx.member.role)


@router.patch("/{id}", response_model=LedgerResponse)
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
    ).scalar_one_or_none()

    if ledger is None:
        # The dependency saw the row and another owner deleted it in between:
        # the same answer an invisible ledger gets (§3.3).
        raise ApiError(404, ErrorCode.NOT_FOUND, "Ledger not found")

    if payload.updated_at != ledger.updated_at:
        raise ApiError(
            409,
            ErrorCode.STALE_UPDATE,
            "Ledger was modified by someone else; reload and retry",
        )

    # Every check first, then the writes: a currency the provider does not know
    # has to leave the row exactly as it was, name included.
    fields = payload.model_dump(exclude_unset=True)
    currency = (
        fx.ensure_supported(fields["base_currency"], ledger.base_currency)
        if "base_currency" in fields
        else None
    )

    if "name" in fields:
        ledger.name = fields["name"]
    if currency is not None:
        ledger.base_currency = currency

    ledger.updated_at = utcnow()
    db.flush()

    body = _ledger_body(db, ledger, ctx.member.role)
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
    is unrecoverable: transactions, events, import batches, account shares,
    members and invites all go with it through the database's
    ``ON DELETE CASCADE`` (§5.12, decision §14.52 A22). Accounts belong to
    people, not ledgers, so ``finance_sources`` is never touched — only their
    shares into this ledger go (§14.62 f). Nothing on disk to clean up —
    uploads are never stored.
    """
    if confirm_name != ctx.ledger.name:
        raise ApiError(
            400,
            ErrorCode.VALIDATION_ERROR,
            "query.confirm_name: must match the ledger name exactly",
        )

    # A plain ``DELETE FROM ledgers``: every child table — ledger_sources,
    # transactions, import batches, members, invites, events — hangs off the
    # ledger with ``ON DELETE CASCADE``, so the database empties them in the
    # same statement and the ORM never has to walk the graph. finance_sources
    # has no ledger column and is not touched (§14.62 f).
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
