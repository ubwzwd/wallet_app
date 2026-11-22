"""``scripts/reset_password.py``: administrator password reset (decision §9, §14.67)."""
import getpass
import io
import subprocess
import sys
from datetime import timedelta

import pytest

from app.core.clock import utcnow
from app.core.security import authenticate_user
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.services import session_service
from scripts import reset_password as script

OLD = "old password 123"
NEW = "brand new password"


def _tokens(db, user):
    return db.query(RefreshToken).filter(RefreshToken.user_id == user.id).all()


def _make_sessions(db, user, count):
    for _ in range(count):
        session_service.issue(db, user.id)
    db.flush()


# ---------------------------------------------------------------------------
# reset_password()
# ---------------------------------------------------------------------------


def test_new_password_works_and_old_one_does_not(db, user_factory):
    user = user_factory(password=OLD)
    before = utcnow() - timedelta(days=1)
    user.updated_at = before
    db.flush()

    script.reset_password(db, user.email, NEW)

    assert authenticate_user(db, user.email, NEW) is not None
    assert authenticate_user(db, user.email, OLD) is None
    db.refresh(user)
    assert user.updated_at > before


def test_revokes_every_token_of_the_user_and_returns_the_count(db, user_factory):
    user = user_factory(password=OLD)
    other = user_factory()
    _make_sessions(db, user, 3)
    _make_sessions(db, other, 2)
    # One of the user's rows is already revoked: it must not be counted again.
    first_revoked = utcnow() - timedelta(hours=2)
    _tokens(db, user)[0].revoked_at = first_revoked
    db.flush()

    revoked = script.reset_password(db, user.email, NEW)

    assert revoked == 2
    rows = _tokens(db, user)
    assert len(rows) == 3
    assert all(row.revoked_at is not None for row in rows)
    assert first_revoked in {row.revoked_at for row in rows}
    assert all(row.revoked_at is None for row in _tokens(db, other))


def test_other_users_password_is_untouched(db, user_factory):
    user = user_factory(password=OLD)
    other = user_factory(password="other password 1")

    script.reset_password(db, user.email, NEW)

    assert authenticate_user(db, other.email, "other password 1") is not None


def test_email_is_matched_case_insensitively_and_trimmed(db, user_factory):
    user_factory(email="mixed@example.test", password=OLD)

    script.reset_password(db, "  Mixed@Example.TEST ", NEW)

    assert authenticate_user(db, "mixed@example.test", NEW) is not None


def test_user_without_sessions_returns_zero(db, user_factory):
    user = user_factory(password=OLD)

    assert script.reset_password(db, user.email, NEW) == 0
    assert authenticate_user(db, user.email, NEW) is not None


def test_unknown_email_raises_user_not_found_and_changes_nothing(db, user_factory):
    user = user_factory(password=OLD)
    _make_sessions(db, user, 1)

    with pytest.raises(script.UserNotFound):
        script.reset_password(db, "nobody@example.test", NEW)

    assert authenticate_user(db, user.email, OLD) is not None
    assert all(row.revoked_at is None for row in _tokens(db, user))


@pytest.mark.parametrize(
    "bad",
    [
        "short",  # 5 characters
        "1234567",  # 7 characters
        "a" * 73,  # 73 bytes
        "密" * 25,  # 25 characters but 75 bytes
    ],
)
def test_invalid_password_raises_value_error_and_leaves_the_database_alone(db, user_factory, bad):
    user = user_factory(password=OLD)
    _make_sessions(db, user, 2)
    old_hash = user.password_hash
    old_updated = user.updated_at

    with pytest.raises(ValueError) as excinfo:
        script.reset_password(db, user.email, bad)

    assert bad not in str(excinfo.value)
    db.refresh(user)
    assert user.password_hash == old_hash
    assert user.updated_at == old_updated
    assert all(row.revoked_at is None for row in _tokens(db, user))


def test_boundary_passwords_are_accepted(db, user_factory):
    user = user_factory(password=OLD)

    script.reset_password(db, user.email, "12345678")
    assert authenticate_user(db, user.email, "12345678") is not None

    script.reset_password(db, user.email, "a" * 72)
    assert authenticate_user(db, user.email, "a" * 72) is not None

    script.reset_password(db, user.email, "密" * 24)  # 24 characters, exactly 72 bytes
    assert authenticate_user(db, user.email, "密" * 24) is not None


def test_failure_while_revoking_rolls_the_password_back(db, user_factory, monkeypatch):
    user = user_factory(password=OLD)
    _make_sessions(db, user, 1)
    db.commit()
    old_hash = user.password_hash

    def boom(*_args, **_kwargs):
        raise RuntimeError("database went away")

    monkeypatch.setattr(script, "revoke_all_for_user", boom)

    with pytest.raises(RuntimeError):
        script.reset_password(db, user.email, NEW)

    db.expire_all()
    reloaded = db.get(User, user.id)
    assert reloaded.password_hash == old_hash
    assert authenticate_user(db, user.email, OLD) is not None
    assert all(row.revoked_at is None for row in _tokens(db, user))


# ---------------------------------------------------------------------------
# main()
# ---------------------------------------------------------------------------


@pytest.fixture()
def use_test_session(db, monkeypatch):
    """Make ``main()`` open the test session instead of the production one."""
    monkeypatch.setattr(script, "SessionLocal", lambda: db)


def _stdin(monkeypatch, text):
    monkeypatch.setattr(sys, "stdin", io.StringIO(text))


def test_main_stdin_success(db, user_factory, use_test_session, monkeypatch, capsys):
    user = user_factory(email="admin-target@example.test", password=OLD)
    _make_sessions(db, user, 2)
    db.commit()
    _stdin(monkeypatch, NEW + "\nignored second line\n")

    code = script.main(["Admin-Target@example.test", "--password-stdin"])

    out = capsys.readouterr()
    assert code == 0
    assert out.out.strip() == "password reset for admin-target@example.test; 2 session(s) revoked"
    assert out.err == ""
    assert NEW not in out.out + out.err
    assert authenticate_user(db, "admin-target@example.test", NEW) is not None
    assert authenticate_user(db, "admin-target@example.test", OLD) is None


def test_main_unknown_email(db, use_test_session, monkeypatch, capsys):
    _stdin(monkeypatch, NEW + "\n")

    code = script.main(["ghost@example.test", "--password-stdin"])

    out = capsys.readouterr()
    assert code == 1
    assert out.out == ""
    assert "no user with email ghost@example.test" in out.err
    assert NEW not in out.out + out.err


def test_main_rejects_short_password_without_touching_the_database(
    db, user_factory, use_test_session, monkeypatch, capsys
):
    user = user_factory(password=OLD)
    db.commit()
    _stdin(monkeypatch, "short\n")

    code = script.main([user.email, "--password-stdin"])

    out = capsys.readouterr()
    assert code == 1
    assert out.out == ""
    assert "at least 8 characters" in out.err
    assert "short" not in out.err.replace("at least 8 characters", "")
    assert authenticate_user(db, user.email, OLD) is not None


def test_main_rejects_overlong_password(db, user_factory, use_test_session, monkeypatch, capsys):
    user = user_factory(password=OLD)
    db.commit()
    long_password = "密" * 25
    _stdin(monkeypatch, long_password + "\n")

    code = script.main([user.email, "--password-stdin"])

    out = capsys.readouterr()
    assert code == 1
    assert "72 bytes" in out.err
    assert long_password not in out.out + out.err
    assert authenticate_user(db, user.email, OLD) is not None


def test_main_empty_stdin_is_rejected(db, user_factory, use_test_session, monkeypatch):
    user = user_factory(password=OLD)
    db.commit()
    _stdin(monkeypatch, "")

    assert script.main([user.email, "--password-stdin"]) == 1
    assert authenticate_user(db, user.email, OLD) is not None


def test_main_interactive_success_asks_twice(db, user_factory, use_test_session, monkeypatch, capsys):
    email = user_factory(password=OLD).email
    db.commit()
    answers = iter([NEW, NEW])
    prompts = []

    def fake_getpass(prompt=""):
        prompts.append(prompt)
        return next(answers)

    monkeypatch.setattr(getpass, "getpass", fake_getpass)

    code = script.main([email])

    out = capsys.readouterr()
    assert code == 0
    assert len(prompts) == 2
    assert NEW not in out.out + out.err
    assert authenticate_user(db, email, NEW) is not None


def test_main_interactive_mismatch(db, user_factory, use_test_session, monkeypatch, capsys):
    user = user_factory(password=OLD)
    db.commit()
    answers = iter(["first password 1", "second password 2"])
    monkeypatch.setattr(getpass, "getpass", lambda prompt="": next(answers))

    code = script.main([user.email])

    out = capsys.readouterr()
    assert code == 1
    assert out.out == ""
    assert "do not match" in out.err
    assert "first password 1" not in out.err and "second password 2" not in out.err
    assert authenticate_user(db, user.email, OLD) is not None


def test_main_closes_the_session(db, monkeypatch):
    closed = []

    class Spy:
        def __init__(self, inner):
            self._inner = inner

        def __getattr__(self, name):
            return getattr(self._inner, name)

        def close(self):
            closed.append(True)

    monkeypatch.setattr(script, "SessionLocal", lambda: Spy(db))
    _stdin(monkeypatch, NEW + "\n")

    assert script.main(["nobody@example.test", "--password-stdin"]) == 1
    assert closed == [True]


# ---------------------------------------------------------------------------
# Running the file directly
# ---------------------------------------------------------------------------


def test_script_runs_from_backend_dir_without_pythonpath():
    from tests.conftest import BACKEND_DIR

    env = {
        "PATH": "/usr/bin:/bin",
        "DATABASE_URL": "sqlite:///:memory:",
        "SECRET_KEY": "test-secret-key-for-tests-only",
        "DEBUG": "false",
    }
    result = subprocess.run(
        [sys.executable, "scripts/reset_password.py", "--help"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )

    assert result.returncode == 0, result.stderr
    assert "--password-stdin" in result.stdout
