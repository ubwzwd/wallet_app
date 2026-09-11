"""Ledger, membership and invite business logic (03-backend-api.md §1.2).

Every function takes the ``Session`` first and **flushes but never commits** —
the endpoint owns the transaction, so "one transaction" side effects such as
"insert the member and delete the invite" (§5.19) stay atomic and a failure
anywhere rolls the whole request back (decision §2).

Two rules this module implements literally, because they are what makes the
invite table self-cleaning (decision §14.29):

* the ``code`` column carries **no** unique index — a freshly drawn code is
  only checked against codes that are still valid, and a clash just redraws;
* used, revoked and expired rows are **deleted**, never marked. Expired rows
  are swept lazily whenever a code is issued or redeemed, so there is no
  background job and the table only ever holds live codes.

Authorization (member / owner) is not done here: the endpoints do it through
``core/deps.py`` (§3.2), and so is rate limiting (§8). What is enforced here
is everything that needs the database to decide — the soft limits of decision
§2 and the ordering of the checks in §5.9 and §5.14-§5.19.
"""
import datetime as dt
import secrets
import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import ApiError, ErrorCode
from app.models.finance_source import FinanceSource
from app.models.import_batch import ImportBatch
from app.models.ledger import Ledger, LedgerInvite, LedgerMember
from app.models.transaction import Transaction
from app.models.user import User

# Name of the ledger created for every new account (§5.1, decision §2).
DEFAULT_LEDGER_NAME = "我的账本"

# Ledger names share the account name bounds, 1..100 (decision §14.13).
LEDGER_NAME_MAX_LENGTH = 100

# An invite lives 10 minutes and is single use (decision §2).
INVITE_TTL = dt.timedelta(minutes=10)

# Draws of a 6 digit code before giving up; a clash is already improbable
# with a few dozen live codes, so five failures mean something is wrong (§5.17).
INVITE_CODE_ATTEMPTS = 5

ROLE_OWNER = "owner"
ROLE_MEMBER = "member"


def _utcnow() -> dt.datetime:
    """Naive UTC ``now``, matching the naive ``DateTime`` columns (§4.5)."""
    return dt.datetime.now(dt.UTC).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------


def member_count(db: Session, ledger_id: uuid.UUID) -> int:
    """Number of people in a ledger (§5.8, §5.9, the ``member_count`` field)."""
    return int(
        db.execute(
            select(func.count())
            .select_from(LedgerMember)
            .where(LedgerMember.ledger_id == ledger_id)
        ).scalar_one()
    )


def user_ledger_count(db: Session, user_id: uuid.UUID) -> int:
    """How many ledgers a user belongs to, owned or joined (decision §2)."""
    return int(
        db.execute(
            select(func.count())
            .select_from(LedgerMember)
            .where(LedgerMember.user_id == user_id)
        ).scalar_one()
    )


def ledger_counts(db: Session, ledger_id: uuid.UUID) -> dict[str, int]:
    """The three counts shown before deleting a ledger (§5.10, §14.52 A22).

    Three plain ``count(*)`` queries: transactions, finance sources and import
    batches belonging to this ledger.
    """
    def count_of(model: type[Transaction] | type[FinanceSource] | type[ImportBatch]) -> int:
        return int(
            db.execute(
                select(func.count()).select_from(model).where(model.ledger_id == ledger_id)
            ).scalar_one()
        )

    return {
        "transactions": count_of(Transaction),
        "sources": count_of(FinanceSource),
        "import_batches": count_of(ImportBatch),
    }


def _get_member(db: Session, ledger_id: uuid.UUID, user_id: uuid.UUID) -> LedgerMember | None:
    """The membership row of ``user_id`` in ``ledger_id``, or ``None``."""
    return db.execute(
        select(LedgerMember).where(
            LedgerMember.ledger_id == ledger_id,
            LedgerMember.user_id == user_id,
        )
    ).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Ledgers
# ---------------------------------------------------------------------------


def create_ledger(db: Session, user: User, name: str, base_currency: str) -> Ledger:
    """Create a ledger with ``user`` as its owner (§5.9). Flushes, never commits.

    ``name`` is stripped and must be 1..100 characters; ``base_currency`` is
    upper-cased. Whether the currency is one upstream supports is checked by
    the endpoint (it needs the currency list), this only rejects a malformed
    code. A user at ``MAX_LEDGERS_PER_USER`` ledgers gets 409
    ``ledger_limit_reached``.
    """
    clean_name = (name or "").strip()
    if not 1 <= len(clean_name) <= LEDGER_NAME_MAX_LENGTH:
        raise ApiError(
            400,
            ErrorCode.VALIDATION_ERROR,
            f"name must be 1 to {LEDGER_NAME_MAX_LENGTH} characters after trimming",
        )

    currency = (base_currency or "").strip().upper()
    if len(currency) != 3 or not currency.isalpha():
        raise ApiError(
            400, ErrorCode.VALIDATION_ERROR, "base_currency must be a 3 letter code"
        )

    if user_ledger_count(db, user.id) >= settings.MAX_LEDGERS_PER_USER:
        raise ApiError(
            409,
            ErrorCode.LEDGER_LIMIT_REACHED,
            f"You already belong to {settings.MAX_LEDGERS_PER_USER} ledgers",
        )

    now = _utcnow()
    ledger = Ledger(
        name=clean_name,
        base_currency=currency,
        created_by=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(ledger)
    db.flush()  # assigns ledger.id for the membership row below

    db.add(
        LedgerMember(
            ledger_id=ledger.id,
            user_id=user.id,
            role=ROLE_OWNER,
            joined_at=now,
        )
    )
    db.flush()
    return ledger


def create_default_ledger(db: Session, user: User) -> Ledger:
    """The ledger every registration creates (§5.1, decision §2).

    Named "我的账本" and denominated in the user's own default currency.
    Flushes, never commits: registration writes user, ledger and membership in
    one transaction.
    """
    return create_ledger(db, user, DEFAULT_LEDGER_NAME, user.base_currency)


# ---------------------------------------------------------------------------
# Invites
# ---------------------------------------------------------------------------


def issue_invite(db: Session, ledger: Ledger, actor: User) -> LedgerInvite:
    """Draw a fresh 6 digit invite code for ``ledger`` (§5.17). Flushes only.

    Follows the four steps of §5.17 in order: sweep this ledger's expired rows,
    draw ``secrets.randbelow(1_000_000)``, check it against codes that are
    still valid (redrawing on a clash, at most ``INVITE_CODE_ATTEMPTS`` times),
    then insert with ``expires_at = now + 10 minutes``.

    A full ledger gets 409 ``member_limit_reached`` — there would be nobody
    left to accept the code. Five clashing draws mean 500 ``internal_error``.
    """
    now = _utcnow()

    # Step 1: lazy sweep of this ledger's expired codes (decision §14.29).
    db.execute(
        delete(LedgerInvite).where(
            LedgerInvite.ledger_id == ledger.id,
            LedgerInvite.expires_at <= now,
        )
    )

    if member_count(db, ledger.id) >= settings.MAX_MEMBERS_PER_LEDGER:
        raise ApiError(
            409,
            ErrorCode.MEMBER_LIMIT_REACHED,
            f"This ledger already has {settings.MAX_MEMBERS_PER_LEDGER} members",
        )

    code: str | None = None
    for _ in range(INVITE_CODE_ATTEMPTS):
        # Steps 2 and 3: draw, then compare against live codes only. There is
        # no unique index on `code`; expired codes may be reused freely.
        candidate = f"{secrets.randbelow(1_000_000):06d}"
        taken = db.execute(
            select(LedgerInvite.id)
            .where(LedgerInvite.code == candidate, LedgerInvite.expires_at > now)
            .limit(1)
        ).first()
        if taken is None:
            code = candidate
            break

    if code is None:
        raise ApiError(
            500,
            ErrorCode.INTERNAL_ERROR,
            "Could not allocate an invite code, please try again",
        )

    # Step 4.
    invite = LedgerInvite(
        ledger_id=ledger.id,
        code=code,
        created_by=actor.id,
        created_at=now,
        expires_at=now + INVITE_TTL,
    )
    db.add(invite)
    db.flush()
    return invite


def revoke_invite(db: Session, ledger: Ledger, code: str) -> None:
    """Delete one of this ledger's codes (§5.18). Flushes, never commits.

    Revoking is a physical delete, since the table only holds live codes
    (decision §14.29). Already used, already expired and never issued are the
    same answer to the caller: 404 ``not_found`` (§3.3).
    """
    result = db.execute(
        delete(LedgerInvite).where(
            LedgerInvite.ledger_id == ledger.id,
            LedgerInvite.code == code,
        )
    )
    if result.rowcount == 0:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Invite code not found")
    db.flush()


def redeem_invite(db: Session, user: User, code: str) -> Ledger:
    """Join the ledger behind ``code`` (§5.19 steps 2-6). Flushes, never commits.

    Only rows that have not expired are considered, and the matching expired
    rows are swept on the way past; a miss is 400 ``invite_invalid`` whether
    the code never existed, was already used, or has expired — from the outside
    those are indistinguishable, which is the point (decision §14.29).

    Then, in this order: 409 ``already_member``, 409 ``member_limit_reached``,
    409 ``ledger_limit_reached``. None of the three consume the code; only a
    successful join does, in the same transaction as the membership insert.
    """
    now = _utcnow()

    # `FOR UPDATE` serializes two people redeeming the same code on Postgres;
    # SQLite has no row locks and the dialect renders nothing, which is fine
    # for the tests and for the single writer case.
    invite = db.execute(
        select(LedgerInvite)
        .where(LedgerInvite.code == code, LedgerInvite.expires_at > now)
        .with_for_update()
    ).scalars().first()

    # Sweep expired rows carrying this code (decision §14.29).
    db.execute(
        delete(LedgerInvite).where(
            LedgerInvite.code == code, LedgerInvite.expires_at <= now
        )
    )

    if invite is None:
        raise ApiError(400, ErrorCode.INVITE_INVALID, "This invite code is not valid")

    ledger = db.get(Ledger, invite.ledger_id)
    if ledger is None:  # pragma: no cover - the FK makes this unreachable
        raise ApiError(400, ErrorCode.INVITE_INVALID, "This invite code is not valid")

    if _get_member(db, ledger.id, user.id) is not None:
        raise ApiError(409, ErrorCode.ALREADY_MEMBER, "You are already in this ledger")

    if member_count(db, ledger.id) >= settings.MAX_MEMBERS_PER_LEDGER:
        raise ApiError(
            409,
            ErrorCode.MEMBER_LIMIT_REACHED,
            f"This ledger already has {settings.MAX_MEMBERS_PER_LEDGER} members",
        )

    if user_ledger_count(db, user.id) >= settings.MAX_LEDGERS_PER_USER:
        raise ApiError(
            409,
            ErrorCode.LEDGER_LIMIT_REACHED,
            f"You already belong to {settings.MAX_LEDGERS_PER_USER} ledgers",
        )

    db.add(
        LedgerMember(
            ledger_id=ledger.id,
            user_id=user.id,
            role=ROLE_MEMBER,
            joined_at=now,
        )
    )
    db.delete(invite)  # single use: the row goes away with the join
    db.flush()
    return ledger


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------


def transfer_ownership(db: Session, ledger: Ledger, to_user_id: uuid.UUID) -> None:
    """Hand the owner role to another member (§5.16). Flushes, never commits.

    Both membership rows are locked and swapped in one transaction, so the
    ledger has exactly one owner at every instant (decision §2). The target
    must be a member (404 ``member_not_found``) and must not be the current
    owner (400 ``validation_error``).
    """
    members = list(
        db.execute(
            select(LedgerMember)
            .where(LedgerMember.ledger_id == ledger.id)
            .with_for_update()
        ).scalars()
    )
    by_user = {member.user_id: member for member in members}

    target = by_user.get(to_user_id)
    if target is None:
        raise ApiError(404, ErrorCode.MEMBER_NOT_FOUND, "That user is not a member")

    current_owner = next((m for m in members if m.role == ROLE_OWNER), None)
    if current_owner is None:  # pragma: no cover - broken invariant, not a user error
        raise ApiError(500, ErrorCode.INTERNAL_ERROR, "This ledger has no owner")

    if current_owner.user_id == to_user_id:
        raise ApiError(
            400, ErrorCode.VALIDATION_ERROR, "That user is already the owner"
        )

    current_owner.role = ROLE_MEMBER
    target.role = ROLE_OWNER
    db.flush()


def remove_member(db: Session, ledger: Ledger, user_id: uuid.UUID) -> None:
    """Drop someone from a ledger (§5.14). Flushes, never commits.

    404 ``member_not_found`` when the target is not in this ledger, 409
    ``cannot_remove_owner`` when the target is the owner (including the caller
    themselves — they have to transfer first). What the removed member created
    stays in the ledger (decision §2).
    """
    member = _get_member(db, ledger.id, user_id)
    if member is None:
        raise ApiError(404, ErrorCode.MEMBER_NOT_FOUND, "That user is not a member")
    if member.role == ROLE_OWNER:
        raise ApiError(
            409,
            ErrorCode.CANNOT_REMOVE_OWNER,
            "The owner cannot be removed; transfer ownership first",
        )
    db.delete(member)
    db.flush()


def leave(db: Session, ledger: Ledger, user: User) -> None:
    """Leave a ledger on one's own (§5.15). Flushes, never commits.

    An owner must transfer ownership first: 409 ``owner_must_transfer``
    (decision §2). Someone who is no longer a member gets 404 ``not_found``,
    the same answer as an invisible ledger (§3.3).
    """
    member = _get_member(db, ledger.id, user.id)
    if member is None:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Ledger not found")
    if member.role == ROLE_OWNER:
        raise ApiError(
            409,
            ErrorCode.OWNER_MUST_TRANSFER,
            "Transfer ownership before leaving this ledger",
        )
    db.delete(member)
    db.flush()
