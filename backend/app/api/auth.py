"""Registration, login and the refresh-token session routes (03-backend-api.md
§5.1-§5.2, decision §14.67).

``register`` and ``login`` are public and rate limited by client IP (§8.2),
which is why they are the only routes here that reach for ``core/ratelimit``;
both now hand out a refresh token next to the access token. ``refresh`` and
``logout`` are public too — the access token is likely expired by the time
either is called — and are not rate limited, because a 384-bit random token
cannot be guessed. ``logout-all`` needs a valid access token. The ``me``
aliases the previous version registered under this prefix are gone: ``/me`` is
the single entry point (decision §14.42).
"""
import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import ratelimit
from app.core.clock import utcnow
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import client_ip
from app.core.errors import ApiError, ErrorCode
from app.core.ratelimit import Limit
from app.core.security import (
    authenticate_user,
    create_access_token,
    get_current_user,
    get_password_hash,
)
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
)
from app.services import fx, ledger_service, session_service

router = APIRouter(prefix="/auth", tags=["Authentication"])

SECONDS_PER_HOUR = 3600
SECONDS_PER_MINUTE = 60


def _register_limit() -> Limit:
    """``RATE_LIMIT_REGISTER_PER_HOUR`` registrations per IP per hour (§8.2)."""
    return Limit(
        capacity=settings.RATE_LIMIT_REGISTER_PER_HOUR, refill_seconds=SECONDS_PER_HOUR
    )


def _login_limit() -> Limit:
    """``RATE_LIMIT_LOGIN_PER_MINUTE`` login attempts per IP per minute (§8.2)."""
    return Limit(
        capacity=settings.RATE_LIMIT_LOGIN_PER_MINUTE, refill_seconds=SECONDS_PER_MINUTE
    )


def _token_response(user_id: uuid.UUID, refresh_token: str) -> TokenResponse:
    """The body register, login and refresh share (§14.67)."""
    return TokenResponse(
        access_token=create_access_token({"sub": str(user_id)}),
        refresh_token=refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * SECONDS_PER_MINUTE,
    )


def _email_exists() -> ApiError:
    """The single 409 both the pre-check and the unique index produce (§5.1)."""
    return ApiError(409, ErrorCode.EMAIL_EXISTS, "That email address is already registered")


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    ip: str = Depends(client_ip),
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Create an account plus its default ledger and return tokens (§5.1).

    One transaction writes all four rows — ``users``, ``ledgers``, the
    ``owner`` row in ``ledger_members`` (decision §2) and the first
    ``refresh_tokens`` row (§14.67) — so a failure anywhere leaves no
    half-registered account. ``display_name`` starts NULL; the user
    fills it in later from the profile page (decision §14.40). The chosen
    ``base_currency`` has to be one the rate provider supports, the same check
    §5.4 and §5.9 make — the account and its default ledger would otherwise
    start out in a currency nothing can convert from.
    """
    ratelimit.check("register", ip, _register_limit())

    if not settings.REGISTRATION_OPEN:
        raise ApiError(
            403, ErrorCode.REGISTRATION_CLOSED, "Registration is currently closed"
        )

    # The schema already upper-cased the code and checked its shape; whether
    # anything can convert from it is this check (§5.4, §5.9 use the same one).
    # There is no currency in effect yet, so an unreachable provider is a 503
    # rather than a code nobody verified.
    base_currency = fx.ensure_supported(payload.base_currency)

    # The schema already lower-cased the address (§5.1); the unique index is on
    # the stored value, so this probe and the fallback below compare the same
    # string.
    email = payload.email
    existing = db.execute(select(User.id).where(User.email == email)).first()
    if existing is not None:
        raise _email_exists()

    now = utcnow()
    user = User(
        email=email,
        password_hash=get_password_hash(payload.password),
        display_name=None,
        base_currency=base_currency,
        language=payload.language,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        # Two registrations of the same address racing past the probe above:
        # the unique index settles it and both callers see the same 409.
        db.rollback()
        raise _email_exists() from exc

    user_id = user.id
    ledger_service.create_default_ledger(db, user)
    refresh_token = session_service.issue(db, user_id, now=now)
    db.commit()

    return _token_response(user_id, refresh_token)


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    ip: str = Depends(client_ip),
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Exchange email and password for an access and a refresh token (§5.2).

    An unknown address and a wrong password produce the *same* 401 body, so the
    endpoint cannot be used to enumerate accounts (§9.5). A successful login
    clears the IP's bucket, which is why a legitimate user never meets the
    limit (§8.2). It is also the only write: a new refresh-token family, plus
    pruning the user's dead refresh-token rows in the same transaction
    (§14.67). A failed login writes nothing.
    """
    ratelimit.check("login", ip, _login_limit())

    user = authenticate_user(db, payload.email, payload.password)
    if user is None:
        raise ApiError(401, ErrorCode.INVALID_CREDENTIALS, "Incorrect email or password")

    ratelimit.reset("login", ip)
    user_id = user.id
    session_service.prune(db, user_id)
    refresh_token = session_service.issue(db, user_id)
    db.commit()
    return _token_response(user_id, refresh_token)


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """Trade a refresh token for a new access token and a new refresh token.

    Public: the access token has usually expired by now. The presented token
    is rotated (``session_service.rotate``): an unknown, revoked, expired or
    replayed token all produce the same 401 ``refresh_invalid``, and a replay
    outside the grace window revokes its whole family first. The user's dead
    rows are pruned in the same transaction (§14.67).
    """
    user_id, refresh_token = session_service.rotate(db, payload.refresh_token)
    session_service.prune(db, user_id)
    db.commit()
    return _token_response(user_id, refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def logout(payload: LogoutRequest, db: Session = Depends(get_db)) -> Response:
    """End the sign-in the refresh token belongs to; always 204 (§14.67).

    Public on purpose — the access token may already have expired. Every live
    token of the family is revoked; an unknown, revoked or expired token is
    silently accepted, so the endpoint is idempotent and reveals nothing about
    which tokens exist. Access tokens already issued stay valid for the rest
    of their (at most ``ACCESS_TOKEN_EXPIRE_MINUTES``) lifetime.
    """
    session_service.revoke_family_of(db, payload.refresh_token)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def logout_all(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Revoke every refresh token the caller has, on every device (§14.67).

    Access tokens already issued stay valid for the rest of their lifetime;
    users gain no column to invalidate them early.
    """
    session_service.revoke_all_for_user(db, current_user.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
