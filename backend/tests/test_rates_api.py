"""Tests for the three /rates endpoints (03-backend-api.md §5.45-§5.47).

Frankfurter is faked with ``httpx.MockTransport``, so nothing here goes out to
the network; the assertions are about the response shape and the number of
upstream calls each endpoint is allowed to make.
"""
import datetime as dt
from decimal import Decimal

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.database import get_db
from app.main import app
from app.models.exchange_rate import ExchangeRate
from app.services import fx
from tests.test_fx import install_upstream, latest_payload, range_payload


@pytest.fixture(autouse=True)
def _fx_state(monkeypatch):
    fx.reset_state()
    monkeypatch.setattr(fx, "HTTP_RETRY_ATTEMPTS", 1)
    yield
    fx.reset_state()


@pytest.fixture()
def client(db):
    """TestClient wired to the in-memory session of the ``db`` fixture."""
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def boom(_request: httpx.Request) -> httpx.Response:
    return httpx.Response(500, json={"message": "upstream is down"})


# ---------------------------------------------------------------------------
# §5.45 GET /rates/currencies
# ---------------------------------------------------------------------------


def test_currencies_are_listed_and_cached_for_the_process(client, monkeypatch):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"USD": "United States Dollar", "EUR": "Euro"})

    calls = install_upstream(monkeypatch, handler)

    response = client.get("/api/v1/rates/currencies")

    assert response.status_code == 200
    assert response.json() == {
        "currencies": {"USD": "United States Dollar", "EUR": "Euro"}
    }
    assert len(calls) == 1

    assert client.get("/api/v1/rates/currencies").status_code == 200
    assert len(calls) == 1


def test_currencies_without_cache_and_dead_upstream_is_503(client, monkeypatch):
    install_upstream(monkeypatch, boom)

    response = client.get("/api/v1/rates/currencies")

    assert response.status_code == 503
    assert response.json()["code"] == "fx_unavailable"


# ---------------------------------------------------------------------------
# §5.46 GET /rates/latest
# ---------------------------------------------------------------------------


def test_latest_uses_the_upstream_quotation_day_and_caches_it(client, db, monkeypatch):
    quotation_day = dt.date.today() - dt.timedelta(days=1)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json=latest_payload("USD", quotation_day, {"EUR": 0.92, "CNY": 7.245})
        )

    calls = install_upstream(monkeypatch, handler)

    response = client.get("/api/v1/rates/latest?base=usd&symbols=eur,%20cny")

    assert response.status_code == 200
    assert response.json() == {
        "base": "USD",
        "date": quotation_day.isoformat(),
        "rates": {"EUR": "0.92000000", "CNY": "7.24500000"},
    }
    assert len(calls) == 1           # one call for both symbols (§5.46)
    assert db.execute(select(func.count()).select_from(ExchangeRate)).scalar_one() == 2

    # Fresh rows now cover both symbols, so the second request stays local.
    assert client.get("/api/v1/rates/latest?base=USD&symbols=EUR,CNY").status_code == 200
    assert len(calls) == 1


def test_latest_rejects_a_malformed_base(client, monkeypatch):
    calls = install_upstream(monkeypatch, boom)

    response = client.get("/api/v1/rates/latest?base=dollar&symbols=EUR")

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert calls == []


def test_latest_rejects_empty_symbols(client, monkeypatch):
    calls = install_upstream(monkeypatch, boom)

    response = client.get("/api/v1/rates/latest?base=USD&symbols=%20,")

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert calls == []


def test_latest_reports_a_dead_upstream_as_fx_unavailable(client, monkeypatch):
    install_upstream(monkeypatch, boom)

    response = client.get("/api/v1/rates/latest?base=USD&symbols=CNY")

    assert response.status_code == 503
    assert response.json()["code"] == "fx_unavailable"


# ---------------------------------------------------------------------------
# §5.47 POST /rates/convert
# ---------------------------------------------------------------------------


def test_convert_makes_a_single_upstream_call(client, db, monkeypatch):
    today = dt.datetime.now(dt.UTC).date()

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=range_payload("USD", {today.isoformat(): {"CNY": 7.245}}))

    calls = install_upstream(monkeypatch, handler)

    response = client.post(
        "/api/v1/rates/convert",
        json={"amount": "100", "from_currency": "usd", "to_currency": "cny"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "amount": "100",
        "from_currency": "USD",
        "to_currency": "CNY",
        "converted_amount": "724.5000",
        "rate": "7.24500000",
        "date": today.isoformat(),
    }
    assert len(calls) == 1
    assert db.execute(select(func.count()).select_from(ExchangeRate)).scalar_one() == 1


def test_convert_on_a_given_day_falls_back_to_the_last_trading_day(client, monkeypatch):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=range_payload("EUR", {"2026-09-11": {"CNY": 8.2}}))

    install_upstream(monkeypatch, handler)

    response = client.post(
        "/api/v1/rates/convert",
        json={
            "amount": "10.5",
            "from_currency": "EUR",
            "to_currency": "CNY",
            "on": "2026-09-13",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["date"] == "2026-09-11"
    assert body["converted_amount"] == "86.1000"
    assert Decimal(body["rate"]) == Decimal("8.2")


def test_convert_between_identical_currencies_needs_no_rate(client, monkeypatch):
    calls = install_upstream(monkeypatch, boom)

    response = client.post(
        "/api/v1/rates/convert",
        json={"amount": "12.30", "from_currency": "cny", "to_currency": "CNY"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["converted_amount"] == "12.3000"
    assert body["rate"] == "1.00000000"
    assert calls == []


def test_convert_rejects_a_non_positive_amount(client, monkeypatch):
    calls = install_upstream(monkeypatch, boom)

    response = client.post(
        "/api/v1/rates/convert",
        json={"amount": "0", "from_currency": "USD", "to_currency": "CNY"},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert calls == []


def test_convert_turns_an_unknown_currency_into_fx_unavailable(client, monkeypatch):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"message": "not found"})

    install_upstream(monkeypatch, handler)

    response = client.post(
        "/api/v1/rates/convert",
        json={"amount": "1", "from_currency": "USD", "to_currency": "XXX"},
    )

    assert response.status_code == 503
    assert response.json()["code"] == "fx_unavailable"
