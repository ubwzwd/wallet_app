"""Tests for hashing, tokens and ``get_current_user`` (03-backend-api.md §3.1).

The 401 shape is the point: with ``HTTPBearer(auto_error=True)`` a missing
header used to come back as ``403 {"detail": "Not authenticated"}``, which the
target design replaces with ``401 code=unauthorized`` in every failure mode.
"""
import uuid
from datetime import timedelta

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.errors import install_error_handlers
from app.core.security import (
    authenticate_user,
    create_access_token,
    decode_access_token,
    get_current_user,
    get_password_hash,
    verify_password,
)
from app.models.user import User


@pytest.fixture()
def auth_client(db):
    """An app whose single route needs an authenticated user."""
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/protected")
    def protected(current_user: User = Depends(get_current_user)):
        return {"user_id": str(current_user.id), "email": current_user.email}

    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------


def test_password_hash_round_trip():
    hashed = get_password_hash("correct horse battery")

    assert hashed != "correct horse battery"
    assert verify_password("correct horse battery", hashed) is True
    assert verify_password("correct horse batteri", hashed) is False


def test_each_hash_uses_its_own_salt():
    first = get_password_hash("same password")
    second = get_password_hash("same password")

    assert first != second
    assert verify_password("same password", first)
    assert verify_password("same password", second)


# ---------------------------------------------------------------------------
# Token issuing and decoding
# ---------------------------------------------------------------------------


def test_token_carries_the_subject_and_an_expiry():
    payload = decode_access_token(create_access_token({"sub": "abc"}))

    assert payload["sub"] == "abc"
    assert payload["exp"] > payload["iat"]


def test_decoding_an_expired_token_raises():
    from jose import JWTError

    token = create_access_token({"sub": "abc"}, expires_delta=timedelta(minutes=-5))

    with pytest.raises(JWTError):
        decode_access_token(token)


# ---------------------------------------------------------------------------
# get_current_user (§3.1, §3.3)
# ---------------------------------------------------------------------------


def test_a_valid_token_reaches_the_route(auth_client, user_factory, auth_headers):
    user = user_factory(email="known@example.test")

    response = auth_client.get("/protected", headers=auth_headers(user))

    assert response.status_code == 200
    assert response.json() == {"user_id": str(user.id), "email": "known@example.test"}


def test_a_missing_header_is_401_unauthorized_not_403(auth_client):
    """The whole reason for ``auto_error=False`` (§3.1)."""
    response = auth_client.get("/protected")

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated", "code": "unauthorized"}


@pytest.mark.parametrize(
    "header",
    [
        {"Authorization": "Bearer not-a-jwt"},
        {"Authorization": "Bearer "},
        {"Authorization": "Basic dXNlcjpwYXNz"},
        {"Authorization": "some-token"},
    ],
)
def test_a_broken_authorization_header_is_401(auth_client, header):
    response = auth_client.get("/protected", headers=header)

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


def test_a_token_signed_with_another_key_is_401(auth_client, user_factory):
    from jose import jwt

    user = user_factory()
    forged = jwt.encode({"sub": str(user.id)}, "someone-elses-secret", algorithm="HS256")

    response = auth_client.get("/protected", headers={"Authorization": f"Bearer {forged}"})

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


def test_an_expired_token_is_401(auth_client, user_factory):
    user = user_factory()
    token = create_access_token({"sub": str(user.id)}, expires_delta=timedelta(minutes=-1))

    response = auth_client.get("/protected", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


def test_a_token_for_a_deleted_user_is_401(auth_client):
    token = create_access_token({"sub": str(uuid.uuid4())})

    response = auth_client.get("/protected", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


@pytest.mark.parametrize("claims", [{}, {"sub": ""}, {"sub": "not-a-uuid"}])
def test_a_token_without_a_usable_subject_is_401(auth_client, claims):
    token = create_access_token(claims)

    response = auth_client.get("/protected", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


# ---------------------------------------------------------------------------
# authenticate_user (§5.2)
# ---------------------------------------------------------------------------


def test_authenticate_user_accepts_the_right_password(db, user_factory):
    user = user_factory(email="login@example.test", password="hunter2 hunter2")

    assert authenticate_user(db, "login@example.test", "hunter2 hunter2") is user


def test_authenticate_user_rejects_a_wrong_password(db, user_factory):
    user_factory(email="login@example.test", password="hunter2 hunter2")

    assert authenticate_user(db, "login@example.test", "hunter2 hunter3") is None


def test_authenticate_user_rejects_an_unknown_email(db, user_factory):
    user_factory(email="login@example.test")

    assert authenticate_user(db, "nobody@example.test", "hunter2 hunter2") is None
