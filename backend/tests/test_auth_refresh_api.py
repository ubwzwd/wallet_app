"""Refresh, logout and logout-all through HTTP (decision §14.67).

Every case runs on the real app and the in-memory database. Time-dependent
branches are reached by moving the stored timestamps back (``_age``) rather
than by sleeping, and every check that matters reads the table back.
"""
from datetime import timedelta

import pytest
from sqlalchemy import func, select, update

from app.core.clock import utcnow
from app.core.config import settings
from app.core.security import decode_access_token
from app.models.refresh_token import RefreshToken
from app.services.session_service import REFRESH_REUSE_GRACE_SECONDS, hash_token

REGISTER_URL = "/api/v1/auth/register"
LOGIN_URL = "/api/v1/auth/login"
REFRESH_URL = "/api/v1/auth/refresh"
LOGOUT_URL = "/api/v1/auth/logout"
LOGOUT_ALL_URL = "/api/v1/auth/logout-all"
ME_URL = "/api/v1/me"

PASSWORD = "correct horse battery"
INVALID = {"detail": "Refresh token is invalid or expired", "code": "refresh_invalid"}


def _login(client, email: str) -> dict:
    response = client.post(LOGIN_URL, json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return response.json()


def _refresh(client, token: str):
    return client.post(REFRESH_URL, json={"refresh_token": token})


def _row(db, token: str) -> RefreshToken | None:
    db.expire_all()
    return db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(token))
    ).scalar_one_or_none()


def _family(db, token: str) -> list[RefreshToken]:
    family_id = _row(db, token).family_id
    return list(
        db.execute(select(RefreshToken).where(RefreshToken.family_id == family_id)).scalars()
    )


def _age(db, token: str, **deltas: timedelta) -> None:
    """Move the named timestamps of ``token``'s row back by the given amounts."""
    row = _row(db, token)
    values = {name: getattr(row, name) - delta for name, delta in deltas.items()}
    db.execute(update(RefreshToken).where(RefreshToken.id == row.id).values(**values))
    db.commit()


def _bearer(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


@pytest.fixture()
def alice(user_factory):
    return user_factory(email="alice@example.com", password=PASSWORD)


# ---------------------------------------------------------------------------
# login / register hand out a refresh token
# ---------------------------------------------------------------------------


def test_login_returns_a_refresh_token_stored_only_as_its_hash(client, db, alice):
    body = _login(client, "alice@example.com")

    assert body["expires_in"] == settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    assert body["refresh_token"] and body["refresh_token"] != body["access_token"]
    row = _row(db, body["refresh_token"])
    assert row.user_id == alice.id
    assert row.token_hash == hash_token(body["refresh_token"])
    stored = db.execute(select(RefreshToken.token_hash)).scalars().all()
    assert body["refresh_token"] not in stored


def test_register_returns_a_refresh_token_that_works(client, db):
    response = client.post(
        REGISTER_URL,
        json={"email": "new@example.com", "password": PASSWORD, "base_currency": "SGD"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["expires_in"] == settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    assert _refresh(client, body["refresh_token"]).status_code == 200


def test_each_login_starts_its_own_family(client, db, alice):
    first = _login(client, "alice@example.com")["refresh_token"]
    second = _login(client, "alice@example.com")["refresh_token"]

    assert _row(db, first).family_id != _row(db, second).family_id


# ---------------------------------------------------------------------------
# POST /auth/refresh — success paths
# ---------------------------------------------------------------------------


def test_refresh_rotates_within_the_family_and_slides_the_expiry(client, db, alice):
    old = _login(client, "alice@example.com")["refresh_token"]
    # Pretend the login was 10 days ago, so the slide is visible.
    _age(db, old, created_at=timedelta(days=10), expires_at=timedelta(days=10))
    old_expiry = _row(db, old).expires_at

    response = _refresh(client, old)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"access_token", "token_type", "refresh_token", "expires_in"}
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    assert body["refresh_token"] != old
    assert decode_access_token(body["access_token"])["sub"] == str(alice.id)

    old_row, new_row = _row(db, old), _row(db, body["refresh_token"])
    assert old_row.used_at is not None
    assert old_row.revoked_at is None
    assert new_row.family_id == old_row.family_id
    assert new_row.used_at is None and new_row.revoked_at is None
    assert new_row.expires_at > old_expiry
    assert new_row.expires_at - new_row.created_at == timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )


def test_the_refreshed_access_token_works_on_me(client, alice):
    old = _login(client, "alice@example.com")["refresh_token"]
    access = _refresh(client, old).json()["access_token"]

    response = client.get(ME_URL, headers=_bearer(access))

    assert response.status_code == 200
    assert response.json()["email"] == "alice@example.com"


def test_refresh_needs_no_authorization_header_and_ignores_a_bad_one(client, alice):
    token = _login(client, "alice@example.com")["refresh_token"]

    response = client.post(
        REFRESH_URL, json={"refresh_token": token}, headers=_bearer("not-a-jwt")
    )

    assert response.status_code == 200


def test_the_new_token_can_be_refreshed_in_turn(client, db, alice):
    token = _login(client, "alice@example.com")["refresh_token"]
    for _ in range(3):
        response = _refresh(client, token)
        assert response.status_code == 200
        token = response.json()["refresh_token"]

    assert len({r.family_id for r in _family(db, token)}) == 1


def test_reuse_within_the_grace_window_is_benign(client, db, alice):
    old = _login(client, "alice@example.com")["refresh_token"]
    first = _refresh(client, old).json()["refresh_token"]
    first_used_at = _row(db, old).used_at

    second = _refresh(client, old)

    assert second.status_code == 200
    assert second.json()["refresh_token"] not in (old, first)
    family = _family(db, old)
    assert len(family) == 3
    assert all(r.revoked_at is None for r in family)
    assert _row(db, old).used_at == first_used_at
    # Both tabs' tokens keep working.
    assert _refresh(client, first).status_code == 200
    assert _refresh(client, second.json()["refresh_token"]).status_code == 200


# ---------------------------------------------------------------------------
# POST /auth/refresh — the four failures
# ---------------------------------------------------------------------------


def test_replay_after_the_grace_window_revokes_the_whole_family(client, db, alice):
    other = _login(client, "alice@example.com")["refresh_token"]
    old = _login(client, "alice@example.com")["refresh_token"]
    newest = _refresh(client, old).json()["refresh_token"]
    _age(db, old, used_at=timedelta(seconds=REFRESH_REUSE_GRACE_SECONDS + 1))

    response = _refresh(client, old)

    assert response.status_code == 401
    assert response.json() == INVALID
    # Committed before the 401: a rollback of the request session keeps it.
    db.rollback()
    family = _family(db, old)
    assert len(family) == 2
    assert all(r.revoked_at is not None for r in family)
    assert _row(db, other).revoked_at is None
    # The thief's or the owner's newest token is dead as well ...
    assert _refresh(client, newest).json() == INVALID
    # ... while the other sign-in is untouched.
    assert _refresh(client, other).status_code == 200


def test_an_expired_token_is_refused(client, db, alice):
    token = _login(client, "alice@example.com")["refresh_token"]
    days = timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    _age(db, token, created_at=days + timedelta(seconds=1), expires_at=days + timedelta(seconds=1))

    response = _refresh(client, token)

    assert response.status_code == 401
    assert response.json() == INVALID
    assert db.execute(select(func.count()).select_from(RefreshToken)).scalar_one() == 1


def test_an_unknown_token_is_refused(client, db, alice):
    _login(client, "alice@example.com")

    response = _refresh(client, "x" * 64)

    assert response.status_code == 401
    assert response.json() == INVALID


def test_a_revoked_token_is_refused(client, db, alice):
    token = _login(client, "alice@example.com")["refresh_token"]
    assert client.post(LOGOUT_URL, json={"refresh_token": token}).status_code == 204

    response = _refresh(client, token)

    assert response.status_code == 401
    assert response.json() == INVALID


def test_the_four_failures_are_byte_for_byte_identical(client, db, alice):
    unknown = _refresh(client, "never-issued")

    revoked = _login(client, "alice@example.com")["refresh_token"]
    client.post(LOGOUT_URL, json={"refresh_token": revoked})
    revoked_response = _refresh(client, revoked)

    expired = _login(client, "alice@example.com")["refresh_token"]
    _age(db, expired, created_at=timedelta(days=100), expires_at=timedelta(days=100))
    expired_response = _refresh(client, expired)

    replayed = _login(client, "alice@example.com")["refresh_token"]
    _refresh(client, replayed)
    _age(db, replayed, used_at=timedelta(minutes=5))
    replayed_response = _refresh(client, replayed)

    responses = [unknown, revoked_response, expired_response, replayed_response]
    assert {r.status_code for r in responses} == {401}
    assert {r.content for r in responses} == {unknown.content}
    assert unknown.json() == INVALID
    # The token itself never comes back in the body.
    for token, response in zip(
        ("never-issued", revoked, expired, replayed), responses, strict=True
    ):
        assert token not in response.text


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"refresh_token": ""},
        {"refresh_token": "x" * 513},
        {"refresh_token": "abc", "extra": 1},
        {"token": "abc"},
    ],
)
@pytest.mark.parametrize("url", [REFRESH_URL, LOGOUT_URL])
def test_malformed_bodies_are_422(client, url, body):
    response = client.post(url, json=body)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert isinstance(response.json()["detail"], str)


# ---------------------------------------------------------------------------
# pruning on refresh and on login
# ---------------------------------------------------------------------------


def _dead_rows_for(client, db, email: str) -> dict[str, str]:
    """Four of ``email``'s sign-ins, three of them aged into prunable rows."""
    names = ("expired", "used_long_ago", "revoked_long_ago", "revoked_recently")
    tokens = {name: _login(client, email)["refresh_token"] for name in names}
    _age(db, tokens["expired"], created_at=timedelta(days=91), expires_at=timedelta(days=91))
    now = utcnow()
    for name, values in (
        ("used_long_ago", {"used_at": now - timedelta(days=1, minutes=1)}),
        ("revoked_long_ago", {"revoked_at": now - timedelta(days=2)}),
        ("revoked_recently", {"revoked_at": now - timedelta(hours=1)}),
    ):
        db.execute(
            update(RefreshToken)
            .where(RefreshToken.token_hash == hash_token(tokens[name]))
            .values(**values)
        )
    db.commit()
    return tokens


def test_refresh_prunes_this_users_dead_rows_and_nobody_elses(client, db, alice, user_factory):
    user_factory(email="bob@example.com", password=PASSWORD)
    alice_dead = _dead_rows_for(client, db, "alice@example.com")
    bob_dead = _dead_rows_for(client, db, "bob@example.com")
    live = _login(client, "alice@example.com")["refresh_token"]
    # The login above already pruned alice's three dead rows; put fresh ones back
    # so the refresh is what removes them this time.
    alice_dead = _dead_rows_for(client, db, "alice@example.com")

    response = _refresh(client, live)

    assert response.status_code == 200
    for name in ("expired", "used_long_ago", "revoked_long_ago"):
        assert _row(db, alice_dead[name]) is None, name
        assert _row(db, bob_dead[name]) is not None, name
    assert _row(db, alice_dead["revoked_recently"]) is not None
    # The row just rotated (used a moment ago) and its successor both stay.
    assert _row(db, live) is not None
    assert _row(db, response.json()["refresh_token"]) is not None


def test_login_prunes_this_users_dead_rows(client, db, alice):
    dead = _dead_rows_for(client, db, "alice@example.com")

    _login(client, "alice@example.com")

    for name in ("expired", "used_long_ago", "revoked_long_ago"):
        assert _row(db, dead[name]) is None, name
    assert _row(db, dead["revoked_recently"]) is not None


# ---------------------------------------------------------------------------
# POST /auth/logout
# ---------------------------------------------------------------------------


def test_logout_revokes_the_whole_family_and_is_idempotent(client, db, alice):
    old = _login(client, "alice@example.com")["refresh_token"]
    newest = _refresh(client, old).json()["refresh_token"]

    response = client.post(LOGOUT_URL, json={"refresh_token": newest})

    assert response.status_code == 204
    assert response.content == b""
    family = _family(db, old)
    assert len(family) == 2
    assert all(r.revoked_at is not None for r in family)
    first_revoked = {r.id: r.revoked_at for r in family}

    # Again, with an older token of the same family, and with nonsense.
    for token in (newest, old, "never-issued"):
        again = client.post(LOGOUT_URL, json={"refresh_token": token})
        assert again.status_code == 204
        assert again.content == b""
    assert {r.id: r.revoked_at for r in _family(db, old)} == first_revoked
    assert _refresh(client, newest).json() == INVALID


def test_logout_of_an_expired_token_is_a_quiet_204(client, db, alice):
    token = _login(client, "alice@example.com")["refresh_token"]
    _age(db, token, created_at=timedelta(days=100), expires_at=timedelta(days=100))

    assert client.post(LOGOUT_URL, json={"refresh_token": token}).status_code == 204


def test_logout_ends_only_its_own_sign_in(client, db, alice):
    phone = _login(client, "alice@example.com")["refresh_token"]
    laptop = _login(client, "alice@example.com")["refresh_token"]

    assert client.post(LOGOUT_URL, json={"refresh_token": phone}).status_code == 204

    assert _refresh(client, phone).status_code == 401
    assert _refresh(client, laptop).status_code == 200


def test_logout_needs_no_access_token(client, alice):
    token = _login(client, "alice@example.com")["refresh_token"]

    response = client.post(
        LOGOUT_URL, json={"refresh_token": token}, headers=_bearer("expired-or-garbage")
    )

    assert response.status_code == 204


# ---------------------------------------------------------------------------
# POST /auth/logout-all
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer not-a-jwt"}])
def test_logout_all_requires_an_access_token(client, db, alice, headers):
    token = _login(client, "alice@example.com")["refresh_token"]

    response = client.post(LOGOUT_ALL_URL, headers=headers)

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated", "code": "unauthorized"}
    assert _row(db, token).revoked_at is None


def test_logout_all_ends_every_sign_in_of_the_caller_only(client, db, alice, user_factory):
    user_factory(email="bob@example.com", password=PASSWORD)
    phone = _login(client, "alice@example.com")
    laptop_old = _login(client, "alice@example.com")["refresh_token"]
    laptop = _refresh(client, laptop_old).json()["refresh_token"]
    bob = _login(client, "bob@example.com")["refresh_token"]

    response = client.post(LOGOUT_ALL_URL, headers=_bearer(phone["access_token"]))

    assert response.status_code == 204
    assert response.content == b""
    db.expire_all()
    alice_rows = db.execute(
        select(RefreshToken).where(RefreshToken.user_id == alice.id)
    ).scalars().all()
    assert len(alice_rows) == 3
    assert all(r.revoked_at is not None for r in alice_rows)
    for token in (phone["refresh_token"], laptop):
        assert _refresh(client, token).json() == INVALID
    assert _row(db, bob).revoked_at is None
    assert _refresh(client, bob).status_code == 200
    # Documented residue: the access token stays valid for its remaining life.
    assert client.get(ME_URL, headers=_bearer(phone["access_token"])).status_code == 200
