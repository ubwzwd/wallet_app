"""Registration and login through HTTP (03-backend-api.md §5.1-§5.2, §10.2).

Every case goes through the real app with the in-memory database, so the "one
transaction writes three tables" promise of §5.1 is checked by reading the
tables back rather than by trusting the 201.
"""
import uuid

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.security import decode_access_token
from app.models.ledger import Ledger, LedgerMember
from app.models.user import User

REGISTER_URL = "/api/v1/auth/register"
LOGIN_URL = "/api/v1/auth/login"

PASSWORD = "correct horse battery"


def register_body(email: str = "alice@example.com", **overrides) -> dict:
    """A valid §5.1 body, with room to break exactly one field per case."""
    body = {
        "email": email,
        "password": PASSWORD,
        "base_currency": "cny",
        "language": "zh",
    }
    body.update(overrides)
    return body


def unique_email() -> str:
    return f"user-{uuid.uuid4().hex[:10]}@example.com"


# ---------------------------------------------------------------------------
# §5.1 POST /auth/register
# ---------------------------------------------------------------------------


def test_register_creates_user_default_ledger_and_owner_membership(client, db):
    response = client.post(REGISTER_URL, json=register_body(base_currency="cny"))

    assert response.status_code == 201
    payload = response.json()
    assert payload["token_type"] == "bearer"

    user = db.execute(select(User).where(User.email == "alice@example.com")).scalar_one()
    # The token names the account it just created.
    assert decode_access_token(payload["access_token"])["sub"] == str(user.id)
    # display_name starts empty; the currency is stored upper-cased (§4.5).
    assert user.display_name is None
    assert user.base_currency == "CNY"
    assert user.language == "zh"
    assert user.password_hash != PASSWORD

    ledger = db.execute(select(Ledger).where(Ledger.created_by == user.id)).scalar_one()
    assert ledger.name == "我的账本"
    assert ledger.base_currency == "CNY"

    membership = db.execute(
        select(LedgerMember).where(LedgerMember.user_id == user.id)
    ).scalar_one()
    assert membership.ledger_id == ledger.id
    assert membership.role == "owner"


def test_register_stores_the_email_lower_cased_and_rejects_a_second_one(client, db):
    assert client.post(REGISTER_URL, json=register_body("Alice@Example.COM")).status_code == 201
    assert db.execute(select(User.email)).scalar_one() == "alice@example.com"

    response = client.post(REGISTER_URL, json=register_body("alice@example.com"))

    assert response.status_code == 409
    assert response.json()["code"] == "email_exists"
    # The rejected attempt wrote nothing.
    assert len(db.execute(select(User)).scalars().all()) == 1
    assert len(db.execute(select(Ledger)).scalars().all()) == 1


def test_register_is_refused_while_registration_is_closed(client, db, monkeypatch):
    monkeypatch.setattr(settings, "REGISTRATION_OPEN", False)

    response = client.post(REGISTER_URL, json=register_body())

    assert response.status_code == 403
    assert response.json() == {
        "detail": "Registration is currently closed",
        "code": "registration_closed",
    }
    assert db.execute(select(User)).scalars().all() == []


@pytest.mark.parametrize(
    ("label", "password"),
    [
        ("seven bytes", "1234567"),
        # 73 bytes of UTF-8 must be a 422, never the 500 bcrypt used to raise.
        ("seventy three bytes", "a" * 73),
        ("seventy three bytes of multibyte text", "好" * 24 + "a"),
    ],
)
def test_register_rejects_passwords_outside_the_byte_range(client, db, label, password):
    response = client.post(REGISTER_URL, json=register_body(password=password))

    assert response.status_code == 422, label
    assert response.json()["code"] == "validation_error"
    assert db.execute(select(User)).scalars().all() == []


def test_register_accepts_exactly_seventy_two_bytes(client):
    response = client.post(REGISTER_URL, json=register_body(password="好" * 24))

    assert response.status_code == 201


def test_sixth_registration_from_one_ip_is_rate_limited(client, db):
    for _ in range(settings.RATE_LIMIT_REGISTER_PER_HOUR):
        assert client.post(REGISTER_URL, json=register_body(unique_email())).status_code == 201

    response = client.post(REGISTER_URL, json=register_body(unique_email()))

    assert response.status_code == 429
    assert response.json()["code"] == "register_rate_limited"
    # Retry-After is whole seconds until the next token of an hourly bucket.
    assert int(response.headers["Retry-After"]) > 0
    users = db.execute(select(User)).scalars().all()
    assert len(users) == settings.RATE_LIMIT_REGISTER_PER_HOUR


# ---------------------------------------------------------------------------
# §5.2 POST /auth/login
# ---------------------------------------------------------------------------


def test_login_issues_a_token_for_the_right_password(client, user_factory):
    user = user_factory(email="alice@example.com", password=PASSWORD)

    response = client.post(LOGIN_URL, json={"email": "alice@example.com", "password": PASSWORD})

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert decode_access_token(body["access_token"])["sub"] == str(user.id)


def test_login_accepts_a_differently_cased_email(client, user_factory):
    user_factory(email="alice@example.com", password=PASSWORD)

    response = client.post(LOGIN_URL, json={"email": "Alice@Example.com", "password": PASSWORD})

    assert response.status_code == 200


def test_wrong_password_and_unknown_email_answer_identically(client, user_factory):
    user_factory(email="alice@example.com", password=PASSWORD)

    wrong_password = client.post(
        LOGIN_URL, json={"email": "alice@example.com", "password": "not the password"}
    )
    unknown_email = client.post(
        LOGIN_URL, json={"email": "nobody@example.com", "password": PASSWORD}
    )

    assert wrong_password.status_code == unknown_email.status_code == 401
    # Byte for byte the same body: the endpoint cannot enumerate accounts.
    assert wrong_password.json() == unknown_email.json()
    assert wrong_password.json()["code"] == "invalid_credentials"


def test_eleventh_login_attempt_from_one_ip_is_rate_limited(client):
    attempt = {"email": "nobody@example.com", "password": PASSWORD}
    for _ in range(settings.RATE_LIMIT_LOGIN_PER_MINUTE):
        assert client.post(LOGIN_URL, json=attempt).status_code == 401

    response = client.post(LOGIN_URL, json=attempt)

    assert response.status_code == 429
    assert response.json()["code"] == "login_rate_limited"
    assert int(response.headers["Retry-After"]) > 0


def test_a_successful_login_clears_the_counter(client, user_factory):
    user_factory(email="alice@example.com", password=PASSWORD)
    failure = {"email": "alice@example.com", "password": "not the password"}

    # Spend all but one of the bucket's tokens.
    for _ in range(settings.RATE_LIMIT_LOGIN_PER_MINUTE - 1):
        assert client.post(LOGIN_URL, json=failure).status_code == 401

    success = client.post(LOGIN_URL, json={"email": "alice@example.com", "password": PASSWORD})
    assert success.status_code == 200

    # The bucket is full again, so a whole fresh run of attempts fits.
    for _ in range(settings.RATE_LIMIT_LOGIN_PER_MINUTE):
        assert client.post(LOGIN_URL, json=failure).status_code == 401
    assert client.post(LOGIN_URL, json=failure).status_code == 429
