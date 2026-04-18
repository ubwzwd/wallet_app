"""
Regression test: PATCH /auth/me followed by GET /auth/me with same token
must both succeed (both return HTTP 200). This guards against the session
invalidation bug found in Phase 03 checkpoint 02.

Root cause was the frontend 401 interceptor clearing the token on any GET
/auth/me failure.  Backend fix: pool_recycle=3600 + force-load fields after
db.refresh().  Frontend fix: conditional token preservation in interceptor.

This test proves the backend never causes the 401 in the first place.
"""
import uuid

import pytest


def test_profile_update_keeps_session(client):
    """Regression: PATCH /auth/me -> GET /auth/me with same token must both succeed."""
    test_email = f"session-test-{uuid.uuid4()}@test.com"

    # Step 1: Register a test user
    register_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": test_email,
            "password": "TestPass123!",
            "base_currency": "USD",
        },
    )
    assert register_response.status_code in (200, 201), (
        f"Register failed: {register_response.json()}"
    )

    token = register_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Step 2: Baseline — GET /auth/me before PATCH
    get_before = client.get("/api/v1/auth/me", headers=headers)
    assert get_before.status_code == 200, (
        f"Baseline GET failed: {get_before.status_code} {get_before.json()}"
    )
    assert get_before.json()["base_currency"] == "USD"

    # Step 3: PATCH /auth/me to update base_currency
    patch_response = client.patch(
        "/api/v1/auth/me",
        json={"base_currency": "GBP"},
        headers=headers,
    )
    assert patch_response.status_code == 200, (
        f"PATCH failed: {patch_response.status_code} {patch_response.json()}"
    )
    assert patch_response.json()["base_currency"] == "GBP"

    # Step 4 (CRITICAL): GET /auth/me with SAME token must succeed (not 401)
    get_after = client.get("/api/v1/auth/me", headers=headers)
    assert get_after.status_code == 200, (
        f"GET /auth/me returned {get_after.status_code} after PATCH: "
        f"{get_after.json()} — session invalidation bug detected"
    )
    assert get_after.json()["base_currency"] == "GBP"

    # Step 5: Verify second immediate GET also succeeds
    get_second = client.get("/api/v1/auth/me", headers=headers)
    assert get_second.status_code == 200, (
        f"Second GET returned {get_second.status_code}: {get_second.json()}"
    )
    assert get_second.json()["base_currency"] == "GBP"


def test_profile_update_preserves_other_fields(client):
    """Partial update: PATCH with only base_currency must not wipe other fields."""
    test_email = f"partial-test-{uuid.uuid4()}@test.com"

    reg = client.post(
        "/api/v1/auth/register",
        json={"email": test_email, "password": "TestPass123!", "base_currency": "USD"},
    )
    assert reg.status_code in (200, 201)
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Record original email
    me_before = client.get("/api/v1/auth/me", headers=headers)
    assert me_before.status_code == 200
    original_email = me_before.json()["email"]

    # PATCH only base_currency
    patch = client.patch(
        "/api/v1/auth/me",
        json={"base_currency": "EUR"},
        headers=headers,
    )
    assert patch.status_code == 200

    # Email and id must be unchanged
    me_after = client.get("/api/v1/auth/me", headers=headers)
    assert me_after.status_code == 200
    assert me_after.json()["email"] == original_email
    assert me_after.json()["base_currency"] == "EUR"


def test_multiple_sequential_patches_keep_session(client):
    """Multiple PATCH calls in sequence must all keep the session valid."""
    test_email = f"multi-patch-{uuid.uuid4()}@test.com"

    reg = client.post(
        "/api/v1/auth/register",
        json={"email": test_email, "password": "TestPass123!", "base_currency": "USD"},
    )
    assert reg.status_code in (200, 201)
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    currencies = ["EUR", "GBP", "CNY", "USD"]
    for currency in currencies:
        patch = client.patch(
            "/api/v1/auth/me",
            json={"base_currency": currency},
            headers=headers,
        )
        assert patch.status_code == 200, f"PATCH to {currency} failed"

        get = client.get("/api/v1/auth/me", headers=headers)
        assert get.status_code == 200, (
            f"GET after PATCH to {currency} returned {get.status_code}"
        )
        assert get.json()["base_currency"] == currency
