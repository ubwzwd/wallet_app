"""Tests for the exchange rate service (03-backend-api.md §6).

Frankfurter is faked with ``httpx.MockTransport``; nothing here touches the
network. Every test asserts how many upstream calls were made, because the
caching, backfill and throttling rules of §6.2/§6.3 are exactly about that.
"""
import datetime as dt
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import create_engine, func, select, update
from sqlalchemy.orm import Session as SaSession

from app.core.errors import ApiError, ErrorCode
from app.models.exchange_rate import ExchangeRate
from app.services import fx


@pytest.fixture(autouse=True)
def _fx_state(monkeypatch):
    """Clear the process level caches and make failing calls instant."""
    fx.reset_state()
    monkeypatch.setattr(fx, "HTTP_RETRY_ATTEMPTS", 1)
    yield
    fx.reset_state()


def install_upstream(monkeypatch, handler) -> list[httpx.Request]:
    """Point ``fx.client_factory`` at ``handler``; returns the captured requests.

    One client, handed out on every call, the way the real factory pools it.
    """
    calls: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    client = httpx.Client(
        transport=httpx.MockTransport(record), base_url="https://fx.test/v1"
    )
    monkeypatch.setattr(fx, "client_factory", lambda: client)
    return calls


def range_payload(base: str, quotes: dict[str, dict[str, float]]) -> dict:
    """A Frankfurter ``/{start}..{end}`` body: only days with a quotation."""
    return {
        "amount": 1.0,
        "base": base,
        "start_date": min(quotes) if quotes else None,
        "end_date": max(quotes) if quotes else None,
        "rates": quotes,
    }


def latest_payload(base: str, day: dt.date, rates: dict[str, float]) -> dict:
    return {"amount": 1.0, "base": base, "date": day.isoformat(), "rates": rates}


def seed(
    db,
    day: dt.date,
    base: str,
    symbol: str,
    rate: str,
    fetched_at: dt.datetime | None = None,
) -> None:
    db.add(
        ExchangeRate(
            date=day,
            base=base,
            symbol=symbol,
            rate=Decimal(rate),
            fetched_at=fetched_at or dt.datetime.now(dt.UTC).replace(tzinfo=None),
        )
    )
    db.flush()


def row_count(db) -> int:
    return db.execute(select(func.count()).select_from(ExchangeRate)).scalar_one()


def boom(_request: httpx.Request) -> httpx.Response:
    return httpx.Response(500, json={"message": "upstream is down"})


# ---------------------------------------------------------------------------
# convert
# ---------------------------------------------------------------------------


def test_same_currency_needs_no_lookup(db, monkeypatch):
    calls = install_upstream(monkeypatch, boom)
    on = dt.date(2026, 9, 8)

    assert fx.convert(db, Decimal("42.50"), "usd", "USD", on) == (
        Decimal("42.50"),
        Decimal("1"),
        on,
    )
    assert calls == []


def test_cached_rate_is_used_without_a_request(db, monkeypatch):
    calls = install_upstream(monkeypatch, boom)
    on = dt.date(2026, 9, 8)
    seed(db, on, "USD", "CNY", "7.245")

    amount, rate, rate_date = fx.convert(db, Decimal("100"), "USD", "CNY", on)

    assert (amount, rate, rate_date) == (Decimal("724.5000"), Decimal("7.24500000"), on)
    assert calls == []


def test_missing_date_fetches_one_range_and_caches_it(db, monkeypatch):
    on = dt.date(2026, 9, 8)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=range_payload(
                "USD", {"2026-09-07": {"CNY": 7.24}, "2026-09-08": {"CNY": 7.245}}
            ),
        )

    calls = install_upstream(monkeypatch, handler)

    amount, rate, rate_date = fx.convert(db, Decimal("100"), "usd", "cny", on)

    assert (amount, rate, rate_date) == (Decimal("724.5000"), Decimal("7.24500000"), on)
    assert len(calls) == 1
    assert calls[0].url.path == "/v1/2026-08-29..2026-09-08"
    assert dict(calls[0].url.params) == {"from": "USD", "to": "CNY"}
    assert row_count(db) == 2

    # The second call is served from the cache written by the first one.
    assert fx.convert(db, Decimal("1"), "USD", "CNY", on)[1] == Decimal("7.24500000")
    assert len(calls) == 1


def test_weekend_falls_back_to_the_last_trading_day(db, monkeypatch):
    sunday = dt.date(2026, 9, 13)
    friday = dt.date(2026, 9, 11)

    def handler(_request: httpx.Request) -> httpx.Response:
        # Frankfurter only returns days that have a quotation.
        return httpx.Response(200, json=range_payload("EUR", {"2026-09-11": {"CNY": 8.2}}))

    calls = install_upstream(monkeypatch, handler)

    amount, rate, rate_date = fx.convert(db, Decimal("10"), "EUR", "CNY", sunday)

    assert rate_date == friday
    assert (amount, rate) == (Decimal("82.0000"), Decimal("8.20000000"))
    assert len(calls) == 1


def test_beyond_the_backfill_window_uses_the_latest_rate(db, monkeypatch):
    on = dt.date(2015, 6, 1)          # older than any quotation the pair has
    latest_day = dt.date(2026, 9, 11)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/latest"):
            return httpx.Response(200, json=latest_payload("USD", latest_day, {"CNY": 7.1}))
        return httpx.Response(200, json=range_payload("USD", {}))

    calls = install_upstream(monkeypatch, handler)

    amount, rate, rate_date = fx.convert(db, Decimal("100"), "USD", "CNY", on)

    assert (amount, rate, rate_date) == (Decimal("710.0000"), Decimal("7.10000000"), latest_day)
    assert [call.url.path for call in calls] == ["/v1/2015-05-22..2015-06-01", "/v1/latest"]


def test_cached_row_older_than_the_window_still_beats_a_dead_upstream(db, monkeypatch):
    """§6.2 step 4: outside the window the answer is whatever ``latest_rate`` has.

    ``convert`` does not reach for an old row of its own; the row below is used
    because it is the pair's latest cached quotation and upstream is down.
    """
    old_day = dt.date(2026, 1, 5)
    on = dt.date(2026, 9, 8)          # 246 days later: far outside the window
    seed(db, old_day, "USD", "CNY", "7.0", fetched_at=dt.datetime(2026, 1, 5, 12, 0))
    calls = install_upstream(monkeypatch, boom)

    amount, rate, rate_date = fx.convert(db, Decimal("100"), "USD", "CNY", on)

    assert (amount, rate, rate_date) == (Decimal("700.0000"), Decimal("7.00000000"), old_day)
    assert len(calls) == 2            # the range and the /latest attempt both failed


def test_dead_upstream_without_any_cache_raises_fx_unavailable(db, monkeypatch):
    calls = install_upstream(monkeypatch, boom)

    with pytest.raises(ApiError) as excinfo:
        fx.convert(db, Decimal("100"), "USD", "CNY", dt.date(2026, 9, 8))

    assert excinfo.value.status_code == 503
    assert excinfo.value.code == ErrorCode.FX_UNAVAILABLE
    assert len(calls) == 2
    assert row_count(db) == 0


def test_transport_errors_are_retried(db, monkeypatch):
    """§6.1: the client raises httpx errors, so retrying actually happens."""
    monkeypatch.setattr(fx, "HTTP_RETRY_ATTEMPTS", 3)
    monkeypatch.setattr(fx, "HTTP_RETRY_BACKOFF_SECONDS", 0)
    attempts = {"n": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise httpx.ConnectError("connection refused")
        return httpx.Response(200, json=range_payload("USD", {"2026-09-08": {"CNY": 7.2}}))

    calls = install_upstream(monkeypatch, handler)

    _amount, rate, _rate_date = fx.convert(db, Decimal("1"), "USD", "CNY", dt.date(2026, 9, 8))

    assert rate == Decimal("7.20000000")
    assert len(calls) == 3


# ---------------------------------------------------------------------------
# latest_rate
# ---------------------------------------------------------------------------


def test_latest_rate_is_throttled_for_an_hour(db, monkeypatch):
    stale_day = dt.date.today() - dt.timedelta(days=30)
    seed(
        db,
        stale_day,
        "USD",
        "CNY",
        "7.0",
        fetched_at=dt.datetime.now(dt.UTC).replace(tzinfo=None) - dt.timedelta(hours=2),
    )
    refreshed_day = dt.date.today() - dt.timedelta(days=20)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=latest_payload("USD", refreshed_day, {"CNY": 7.5}))

    calls = install_upstream(monkeypatch, handler)

    assert fx.latest_rate(db, "USD", "CNY") == (Decimal("7.50000000"), refreshed_day)
    assert len(calls) == 1

    # Still stale (20 days old), but fetched minutes ago: no second request.
    assert fx.latest_rate(db, "usd", "cny") == (Decimal("7.50000000"), refreshed_day)
    assert len(calls) == 1


def test_latest_rate_refresh_keeps_one_row_and_updates_it(db, monkeypatch):
    day = dt.date.today() - dt.timedelta(days=30)
    quote = {"value": 7.0}

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=latest_payload("USD", day, {"CNY": quote["value"]}))

    install_upstream(monkeypatch, handler)

    fx.latest_rate(db, "USD", "CNY")
    first = db.execute(
        select(ExchangeRate.rate, ExchangeRate.fetched_at).where(ExchangeRate.date == day)
    ).one()
    assert first.rate == Decimal("7.00000000")

    # Pretend an hour went by, so neither throttle (process nor row) applies.
    backdated = dt.datetime.now(dt.UTC).replace(tzinfo=None) - dt.timedelta(hours=2)
    db.execute(update(ExchangeRate).values(fetched_at=backdated))
    quote["value"] = 7.9
    fx.reset_state()
    fx.latest_rate(db, "USD", "CNY")

    second = db.execute(
        select(ExchangeRate.rate, ExchangeRate.fetched_at).where(ExchangeRate.date == day)
    ).one()
    assert row_count(db) == 1
    assert second.rate == Decimal("7.90000000")
    assert second.fetched_at > backdated


def test_fresh_cached_row_needs_no_request(db, monkeypatch):
    seed(db, dt.date.today(), "USD", "CNY", "7.11")
    calls = install_upstream(monkeypatch, boom)

    assert fx.latest_rate(db, "USD", "CNY") == (Decimal("7.11000000"), dt.date.today())
    assert calls == []


def test_a_failed_attempt_does_not_throttle_an_empty_cache(db, monkeypatch):
    """One blip must not pin a pair to 503 for an hour (02-database.md §6.8)."""
    day = dt.date.today() - dt.timedelta(days=1)
    state = {"up": False}

    def handler(_request: httpx.Request) -> httpx.Response:
        if not state["up"]:
            return httpx.Response(500, json={"message": "upstream is down"})
        return httpx.Response(200, json=latest_payload("USD", day, {"CNY": 7.3}))

    calls = install_upstream(monkeypatch, handler)

    with pytest.raises(ApiError):
        fx.latest_rate(db, "USD", "CNY")
    assert len(calls) == 1

    # Upstream recovers seconds later: the next call must actually ask again.
    state["up"] = True
    assert fx.latest_rate(db, "USD", "CNY") == (Decimal("7.30000000"), day)
    assert len(calls) == 2


def test_a_non_json_body_is_reported_as_fx_unavailable(db, monkeypatch):
    """A proxy's HTML behind a 200 is an upstream problem, not a 500 (§5.47)."""
    install_upstream(monkeypatch, lambda _request: httpx.Response(200, text="<html>"))

    with pytest.raises(ApiError) as excinfo:
        fx.latest_rate(db, "USD", "CNY")

    assert excinfo.value.status_code == 503
    assert excinfo.value.code == ErrorCode.FX_UNAVAILABLE


def test_latest_rate_without_cache_and_with_dead_upstream_raises(db, monkeypatch):
    install_upstream(monkeypatch, boom)

    with pytest.raises(ApiError) as excinfo:
        fx.latest_rate(db, "USD", "CNY")

    assert excinfo.value.status_code == 503
    assert excinfo.value.code == ErrorCode.FX_UNAVAILABLE


# ---------------------------------------------------------------------------
# convert_many and warm_cache
# ---------------------------------------------------------------------------


def test_convert_many_makes_one_request_per_currency(db, monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        source = request.url.params["from"]
        if source == "EUR":
            quotes = {
                "2026-09-01": {"CNY": 8.0},
                "2026-09-04": {"CNY": 8.1},
                "2026-09-08": {"CNY": 8.2},
            }
        else:
            quotes = {"2026-09-01": {"CNY": 0.05}, "2026-09-08": {"CNY": 0.051}}
        return httpx.Response(200, json=range_payload(source, quotes))

    calls = install_upstream(monkeypatch, handler)
    items = [
        (Decimal("10"), "EUR", dt.date(2026, 9, 1)),
        (Decimal("10"), "EUR", dt.date(2026, 9, 5)),      # Saturday -> falls back to 09-04
        (Decimal("10"), "EUR", dt.date(2026, 9, 8)),
        (Decimal("1000"), "JPY", dt.date(2026, 9, 2)),    # falls back to 09-01
        (Decimal("5"), "CNY", dt.date(2026, 9, 8)),       # already the target currency
    ]

    results = fx.convert_many(db, items, "CNY")

    assert len(calls) == 2
    assert {call.url.params["from"] for call in calls} == {"EUR", "JPY"}
    assert results == [
        (Decimal("80.0000"), Decimal("8.00000000"), dt.date(2026, 9, 1)),
        (Decimal("81.0000"), Decimal("8.10000000"), dt.date(2026, 9, 4)),
        (Decimal("82.0000"), Decimal("8.20000000"), dt.date(2026, 9, 8)),
        (Decimal("50.0000"), Decimal("0.05000000"), dt.date(2026, 9, 1)),
        (Decimal("5"), Decimal("1"), dt.date(2026, 9, 8)),
    ]

    # Everything the second pass needs is now cached.
    assert fx.convert_many(db, items, "CNY") == results
    assert len(calls) == 2


def test_convert_many_without_foreign_currencies_touches_nothing(db, monkeypatch):
    calls = install_upstream(monkeypatch, boom)
    items = [(Decimal("3"), "CNY", dt.date(2026, 9, 8))]

    assert fx.convert_many(db, items, "cny") == [
        (Decimal("3"), Decimal("1"), dt.date(2026, 9, 8))
    ]
    assert calls == []


def test_warm_cache_fills_gaps_and_leaves_existing_rows_alone(db, monkeypatch):
    day = dt.date(2026, 9, 7)
    seed(db, day, "EUR", "CNY", "8.0", fetched_at=dt.datetime(2026, 9, 7, 6, 0))

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=range_payload("EUR", {"2026-09-07": {"CNY": 9.9}, "2026-09-08": {"CNY": 8.3}}),
        )

    calls = install_upstream(monkeypatch, handler)

    fx.warm_cache(db, ["EUR", "CNY"], "CNY", dt.date(2026, 9, 1), dt.date(2026, 9, 8))

    assert len(calls) == 1            # CNY -> CNY is skipped
    kept = db.execute(
        select(ExchangeRate.rate, ExchangeRate.fetched_at).where(ExchangeRate.date == day)
    ).one()
    assert kept.rate == Decimal("8.00000000")           # published history is not rewritten
    assert kept.fetched_at == dt.datetime(2026, 9, 7, 6, 0)
    assert row_count(db) == 2


# ---------------------------------------------------------------------------
# latest_rates (the batch behind GET /rates/latest)
# ---------------------------------------------------------------------------


def test_latest_rates_date_ignores_the_base_itself(db, monkeypatch):
    """§5.46's single ``date`` is a quotation day; base -> base is not one."""
    quotation_day = dt.date.today() - dt.timedelta(days=3)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=latest_payload("USD", quotation_day, {"EUR": 0.92}))

    install_upstream(monkeypatch, handler)

    rates, rate_date = fx.latest_rates(db, "USD", ["USD", "EUR"])

    assert rates == {"USD": Decimal("1.00000000"), "EUR": Decimal("0.92000000")}
    assert rate_date == quotation_day          # not today, which USD -> USD returns


def test_latest_rates_date_never_overstates_freshness(db, monkeypatch):
    """Two symbols quoted on different days: the response claims the older one."""
    older = dt.date.today() - dt.timedelta(days=5)
    newer = dt.date.today() - dt.timedelta(days=1)
    seed(db, older, "USD", "JPY", "150.0")
    seed(db, newer, "USD", "EUR", "0.92")
    calls = install_upstream(monkeypatch, boom)

    rates, rate_date = fx.latest_rates(db, "USD", ["EUR", "JPY"])

    assert set(rates) == {"EUR", "JPY"}
    assert rate_date == older
    assert calls == []                          # both rows are fresh enough (§6.2)


# ---------------------------------------------------------------------------
# The upsert on the other dialect (02-database.md §1.10, §8.2)
# ---------------------------------------------------------------------------


def test_upsert_on_postgres_keeps_then_refreshes_the_row(migrated_db):
    """The ``pg_insert`` branch of ``_upsert``, on a real Postgres database."""
    engine = create_engine(migrated_db)
    day = dt.date(2026, 9, 8)
    try:
        ExchangeRate.__table__.create(bind=engine)
        with SaSession(engine) as session:
            fx._upsert(session, [(day, "USD", "CNY", Decimal("7.0"))], refresh=False)
            session.commit()
            first = session.execute(
                select(ExchangeRate.rate, ExchangeRate.fetched_at)
            ).one()

            # DO NOTHING: the published rate stays, fetched_at is not touched.
            fx._upsert(session, [(day, "USD", "CNY", Decimal("9.9"))], refresh=False)
            session.commit()
            kept = session.execute(select(ExchangeRate.rate, ExchangeRate.fetched_at)).one()
            assert kept == first

            # DO UPDATE: rate and fetched_at both move (§1.10's write form).
            fx._upsert(session, [(day, "USD", "CNY", Decimal("7.9"))], refresh=True)
            session.commit()
            rows = session.execute(select(ExchangeRate.rate, ExchangeRate.fetched_at)).all()
            assert len(rows) == 1
            assert rows[0].rate == Decimal("7.90000000")
            assert rows[0].fetched_at > first.fetched_at
    finally:
        engine.dispose()
