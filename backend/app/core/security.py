"""Password hashing, JWT issuing and the authenticated-user dependency.

Authentication itself is unchanged from the previous version (bcrypt hashes,
``sub`` carries the user id, no refresh tokens, no server side logout — see
docs/target-design/03-backend-api.md §3.1). What changed is the failure shape:
``HTTPBearer(auto_error=False)`` plus an explicit check, so a missing, invalid
or expired token is always ``401`` with ``code=unauthorized`` instead of
FastAPI's default ``403 "Not authenticated"``.
"""
import uuid
from datetime import UTC, datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.errors import ApiError, ErrorCode
from app.models.user import User

# auto_error=False: a missing Authorization header has to reach our own code so
# it can raise the unified 401 body (§3.1).
security = HTTPBearer(auto_error=False)


def _unauthorized() -> ApiError:
    """The single 401 every authentication failure produces (§3.3)."""
    return ApiError(401, ErrorCode.UNAUTHORIZED, "Not authenticated")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a bcrypt hash."""
    return bcrypt.checkpw(
        plain_password.encode("utf-8"),
        hashed_password.encode("utf-8"),
    )


def get_password_hash(password: str) -> str:
    """Hash a plain password with a fresh bcrypt salt."""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token.

    Args:
        data: Claims to encode; callers pass ``{"sub": str(user.id)}``.
        expires_delta: Lifetime; defaults to ``ACCESS_TOKEN_EXPIRE_MINUTES``.

    Returns:
        The encoded JWT.
    """
    to_encode = data.copy()
    now = datetime.now(UTC)
    expire = now + (
        expires_delta
        if expires_delta is not None
        else timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    to_encode.update({"exp": expire, "iat": now})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Decode and verify a JWT access token.

    Args:
        token: The encoded JWT.

    Returns:
        The decoded payload.

    Raises:
        JWTError: If the token is malformed, badly signed or expired.
    """
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the caller's ``User`` from the bearer token (§3.1).

    Usage in routes::

        @router.get("/protected")
        def protected_route(current_user: User = Depends(get_current_user)):
            return {"user_id": current_user.id}

    Args:
        credentials: Bearer credentials, ``None`` when the header is missing.
        db: Database session.

    Returns:
        The authenticated user.

    Raises:
        ApiError: 401 ``unauthorized`` when the header is missing, the token is
            invalid or expired, or the subject is not a real user.
    """
    if credentials is None or not credentials.credentials:
        raise _unauthorized()

    try:
        payload = decode_access_token(credentials.credentials)
    except JWTError as exc:
        raise _unauthorized() from exc

    subject = payload.get("sub")
    if not subject:
        raise _unauthorized()

    try:
        user_id = uuid.UUID(str(subject))
    except ValueError as exc:
        raise _unauthorized() from exc

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise _unauthorized()

    return user


def authenticate_user(db: Session, email: str, password: str) -> Optional[User]:
    """Return the user matching ``email`` / ``password``, or ``None``.

    The caller turns ``None`` into the single 401 ``invalid_credentials`` body
    that §5.2 requires for both a wrong password and an unknown address.
    """
    user = db.query(User).filter(User.email == email).first()
    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user
