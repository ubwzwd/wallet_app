"""Refresh-token sessions (decision §14.67).

A refresh token is an opaque ``secrets.token_urlsafe(48)`` string; the database
only ever sees its SHA-256 hex digest (02-database.md §1.12). Every successful
login or registration starts a *family*; each rotation marks the presented row
used and adds a fresh row to the same family, which is what lets a replayed,
already rotated token take the whole sign-in down with it.

Nothing here commits — the route does, so a token row lands in the same
transaction as whatever else the request writes. The one exception is the
replay branch of :func:`rotate`, which has to persist its revocation before it
raises (see there).

``now`` parameters exist for tests only; production callers leave them out and
get :func:`app.core.clock.utcnow`.
"""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
from app.core.errors import ApiError, ErrorCode
from app.models.refresh_token import RefreshToken

# A token that was rotated this many seconds ago or less may be presented again
# without counting as theft: two tabs refreshing at once, or a client retrying a
# refresh whose response it never received (§14.67).
REFRESH_REUSE_GRACE_SECONDS = 30

# Used and revoked rows are kept this long (so a late replay still meets a
# revoked row rather than nothing), then pruned.
_RETENTION = timedelta(days=1)

# 48 random bytes -> 64 URL-safe characters, 384 bits: not enumerable, hence
# no rate limit on /auth/refresh.
_TOKEN_BYTES = 48


def _refresh_invalid() -> ApiError:
    """The single 401 every refresh failure produces, whatever the reason."""
    return ApiError(401, ErrorCode.REFRESH_INVALID, "Refresh token is invalid or expired")


def hash_token(token: str) -> str:
    """Lower-case SHA-256 hex digest of ``token``: what the table stores."""
    return hashlib.sha256(token.encode()).hexdigest()


def _lifetime() -> timedelta:
    return timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)


def _find(db: Session, token: str, *, for_update: bool = False) -> RefreshToken | None:
    stmt = select(RefreshToken).where(RefreshToken.token_hash == hash_token(token))
    if for_update:
        # Serialises two refreshes of the same token on Postgres; a no-op on
        # SQLite, which has one writer anyway.
        stmt = stmt.with_for_update()
    return db.execute(stmt).scalar_one_or_none()


def issue(
    db: Session,
    user_id: uuid.UUID,
    *,
    family_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> str:
    """Add a refresh-token row for ``user_id`` and return the plain token.

    Without ``family_id`` the row starts a new family (a login or a
    registration); with it, the row continues that family (a rotation). The
    row expires ``REFRESH_TOKEN_EXPIRE_DAYS`` after ``now``. The plain token is
    returned to the caller and never stored.
    """
    now = now or utcnow()
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    db.add(
        RefreshToken(
            user_id=user_id,
            family_id=family_id or uuid.uuid4(),
            token_hash=hash_token(token),
            created_at=now,
            expires_at=now + _lifetime(),
        )
    )
    db.flush()
    return token


def _revoke_family(db: Session, family_id: uuid.UUID, now: datetime) -> int:
    result = db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    return result.rowcount


def rotate(db: Session, token: str, *, now: datetime | None = None) -> tuple[uuid.UUID, str]:
    """Exchange ``token`` for a new refresh token of the same family (§14.67).

    Returns ``(user_id, new_refresh_token)``. In order:

    a. no row with this hash, b. the row is revoked, or c. it has expired:
       401 ``refresh_invalid``;
    d. the row was already rotated —
       within ``REFRESH_REUSE_GRACE_SECONDS`` of that rotation it is treated as
       a benign duplicate and gets a new token too (``used_at`` keeps its first
       value, nothing is revoked); later than that it is a replay of a stolen
       token: every live row of the family is revoked and the call fails with
       the same 401;
    e. otherwise the row is marked used and a new row joins the family, its
       expiry ``REFRESH_TOKEN_EXPIRE_DAYS`` from now (the idle window slides).

    Like every function here it leaves the commit to the caller — except in
    the replay branch, which commits the revocation itself before raising.
    That is the only place in this module that commits: the route's session is
    rolled back on an error, and the revocation must survive the 401.
    """
    now = now or utcnow()
    row = _find(db, token, for_update=True)
    if row is None or row.revoked_at is not None or row.expires_at <= now:
        raise _refresh_invalid()

    if row.used_at is not None:
        if now - row.used_at <= timedelta(seconds=REFRESH_REUSE_GRACE_SECONDS):
            return row.user_id, issue(db, row.user_id, family_id=row.family_id, now=now)
        _revoke_family(db, row.family_id, now)
        db.commit()
        raise _refresh_invalid()

    row.used_at = now
    return row.user_id, issue(db, row.user_id, family_id=row.family_id, now=now)


def revoke_family_of(db: Session, token: str, *, now: datetime | None = None) -> int:
    """Revoke every live row of the family ``token`` belongs to (logout).

    Returns how many rows were revoked; ``0`` when the token is unknown or its
    family is already revoked. Never raises for an unknown token, so logout
    cannot be used to probe which tokens exist.
    """
    now = now or utcnow()
    row = _find(db, token)
    if row is None:
        return 0
    return _revoke_family(db, row.family_id, now)


def revoke_all_for_user(db: Session, user_id: uuid.UUID, *, now: datetime | None = None) -> int:
    """Revoke every live refresh token of ``user_id`` (log out everywhere)."""
    now = now or utcnow()
    result = db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    return result.rowcount


def prune(db: Session, user_id: uuid.UUID, *, now: datetime | None = None) -> int:
    """Delete ``user_id``'s dead rows and return how many went.

    Dead means expired, rotated more than a day ago, or revoked more than a
    day ago. Live rows and other users' rows are never touched.
    """
    now = now or utcnow()
    cutoff = now - _RETENTION
    result = db.execute(
        delete(RefreshToken).where(
            RefreshToken.user_id == user_id,
            or_(
                RefreshToken.expires_at < now,
                RefreshToken.used_at < cutoff,
                RefreshToken.revoked_at < cutoff,
            ),
        )
    )
    return result.rowcount
