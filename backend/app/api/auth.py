"""Registration and login (03-backend-api.md §5.1-§5.2).

Both endpoints are public and both are rate limited by client IP (§8.2), which
is why they are the only two routes that reach for ``core/ratelimit``. The
``me`` aliases the previous version registered under this prefix are gone:
``/me`` is the single entry point (decision §14.42), so this module has exactly
two routes.
"""
from fastapi import APIRouter, Depends, status
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
from app.core.security import authenticate_user, create_access_token, get_password_hash
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse
from app.services import fx, ledger_service

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


def _email_exists() -> ApiError:
    """The single 409 both the pre-check and the unique index produce (§5.1)."""
    return ApiError(409, ErrorCode.EMAIL_EXISTS, "That email address is already registered")


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    ip: str = Depends(client_ip),
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Create an account plus its default ledger and return a token (§5.1).

    One transaction writes all three rows — ``users``, ``ledgers`` and the
    ``owner`` row in ``ledger_members`` (decision §2) — so a failure anywhere
    leaves no half-registered account. ``display_name`` starts NULL; the user
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
    db.commit()

    return TokenResponse(access_token=create_access_token({"sub": str(user_id)}))


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    ip: str = Depends(client_ip),
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Exchange email and password for a bearer token (§5.2).

    An unknown address and a wrong password produce the *same* 401 body, so the
    endpoint cannot be used to enumerate accounts (§9.5). A successful login
    clears the IP's bucket, which is why a legitimate user never meets the
    limit (§8.2). Nothing is written.
    """
    ratelimit.check("login", ip, _login_limit())

    user = authenticate_user(db, payload.email, payload.password)
    if user is None:
        raise ApiError(401, ErrorCode.INVALID_CREDENTIALS, "Incorrect email or password")

    ratelimit.reset("login", ip)
    return TokenResponse(access_token=create_access_token({"sub": str(user.id)}))
