"""Administrator password reset (decision §9, §14.67).

Usage, from ``backend/`` (or ``/app`` inside the api image)::

    python scripts/reset_password.py <email>
    python scripts/reset_password.py <email> --password-stdin < password.txt

The new password is read with ``getpass`` (twice) unless ``--password-stdin``
is given. It is validated like a registration password, the user's
``password_hash`` and ``updated_at`` are replaced, and every refresh token of
the user is revoked, all in one transaction. The password is never printed.
"""
import argparse
import getpass
import pathlib
import sys

# ``python scripts/reset_password.py`` puts ``scripts/`` on sys.path, not the
# directory that holds the ``app`` package; add it so no PYTHONPATH is needed.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from sqlalchemy.orm import Session  # noqa: E402

from app.core.clock import utcnow  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.security import get_password_hash  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.session_service import revoke_all_for_user  # noqa: E402

MIN_PASSWORD_CHARS = 8
MAX_PASSWORD_BYTES = 72  # bcrypt's limit, same as registration (§5.1)


class UserNotFound(Exception):
    """No user has the given email address."""


def validate_password(password: str) -> None:
    """Raise ``ValueError`` unless ``password`` would be accepted at registration.

    The messages describe the rule only; they never contain the password.
    """
    if len(password) < MIN_PASSWORD_CHARS:
        raise ValueError(f"password must be at least {MIN_PASSWORD_CHARS} characters")
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValueError(f"password must be at most {MAX_PASSWORD_BYTES} bytes when UTF-8 encoded")


def reset_password(db: Session, email: str, new_password: str) -> int:
    """Set ``new_password`` for the user with ``email`` and end all their sessions.

    Returns how many refresh tokens were revoked. Raises ``ValueError`` for a
    password that breaks the registration rules and :class:`UserNotFound` for an
    unknown address; in both cases nothing has been written. The hash, the
    ``updated_at`` stamp and the revocations are committed together, and rolled
    back if anything fails on the way.
    """
    validate_password(new_password)
    user = db.query(User).filter(User.email == email.strip().lower()).first()
    if user is None:
        raise UserNotFound(email)
    try:
        now = utcnow()
        user.password_hash = get_password_hash(new_password)
        user.updated_at = now
        revoked = revoke_all_for_user(db, user.id, now=now)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return revoked


def _read_password(from_stdin: bool) -> str:
    if from_stdin:
        return sys.stdin.readline().rstrip("\r\n")
    first = getpass.getpass("New password: ")
    if getpass.getpass("Repeat new password: ") != first:
        raise ValueError("passwords do not match")
    return first


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Reset a user's password and revoke all of their sessions."
    )
    parser.add_argument("email", help="email address of the account")
    parser.add_argument(
        "--password-stdin",
        action="store_true",
        help="read the new password from the first line of standard input",
    )
    args = parser.parse_args(argv)
    email = args.email.strip().lower()

    try:
        password = _read_password(args.password_stdin)
        validate_password(password)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        revoked = reset_password(db, email, password)
    except UserNotFound:
        print(f"no user with email {email}", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()
    print(f"password reset for {email}; {revoked} session(s) revoked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
