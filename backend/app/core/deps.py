"""Shared FastAPI dependencies (docs/target-design/03-backend-api.md §1.2).

Ledger authorization lives here: every ``/api/v1/ledgers/{id}/...`` endpoint
depends on :func:`get_ledger_member`, and the owner-only ones stack
:func:`require_owner` on top of it (§3.2). The visibility rule of §3.3 is what
makes both of them terse: "can you see it" is a 404, "you see it but may not do
it" is a 403.
"""
import uuid
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Header, Path, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import ApiError, ErrorCode
from app.core.security import get_current_user
from app.models.ledger import Ledger, LedgerMember
from app.models.user import User

# X-Client is free text from the client, stored verbatim on transaction events
# (§4.7), so it is clamped on both length and character set. 16 is the width of
# ``transaction_events.client`` (02-database.md §1.9, and 03 §4.7 since the
# 2026-09-12 sync) — the same number as ``services.events.MAX_CLIENT_LENGTH``,
# so the header is cut once here rather than silently again on INSERT.
CLIENT_NAME_MAX_LENGTH = 16


@dataclass(frozen=True)
class LedgerContext:
    """The ledger the request addresses, plus who is asking and as what role."""

    ledger: Ledger
    member: LedgerMember          # role is "owner" or "member"
    user: User


def get_ledger_member(
    id: uuid.UUID = Path(..., description="Ledger id"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LedgerContext:
    """Authorize the caller against the ledger in the path (§3.2).

    Three fixed steps: load the ledger, load the caller's membership, hand back
    the context. A ledger that does not exist and a ledger the caller is not a
    member of both raise 404 ``not_found``, so membership is never leaked
    (§3.3).
    """
    ledger = db.get(Ledger, id)
    if ledger is None:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Ledger not found")

    member = db.execute(
        select(LedgerMember).where(
            LedgerMember.ledger_id == id,
            LedgerMember.user_id == current_user.id,
        )
    ).scalar_one_or_none()
    if member is None:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Ledger not found")

    return LedgerContext(ledger=ledger, member=member, user=current_user)


def require_owner(ctx: LedgerContext = Depends(get_ledger_member)) -> LedgerContext:
    """Restrict an endpoint to the ledger's owner; members get 403 ``not_owner``."""
    if ctx.member.role != "owner":
        raise ApiError(403, ErrorCode.NOT_OWNER, "This action requires the ledger owner")
    return ctx


@dataclass(frozen=True)
class Pagination:
    """``limit`` / ``offset`` as accepted by every paged list endpoint (§4.3)."""

    limit: int
    offset: int


def pagination(
    limit: int = Query(50, ge=1, le=200, description="Page size, 1..200"),
    offset: int = Query(0, ge=0, description="Rows to skip"),
) -> Pagination:
    """Parse the two paging parameters; out-of-range values are 422, not clamped."""
    return Pagination(limit=limit, offset=offset)


def client_name(
    x_client: Optional[str] = Header(None, alias="X-Client"),
) -> Optional[str]:
    """The ``X-Client`` header, sanitized for ``transaction_events.client`` (§4.7).

    Printable ASCII only, at most :data:`CLIENT_NAME_MAX_LENGTH` characters,
    truncated rather than rejected. A missing header — or one left empty by the
    filtering — is ``None``; the header never affects authentication or
    authorization.
    """
    if x_client is None:
        return None

    cleaned = "".join(ch for ch in x_client if 0x20 <= ord(ch) <= 0x7E).strip()
    cleaned = cleaned[:CLIENT_NAME_MAX_LENGTH]
    return cleaned or None


def client_ip(request: Request) -> str:
    """The caller's IP as used for the login / register rate limit keys (§8.1).

    Caddy sets ``X-Forwarded-For``; its first segment is the original client.
    Direct connections fall back to the socket peer.
    """
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    if request.client is not None and request.client.host:
        return request.client.host
    return "unknown"
