"""Unit behaviour of ``app.services.session_service`` (decision §14.67).

Every case drives the functions directly against the in-memory database with an
injected ``now``, so the time-dependent branches (grace window, expiry,
pruning) are pinned to exact instants instead of to the wall clock.
"""
import hashlib
import threading
import time
import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core.clock import utcnow

from app.core.config import settings
from app.core.errors import ApiError, ErrorCode
from app.models.refresh_token import RefreshToken
from app.services import session_service
from app.services.session_service import REFRESH_REUSE_GRACE_SECONDS

T0 = datetime(2026, 11, 23, 12, 0, 0)


def _rows(db, user_id=None) -> list[RefreshToken]:
    db.expire_all()
    stmt = select(RefreshToken).order_by(RefreshToken.created_at, RefreshToken.id)
    if user_id is not None:
        stmt = stmt.where(RefreshToken.user_id == user_id)
    return list(db.execute(stmt).scalars())


def _row(db, token: str) -> RefreshToken:
    db.expire_all()
    return db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == session_service.hash_token(token))
    ).scalar_one()


def _assert_refresh_invalid(excinfo) -> None:
    assert excinfo.value.status_code == 401
    assert excinfo.value.code == ErrorCode.REFRESH_INVALID
    assert excinfo.value.detail == "Refresh token is invalid or expired"


# ---------------------------------------------------------------------------
# hash_token / issue
# ---------------------------------------------------------------------------


def test_hash_token_is_stable_lowercase_sha256_hex():
    token = "some-opaque-token"
    digest = session_service.hash_token(token)

    assert digest == hashlib.sha256(token.encode()).hexdigest()
    assert digest == session_service.hash_token(token)
    assert len(digest) == 64
    assert digest == digest.lower()
    assert session_service.hash_token("other") != digest


def test_issue_stores_only_the_hash_and_starts_a_family(db, user_factory):
    user = user_factory()

    token = session_service.issue(db, user.id, now=T0)

    [row] = _rows(db)
    assert row.user_id == user.id
    assert row.token_hash == session_service.hash_token(token)
    # The plain token appears in no column of the row.
    stored = [getattr(row, c.key) for c in RefreshToken.__table__.columns]
    assert token not in [str(value) for value in stored]
    assert row.family_id is not None
    assert row.created_at == T0
    assert row.expires_at == T0 + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    assert row.used_at is None and row.revoked_at is None
    # 48 random bytes, URL-safe base64: 64 characters, never repeated.
    assert len(token) == 64
    assert session_service.issue(db, user.id, now=T0) != token


def test_issue_without_family_starts_a_new_one_and_with_family_joins_it(db, user_factory):
    user = user_factory()
    first = session_service.issue(db, user.id, now=T0)
    second = session_service.issue(db, user.id, now=T0)
    family = _row(db, first).family_id

    third = session_service.issue(db, user.id, family_id=family, now=T0)

    assert _row(db, second).family_id != family
    assert _row(db, third).family_id == family


def test_issue_honours_the_configured_lifetime(db, user_factory, monkeypatch):
    monkeypatch.setattr(settings, "REFRESH_TOKEN_EXPIRE_DAYS", 7)
    user = user_factory()

    token = session_service.issue(db, user.id, now=T0)

    assert _row(db, token).expires_at == T0 + timedelta(days=7)


# ---------------------------------------------------------------------------
# rotate
# ---------------------------------------------------------------------------


def test_rotate_marks_the_row_used_and_adds_one_to_the_family(db, user_factory):
    user = user_factory()
    old = session_service.issue(db, user.id, now=T0)
    later = T0 + timedelta(days=10)

    user_id, new = session_service.rotate(db, old, now=later)

    assert user_id == user.id
    assert new != old
    old_row, new_row = _row(db, old), _row(db, new)
    assert old_row.used_at == later
    assert old_row.revoked_at is None
    assert new_row.family_id == old_row.family_id
    assert new_row.created_at == later
    # The idle window slides: 90 days from the rotation, not from the login.
    assert new_row.expires_at == later + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    assert new_row.used_at is None


@pytest.mark.parametrize("case", ["unknown", "revoked", "expired", "exactly_expired"])
def test_rotate_rejects_unknown_revoked_and_expired_tokens(db, user_factory, case):
    user = user_factory()
    token = session_service.issue(db, user.id, now=T0)
    now = T0 + timedelta(minutes=1)
    if case == "unknown":
        token = "not-a-token-anyone-was-given"
    elif case == "revoked":
        session_service.revoke_all_for_user(db, user.id, now=T0)
    elif case == "expired":
        now = T0 + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS, seconds=1)
    else:
        now = T0 + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    before = len(_rows(db))

    with pytest.raises(ApiError) as excinfo:
        session_service.rotate(db, token, now=now)

    _assert_refresh_invalid(excinfo)
    assert len(_rows(db)) == before


def test_rotate_within_grace_issues_again_without_revoking(db, user_factory):
    user = user_factory()
    old = session_service.issue(db, user.id, now=T0)
    first_use = T0 + timedelta(minutes=5)
    _, first = session_service.rotate(db, old, now=first_use)

    again = first_use + timedelta(seconds=REFRESH_REUSE_GRACE_SECONDS)
    user_id, second = session_service.rotate(db, old, now=again)

    assert user_id == user.id
    assert second not in (old, first)
    rows = _rows(db)
    assert len(rows) == 3
    assert {r.family_id for r in rows} == {_row(db, old).family_id}
    assert all(r.revoked_at is None for r in rows)
    # used_at keeps the first rotation's time, so the window never stretches.
    assert _row(db, old).used_at == first_use


def test_rotate_replay_after_grace_revokes_the_family_and_commits(
    db, user_factory, fresh_session
):
    user = user_factory()
    other_family = session_service.issue(db, user.id, now=T0)
    old = session_service.issue(db, user.id, now=T0)
    first_use = T0 + timedelta(minutes=5)
    _, newest = session_service.rotate(db, old, now=first_use)
    replay = first_use + timedelta(seconds=REFRESH_REUSE_GRACE_SECONDS + 1)

    with pytest.raises(ApiError) as excinfo:
        session_service.rotate(db, old, now=replay)

    _assert_refresh_invalid(excinfo)
    # The revocation is committed, not merely flushed: a rollback keeps it, and
    # a separate session sees it.
    db.rollback()
    family = _row(db, old).family_id
    seen = fresh_session().execute(select(RefreshToken)).scalars().all()
    by_family = {r.token_hash: r for r in seen}
    for token in (old, newest):
        assert by_family[session_service.hash_token(token)].revoked_at == replay
    assert by_family[session_service.hash_token(other_family)].revoked_at is None
    assert {r.family_id for r in seen if r.revoked_at is not None} == {family}

    # ... and the newest token of that family is now dead too.
    with pytest.raises(ApiError) as excinfo:
        session_service.rotate(db, newest, now=replay)
    _assert_refresh_invalid(excinfo)


def test_rotate_replay_keeps_the_first_revocation_time(db, user_factory):
    user = user_factory()
    old = session_service.issue(db, user.id, now=T0)
    _, newest = session_service.rotate(db, old, now=T0)
    session_service.revoke_family_of(db, newest, now=T0 + timedelta(minutes=1))

    with pytest.raises(ApiError):
        session_service.rotate(db, old, now=T0 + timedelta(hours=1))

    # Already revoked rows stop at (b): nothing is re-stamped.
    assert {r.revoked_at for r in _rows(db)} == {T0 + timedelta(minutes=1)}


# ---------------------------------------------------------------------------
# revoke_family_of / revoke_all_for_user
# ---------------------------------------------------------------------------


def test_revoke_family_of_revokes_only_that_family(db, user_factory):
    user = user_factory()
    keep = session_service.issue(db, user.id, now=T0)
    gone = session_service.issue(db, user.id, now=T0)
    _, gone_newer = session_service.rotate(db, gone, now=T0)
    at = T0 + timedelta(minutes=1)

    assert session_service.revoke_family_of(db, gone_newer, now=at) == 2

    assert _row(db, gone).revoked_at == at
    assert _row(db, gone_newer).revoked_at == at
    assert _row(db, keep).revoked_at is None
    # A second call finds nothing left to revoke and changes nothing.
    assert session_service.revoke_family_of(db, gone, now=at + timedelta(hours=1)) == 0
    assert _row(db, gone).revoked_at == at


def test_revoke_family_of_an_unknown_token_is_a_quiet_zero(db, user_factory):
    user = user_factory()
    token = session_service.issue(db, user.id, now=T0)

    assert session_service.revoke_family_of(db, "never-issued", now=T0) == 0
    assert _row(db, token).revoked_at is None


def test_revoke_all_for_user_spares_other_users_and_revoked_rows(db, user_factory):
    alice, bob = user_factory(), user_factory()
    a1 = session_service.issue(db, alice.id, now=T0)
    a2 = session_service.issue(db, alice.id, now=T0)
    b1 = session_service.issue(db, bob.id, now=T0)
    early = T0 + timedelta(minutes=1)
    session_service.revoke_family_of(db, a1, now=early)

    assert session_service.revoke_all_for_user(db, alice.id, now=T0 + timedelta(hours=1)) == 1

    assert _row(db, a1).revoked_at == early
    assert _row(db, a2).revoked_at == T0 + timedelta(hours=1)
    assert _row(db, b1).revoked_at is None
    assert session_service.revoke_all_for_user(db, uuid.uuid4(), now=T0) == 0


# ---------------------------------------------------------------------------
# prune
# ---------------------------------------------------------------------------


def _set(db, token: str, **values) -> None:
    row = _row(db, token)
    for key, value in values.items():
        setattr(row, key, value)
    db.flush()


def test_prune_deletes_dead_rows_of_one_user_only(db, user_factory):
    alice, bob = user_factory(), user_factory()
    now = T0 + timedelta(days=200)
    day = timedelta(days=1)
    tokens = {
        name: session_service.issue(db, alice.id, now=now - timedelta(days=10))
        for name in (
            "live",
            "expired",
            "used_long_ago",
            "used_recently",
            "revoked_long_ago",
            "revoked_recently",
        )
    }
    _set(db, tokens["expired"], created_at=now - timedelta(days=100), expires_at=now - day)
    _set(db, tokens["used_long_ago"], used_at=now - day - timedelta(seconds=1))
    _set(db, tokens["used_recently"], used_at=now - day)
    _set(db, tokens["revoked_long_ago"], revoked_at=now - day - timedelta(seconds=1))
    _set(db, tokens["revoked_recently"], revoked_at=now - timedelta(hours=1))
    bob_dead = session_service.issue(db, bob.id, now=T0)
    _set(db, bob_dead, revoked_at=T0)

    assert session_service.prune(db, alice.id, now=now) == 3

    left = {r.token_hash for r in _rows(db, alice.id)}
    assert left == {
        session_service.hash_token(tokens[name])
        for name in ("live", "used_recently", "revoked_recently")
    }
    # Bob's long-dead row is not alice's to clean up.
    assert len(_rows(db, bob.id)) == 1


def test_prune_with_nothing_dead_deletes_nothing(db, user_factory):
    user = user_factory()
    session_service.issue(db, user.id, now=T0)

    assert session_service.prune(db, user.id, now=T0 + timedelta(days=1)) == 0
    assert len(_rows(db)) == 1


# ---------------------------------------------------------------------------
# Revocation racing an in-flight rotation (Postgres, READ COMMITTED)
# ---------------------------------------------------------------------------


def _revoke_all(b, user_id, *, token, newest):
    session_service.revoke_all_for_user(b, user_id)


def _revoke_family(b, user_id, *, token, newest):
    session_service.revoke_family_of(b, token)


def _replay(b, user_id, *, token, newest):
    # ``token`` was rotated long ago: presenting it again is a replay, which
    # revokes the family (and commits) before raising.
    with pytest.raises(ApiError) as excinfo:
        session_service.rotate(
            b, token, now=utcnow() + timedelta(seconds=REFRESH_REUSE_GRACE_SECONDS + 60)
        )
    _assert_refresh_invalid(excinfo)


@pytest.mark.postgres
@pytest.mark.parametrize(
    "revoke",
    [_revoke_all, _revoke_family, _replay],
    ids=["revoke_all_for_user", "revoke_family_of", "replay"],
)
def test_revocation_catches_the_row_a_concurrent_rotate_inserts(migrated_db, revoke):
    """A revocation that waited on a rotate's row lock still revokes its child.

    Session A rotates the family's newest token and holds its transaction open;
    session B revokes meanwhile and has to wait on A's row lock. Once A
    commits, the child A inserted must end up revoked as well: a single UPDATE
    cannot see it, which would leave a working session behind.
    """
    from app.core.security import get_password_hash
    from app.models import Base
    from app.models.user import User

    engine = create_engine(migrated_db)
    try:
        Base.metadata.create_all(engine)
        make = sessionmaker(bind=engine, autoflush=False)

        with make() as setup:
            now = utcnow()
            user = User(
                email="race@example.test",
                password_hash=get_password_hash("correct horse battery"),
                base_currency="CNY",
                language="zh",
                created_at=now,
                updated_at=now,
            )
            setup.add(user)
            setup.flush()
            user_id = user.id
            # ``old`` was rotated well outside the grace window; ``newest`` is
            # the family's live token, which A is about to rotate.
            old = session_service.issue(setup, user_id, now=now - timedelta(hours=1))
            _, newest = session_service.rotate(setup, old, now=now - timedelta(hours=1))
            setup.commit()

        a = make()
        b = make()
        try:
            _, child = session_service.rotate(a, newest)  # holds newest FOR UPDATE

            errors: list[BaseException] = []

            def run_b() -> None:
                try:
                    revoke(b, user_id, token=old, newest=newest)
                    b.commit()
                except BaseException as exc:  # surfaced in the main thread
                    errors.append(exc)
                    b.rollback()

            thread = threading.Thread(target=run_b)
            thread.start()
            time.sleep(0.5)
            assert thread.is_alive(), "B should be waiting on A's row lock"

            a.commit()
            thread.join(timeout=10)
            assert not thread.is_alive()
            assert not errors, errors
        finally:
            a.close()
            b.close()

        with make() as check:
            rows = check.execute(select(RefreshToken)).scalars().all()
            assert len(rows) == 3
            assert all(r.revoked_at is not None for r in rows)
            with pytest.raises(ApiError) as excinfo:
                session_service.rotate(check, child)
            _assert_refresh_invalid(excinfo)
    finally:
        engine.dispose()
