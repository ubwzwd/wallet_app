"""The profile endpoints (03-backend-api.md §5.3-§5.4, §10.2).

The ``auth`` router's old ``me`` aliases have to stay gone (decision §14.42),
so their absence is asserted here alongside the real endpoint's behaviour.
"""
import datetime as dt

import httpx
import pytest

ME_URL = "/api/v1/me"
AUTH_ME_URL = "/api/v1/auth/me"


@pytest.fixture()
def fx_down(monkeypatch):
    """Frankfurter answers 503, so the supported currency list is unknowable.

    ``PATCH /me`` then behaves like §5.9/§5.11: the currency already in effect
    still goes through, anything else is a 503 rather than an unverified code.
    """
    from app.services import fx

    monkeypatch.setattr(fx, "HTTP_RETRY_ATTEMPTS", 1)
    client = httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(503)),
        base_url="https://frankfurter.test/v1",
    )
    fx.reset_state()
    monkeypatch.setattr(fx, "client_factory", lambda: client)
    try:
        yield
    finally:
        client.close()
        fx.reset_state()


# ---------------------------------------------------------------------------
# §5.3 GET /me
# ---------------------------------------------------------------------------


def test_me_returns_the_profile_and_the_ledger_count(
    client, db, user_factory, auth_headers, ledger_factory
):
    user = user_factory(
        email="alice@example.com", base_currency="CNY", language="zh", display_name="Alice"
    )
    ledger_factory(user)
    ledger_factory(user, name="Travel")
    # A ledger somebody else owns must not be counted.
    ledger_factory(user_factory())
    db.commit()

    response = client.get(ME_URL, headers=auth_headers(user))

    assert response.status_code == 200
    assert response.json() == {
        "id": str(user.id),
        "email": "alice@example.com",
        "display_name": "Alice",
        "base_currency": "CNY",
        "language": "zh",
        "created_at": user.created_at.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z",
        "ledger_count": 2,
    }


def test_me_counts_joined_ledgers_too(client, db, user_factory, auth_headers, ledger_factory):
    owner = user_factory()
    joiner = user_factory()
    ledger_factory(owner, members=[joiner])
    db.commit()

    response = client.get(ME_URL, headers=auth_headers(joiner))

    assert response.status_code == 200
    assert response.json()["ledger_count"] == 1


def test_me_reports_an_empty_display_name_as_null(client, db, user_factory, auth_headers):
    user = user_factory(display_name=None)
    db.commit()

    body = client.get(ME_URL, headers=auth_headers(user)).json()

    # The server never substitutes the email prefix (§5.3).
    assert body["display_name"] is None
    assert body["ledger_count"] == 0


def test_me_without_a_token_is_401_unauthorized(client):
    response = client.get(ME_URL)

    # Not FastAPI's default 403 "Not authenticated" (§3.1).
    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


def test_me_with_a_broken_token_is_401(client):
    response = client.get(ME_URL, headers={"Authorization": "Bearer not-a-jwt"})

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


# ---------------------------------------------------------------------------
# §5.4 PATCH /me
# ---------------------------------------------------------------------------


def test_patch_me_changes_the_language(client, db, user_factory, auth_headers):
    user = user_factory(language="zh")
    db.commit()

    response = client.patch(ME_URL, json={"language": "en"}, headers=auth_headers(user))

    assert response.status_code == 200
    assert response.json()["language"] == "en"
    db.refresh(user)
    assert user.language == "en"


def test_patch_me_with_a_null_language_follows_the_system_again(
    client, db, user_factory, auth_headers
):
    user = user_factory(language="en")
    db.commit()

    response = client.patch(ME_URL, json={"language": None}, headers=auth_headers(user))

    assert response.status_code == 200
    assert response.json()["language"] is None
    db.refresh(user)
    assert user.language is None


def test_patch_me_sets_the_display_name(client, db, user_factory, auth_headers):
    user = user_factory(display_name=None)
    db.commit()

    response = client.patch(
        ME_URL, json={"display_name": "  Alice  "}, headers=auth_headers(user)
    )

    assert response.status_code == 200
    # strip() happens in the schema (§5.4).
    assert response.json()["display_name"] == "Alice"
    db.refresh(user)
    assert user.display_name == "Alice"


@pytest.mark.parametrize("value", [None, "", "   "])
def test_patch_me_clears_the_display_name(client, db, user_factory, auth_headers, value):
    user = user_factory(display_name="Alice")
    db.commit()

    response = client.patch(ME_URL, json={"display_name": value}, headers=auth_headers(user))

    assert response.status_code == 200
    assert response.json()["display_name"] is None
    db.refresh(user)
    assert user.display_name is None


def test_patch_me_rejects_a_display_name_over_forty_characters(
    client, db, user_factory, auth_headers
):
    user = user_factory(display_name="Alice")
    db.commit()

    response = client.patch(ME_URL, json={"display_name": "x" * 41}, headers=auth_headers(user))

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    db.refresh(user)
    assert user.display_name == "Alice"


def test_patch_me_upper_cases_the_base_currency(client, db, user_factory, auth_headers):
    user = user_factory(base_currency="CNY")
    db.commit()

    response = client.patch(ME_URL, json={"base_currency": "usd"}, headers=auth_headers(user))

    assert response.status_code == 200
    assert response.json()["base_currency"] == "USD"
    db.refresh(user)
    assert user.base_currency == "USD"


def test_patch_me_rejects_a_currency_the_provider_does_not_support(
    client, db, user_factory, auth_headers
):
    user = user_factory(base_currency="CNY")
    db.commit()

    response = client.patch(ME_URL, json={"base_currency": "xyz"}, headers=auth_headers(user))

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "validation_error"
    # The detail names the offending code (§5.4).
    assert "XYZ" in body["detail"]
    db.refresh(user)
    assert user.base_currency == "CNY"


def test_patch_me_accepts_the_current_currency_while_fx_is_down(
    client, db, user_factory, auth_headers, fx_down
):
    """Setting the currency already in effect needs no list to be validated."""
    user = user_factory(base_currency="CNY")
    db.commit()

    response = client.patch(ME_URL, json={"base_currency": "cny"}, headers=auth_headers(user))

    assert response.status_code == 200, response.text
    assert response.json()["base_currency"] == "CNY"


def test_patch_me_refuses_an_unverifiable_currency_while_fx_is_down(
    client, db, user_factory, auth_headers, fx_down
):
    """An upstream blip must never write a currency nobody checked (§5.4)."""
    user = user_factory(base_currency="CNY")
    db.commit()

    response = client.patch(ME_URL, json={"base_currency": "usd"}, headers=auth_headers(user))

    assert response.status_code == 503
    assert response.json()["code"] == "fx_unavailable"
    db.refresh(user)
    assert user.base_currency == "CNY"


def test_patch_me_rejects_an_explicitly_null_base_currency(client, db, user_factory, auth_headers):
    user = user_factory(base_currency="CNY")
    db.commit()

    response = client.patch(ME_URL, json={"base_currency": None}, headers=auth_headers(user))

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_patch_me_rejects_the_removed_default_source_id_field(
    client, db, user_factory, auth_headers
):
    user = user_factory()
    db.commit()

    response = client.patch(
        ME_URL,
        json={"default_source_id": "4ee1c8fa-eeac-4a08-ad9a-c4be7211a876"},
        headers=auth_headers(user),
    )

    # The column is gone (decision §14.42): a 422, never a 500.
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_patch_me_leaves_omitted_fields_untouched(client, db, user_factory, auth_headers):
    user = user_factory(base_currency="CNY", language="zh", display_name="Alice")
    db.commit()

    response = client.patch(ME_URL, json={"language": "en"}, headers=auth_headers(user))

    assert response.status_code == 200
    body = response.json()
    assert body["base_currency"] == "CNY"
    assert body["display_name"] == "Alice"


def test_patch_me_touches_updated_at(client, db, user_factory, auth_headers):
    user = user_factory()
    # A stamp far enough in the past that a wall clock hiccup cannot fake the
    # assertion either way.
    stale = dt.datetime(2020, 1, 1, 0, 0, 0)
    user.updated_at = stale
    db.commit()

    assert client.patch(
        ME_URL, json={"language": "en"}, headers=auth_headers(user)
    ).status_code == 200

    db.refresh(user)
    assert user.updated_at > stale


def test_patch_me_without_a_token_is_401(client):
    response = client.patch(ME_URL, json={"language": "en"})

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


# ---------------------------------------------------------------------------
# Decision §14.42: the auth-prefixed aliases do not exist
# ---------------------------------------------------------------------------


def test_the_auth_me_aliases_are_gone(client, db, user_factory, auth_headers):
    user = user_factory()
    db.commit()
    headers = auth_headers(user)

    assert client.get(AUTH_ME_URL, headers=headers).status_code == 404
    assert client.patch(AUTH_ME_URL, json={"language": "en"}, headers=headers).status_code == 404
