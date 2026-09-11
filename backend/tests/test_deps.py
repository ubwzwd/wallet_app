"""Tests for the shared dependencies (03-backend-api.md §1.2, §3.2, §3.3).

The ledger dependencies are exercised over HTTP on a throwaway app whose only
routes are the dependencies themselves, so the assertions are about status
codes and error codes exactly as an endpoint would produce them.
"""
import uuid

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.deps import (
    LedgerContext,
    Pagination,
    client_ip,
    client_name,
    get_ledger_member,
    pagination,
    require_owner,
)
from app.core.errors import install_error_handlers


@pytest.fixture()
def deps_client(db):
    """A tiny app that exposes each dependency as its own route."""
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/ledgers/{id}/thing")
    def member_route(ctx: LedgerContext = Depends(get_ledger_member)):
        return {
            "ledger_id": str(ctx.ledger.id),
            "role": ctx.member.role,
            "user_id": str(ctx.user.id),
        }

    @app.get("/ledgers/{id}/owner-thing")
    def owner_route(ctx: LedgerContext = Depends(require_owner)):
        return {"ledger_id": str(ctx.ledger.id), "role": ctx.member.role}

    @app.get("/paged")
    def paged_route(page: Pagination = Depends(pagination)):
        return {"limit": page.limit, "offset": page.offset}

    @app.get("/whoami")
    def client_route(name: str | None = Depends(client_name)):
        return {"client": name}

    @app.get("/ip")
    def ip_route(ip: str = Depends(client_ip)):
        return {"ip": ip}

    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# get_ledger_member / require_owner (§3.2, §3.3)
# ---------------------------------------------------------------------------


def test_member_sees_the_ledger(deps_client, user_factory, ledger_factory, auth_headers):
    owner = user_factory()
    member = user_factory()
    ledger = ledger_factory(owner, members=[member])

    response = deps_client.get(f"/ledgers/{ledger.id}/thing", headers=auth_headers(member))

    assert response.status_code == 200
    assert response.json() == {
        "ledger_id": str(ledger.id),
        "role": "member",
        "user_id": str(member.id),
    }


def test_unknown_ledger_is_not_found(deps_client, user_factory, auth_headers):
    user = user_factory()

    response = deps_client.get(f"/ledgers/{uuid.uuid4()}/thing", headers=auth_headers(user))

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_non_member_gets_the_same_404_as_a_missing_ledger(
    deps_client, user_factory, ledger_factory, auth_headers
):
    """§3.3: membership must not leak through the status code."""
    owner = user_factory()
    outsider = user_factory()
    ledger = ledger_factory(owner)

    existing = deps_client.get(f"/ledgers/{ledger.id}/thing", headers=auth_headers(outsider))
    missing = deps_client.get(f"/ledgers/{uuid.uuid4()}/thing", headers=auth_headers(outsider))

    assert existing.status_code == missing.status_code == 404
    assert existing.json() == missing.json()


def test_owner_route_allows_the_owner(deps_client, user_factory, ledger_factory, auth_headers):
    owner = user_factory()
    ledger = ledger_factory(owner)

    response = deps_client.get(
        f"/ledgers/{ledger.id}/owner-thing", headers=auth_headers(owner)
    )

    assert response.status_code == 200
    assert response.json()["role"] == "owner"


def test_owner_route_refuses_a_member_with_not_owner(
    deps_client, user_factory, ledger_factory, auth_headers
):
    owner = user_factory()
    member = user_factory()
    ledger = ledger_factory(owner, members=[member])

    response = deps_client.get(
        f"/ledgers/{ledger.id}/owner-thing", headers=auth_headers(member)
    )

    assert response.status_code == 403
    assert response.json()["code"] == "not_owner"


def test_owner_route_hides_the_ledger_from_a_non_member(
    deps_client, user_factory, ledger_factory, auth_headers
):
    """Not a member at all: 404 wins over the 403, because step 2 runs first."""
    owner = user_factory()
    outsider = user_factory()
    ledger = ledger_factory(owner)

    response = deps_client.get(
        f"/ledgers/{ledger.id}/owner-thing", headers=auth_headers(outsider)
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_without_a_token_the_ledger_route_is_unauthorized(
    deps_client, user_factory, ledger_factory
):
    owner = user_factory()
    ledger = ledger_factory(owner)

    response = deps_client.get(f"/ledgers/{ledger.id}/thing")

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


def test_a_ledger_id_that_is_not_a_uuid_is_a_validation_error(
    deps_client, user_factory, auth_headers
):
    user = user_factory()

    response = deps_client.get("/ledgers/not-a-uuid/thing", headers=auth_headers(user))

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


# ---------------------------------------------------------------------------
# pagination (§4.3)
# ---------------------------------------------------------------------------


def test_pagination_defaults(deps_client):
    assert deps_client.get("/paged").json() == {"limit": 50, "offset": 0}


@pytest.mark.parametrize("limit,offset", [(1, 0), (200, 17), (50, 1000)])
def test_pagination_accepts_the_allowed_range(deps_client, limit, offset):
    response = deps_client.get("/paged", params={"limit": limit, "offset": offset})

    assert response.status_code == 200
    assert response.json() == {"limit": limit, "offset": offset}


@pytest.mark.parametrize(
    "params",
    [{"limit": 0}, {"limit": 201}, {"limit": -1}, {"offset": -1}, {"limit": "many"}],
)
def test_pagination_rejects_out_of_range_values(deps_client, params):
    """§4.3: out of range is 422, never a silent clamp."""
    response = deps_client.get("/paged", params=params)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


# ---------------------------------------------------------------------------
# client_name (§4.7)
# ---------------------------------------------------------------------------


def test_client_name_is_none_without_the_header(deps_client):
    assert deps_client.get("/whoami").json() == {"client": None}


def test_client_name_passes_a_plain_value_through(deps_client):
    assert deps_client.get("/whoami", headers={"X-Client": "web"}).json() == {"client": "web"}


def test_client_name_truncates_at_40_characters(deps_client):
    response = deps_client.get("/whoami", headers={"X-Client": "w" * 100})

    assert response.json() == {"client": "w" * 40}


def test_client_name_drops_non_ascii_and_control_characters(deps_client):
    # The header itself is latin-1 on the wire, so the non-ASCII bytes arrive
    # as characters above 0x7E and must be filtered out.
    response = deps_client.get(
        "/whoami", headers={"X-Client": "we\x7fb\xe9 app".encode("latin-1")}
    )

    assert response.json() == {"client": "web app"}


def test_client_name_that_filters_down_to_nothing_is_none(deps_client):
    response = deps_client.get("/whoami", headers={"X-Client": "   "})

    assert response.json() == {"client": None}


# ---------------------------------------------------------------------------
# client_ip (§8.1)
# ---------------------------------------------------------------------------


def test_client_ip_falls_back_to_the_peer_address(deps_client):
    assert deps_client.get("/ip").json() == {"ip": "testclient"}


def test_client_ip_takes_the_first_forwarded_segment(deps_client):
    response = deps_client.get(
        "/ip", headers={"X-Forwarded-For": "203.0.113.7, 70.41.3.18, 150.172.238.178"}
    )

    assert response.json() == {"ip": "203.0.113.7"}


def test_client_ip_ignores_an_empty_forwarded_header(deps_client):
    response = deps_client.get("/ip", headers={"X-Forwarded-For": " "})

    assert response.json() == {"ip": "testclient"}
