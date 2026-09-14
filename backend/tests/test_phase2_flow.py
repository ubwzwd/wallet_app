"""End-to-end ledger/member/invite flow, plus the OpenAPI route inventory.

This is the one test module that drives ``POST /auth/register`` and
``POST /auth/login`` directly through the client instead of the ``user_factory``
shortcut every other module uses — it is meant to read as the story a real
pair of users lives through across §5.1-§5.19, not as a check of any single
endpoint in isolation.
"""
from typing import Any


def _register(client, email: str, password: str = "correct horse battery") -> dict[str, str]:
    """Register a brand new account and return its bearer ``Authorization`` header."""
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "base_currency": "CNY"},
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _login(client, email: str, password: str = "correct horse battery") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _ledgers(client, headers: dict[str, str]) -> list[dict[str, Any]]:
    response = client.get("/api/v1/ledgers", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["items"]


def test_two_users_share_and_then_unwind_a_ledger(client):
    # --- A registers: one ledger of her own, and she owns it (§5.1, §5.8) ---
    alice = _register(client, "alice@example.com")

    alice_ledgers = _ledgers(client, alice)
    assert len(alice_ledgers) == 1
    assert alice_ledgers[0]["role"] == "owner"
    assert alice_ledgers[0]["name"] == "我的账本"
    my_ledger_id = alice_ledgers[0]["id"]

    # --- A creates a second, shared ledger (§5.9) ---
    create_response = client.post(
        "/api/v1/ledgers", json={"name": "家庭账本"}, headers=alice
    )
    assert create_response.status_code == 201, create_response.text
    family = create_response.json()
    assert family["role"] == "owner"
    family_id = family["id"]

    assert {row["id"] for row in _ledgers(client, alice)} == {my_ledger_id, family_id}

    # --- A draws an invite code for it (§5.17) ---
    invite_response = client.post(
        f"/api/v1/ledgers/{family_id}/invites", headers=alice
    )
    assert invite_response.status_code == 201, invite_response.text
    code = invite_response.json()["code"]
    assert code.isdigit() and len(code) == 6

    # --- B registers, unrelated to the ledger so far ---
    bob = _register(client, "bob@example.com")
    assert len(_ledgers(client, bob)) == 1

    # --- B redeems the code (§5.19): counts are present, role is member ---
    join_response = client.post(
        "/api/v1/ledgers/join", json={"code": code}, headers=bob
    )
    assert join_response.status_code == 200, join_response.text
    joined = join_response.json()
    assert joined["id"] == family_id
    assert joined["role"] == "member"
    assert joined["counts"] == {"transactions": 0, "sources": 0, "import_batches": 0}

    bob_ledger_ids = {row["id"] for row in _ledgers(client, bob)}
    assert family_id in bob_ledger_ids
    assert len(bob_ledger_ids) == 2

    # --- the same code cannot be redeemed twice: single use (§5.19, §14.29) ---
    reuse_response = client.post(
        "/api/v1/ledgers/join", json={"code": code}, headers=bob
    )
    assert reuse_response.status_code == 400
    assert reuse_response.json()["code"] == "invite_invalid"

    # --- A sees both members, owner sorted first (§5.13) ---
    members_response = client.get(f"/api/v1/ledgers/{family_id}/members", headers=alice)
    assert members_response.status_code == 200, members_response.text
    members = members_response.json()["items"]
    assert len(members) == 2
    assert [m["role"] for m in members] == ["owner", "member"]
    assert members[0]["email"] == "alice@example.com"
    assert members[1]["email"] == "bob@example.com"

    bob_user_id = members[1]["user_id"]

    # --- A hands the ledger over to B (§5.16) ---
    transfer_response = client.post(
        f"/api/v1/ledgers/{family_id}/transfer-ownership",
        json={"to_user_id": bob_user_id},
        headers=alice,
    )
    assert transfer_response.status_code == 200, transfer_response.text
    roles_after_transfer = {m["email"]: m["role"] for m in transfer_response.json()["items"]}
    assert roles_after_transfer == {"alice@example.com": "member", "bob@example.com": "owner"}

    # A is confirmed as a plain member now, from A's own point of view too
    alice_view = client.get(f"/api/v1/ledgers/{family_id}", headers=alice)
    assert alice_view.status_code == 200
    assert alice_view.json()["role"] == "member"

    # --- A, now a member, cannot patch the ledger anymore (§5.11, §3.3) ---
    patch_response = client.patch(
        f"/api/v1/ledgers/{family_id}",
        json={"name": "改名", "updated_at": alice_view.json()["updated_at"]},
        headers=alice,
    )
    assert patch_response.status_code == 403
    assert patch_response.json()["code"] == "not_owner"

    # --- A leaves on her own (§5.15) ---
    leave_response = client.post(f"/api/v1/ledgers/{family_id}/leave", headers=alice)
    assert leave_response.status_code == 204
    assert leave_response.content == b""

    alice_ledgers_after = _ledgers(client, alice)
    assert len(alice_ledgers_after) == 1
    assert alice_ledgers_after[0]["id"] == my_ledger_id

    # the ledger is invisible to A now, not merely forbidden (§3.3)
    gone_response = client.get(f"/api/v1/ledgers/{family_id}", headers=alice)
    assert gone_response.status_code == 404

    # --- B, the new owner, deletes the ledger outright (§5.12) ---
    delete_response = client.delete(
        f"/api/v1/ledgers/{family_id}",
        params={"confirm_name": "家庭账本"},
        headers=bob,
    )
    assert delete_response.status_code == 204
    assert delete_response.content == b""

    # --- B is left with only the default ledger from registration ---
    bob_ledgers_final = _ledgers(client, bob)
    assert len(bob_ledgers_final) == 1
    assert bob_ledgers_final[0]["role"] == "owner"
    assert bob_ledgers_final[0]["name"] == "我的账本"

    # a login (rather than the register token) works just as well end to end
    bob_relogged = _login(client, "bob@example.com")
    assert len(_ledgers(client, bob_relogged)) == 1


# ---------------------------------------------------------------------------
# OpenAPI route inventory (03-backend-api.md §5, §1.3)
# ---------------------------------------------------------------------------

EXPECTED_OPERATIONS = {
    ("GET", "/"),
    ("GET", "/health"),
    ("POST", "/api/v1/auth/register"),
    ("POST", "/api/v1/auth/login"),
    ("GET", "/api/v1/me"),
    ("PATCH", "/api/v1/me"),
    ("GET", "/api/v1/categories"),
    ("GET", "/api/v1/config"),
    ("GET", "/api/v1/rates/latest"),
    ("GET", "/api/v1/rates/currencies"),
    ("POST", "/api/v1/rates/convert"),
    ("GET", "/api/v1/ledgers"),
    ("POST", "/api/v1/ledgers"),
    ("POST", "/api/v1/ledgers/join"),
    ("GET", "/api/v1/ledgers/{id}"),
    ("PATCH", "/api/v1/ledgers/{id}"),
    ("DELETE", "/api/v1/ledgers/{id}"),
    ("GET", "/api/v1/ledgers/{id}/members"),
    ("DELETE", "/api/v1/ledgers/{id}/members/{user_id}"),
    ("POST", "/api/v1/ledgers/{id}/leave"),
    ("POST", "/api/v1/ledgers/{id}/transfer-ownership"),
    ("POST", "/api/v1/ledgers/{id}/invites"),
    ("DELETE", "/api/v1/ledgers/{id}/invites/{code}"),
}


def test_openapi_route_inventory_still_contains_phase_two(client):
    """Every route this phase ships is still there.

    This module only exercises the ledger/member/invite flow, so it checks a
    *subset* rather than exact equality: phase three (``test_phase3_flow.py``)
    owns the exhaustive "exactly this set" check for the branch's full surface,
    which is the exact-equality assertion this test used to make back when
    phase two was the whole application. In particular: no leftover
    ``/auth/me`` alias (decision §14.42, retired alongside the previous
    version's routes under that prefix). ``/import-format`` (§5.7) is a
    later phase's addition and this subset check has nothing to say about
    it either way — it is not asserted against here.
    """
    response = client.get("/openapi.json")
    assert response.status_code == 200
    paths = response.json()["paths"]

    actual_operations = {
        (method.upper(), path)
        for path, operations in paths.items()
        for method in operations
    }

    assert EXPECTED_OPERATIONS <= actual_operations

    all_paths = set(paths)
    assert "/api/v1/auth/me" not in all_paths


# ---------------------------------------------------------------------------
# Anonymous access (§3.1, §4.1)
# ---------------------------------------------------------------------------


def test_me_without_a_token_is_401_with_the_shared_error_shape(client):
    response = client.get("/api/v1/me")
    assert response.status_code == 401
    body = response.json()
    assert set(body.keys()) == {"detail", "code"}
    assert body["code"] == "unauthorized"


def test_ledgers_without_a_token_is_401_with_the_shared_error_shape(client):
    response = client.get("/api/v1/ledgers")
    assert response.status_code == 401
    body = response.json()
    assert set(body.keys()) == {"detail", "code"}
    assert body["code"] == "unauthorized"
