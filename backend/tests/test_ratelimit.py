"""Tests for the in-process token bucket (03-backend-api.md §8.1).

Time is injected through ``ratelimit.clock``, so refill is asserted exactly and
no test ever sleeps. The ``_reset_rate_limits`` fixture in conftest empties the
table around every case.
"""
import pytest

from app.core import ratelimit
from app.core.errors import ApiError
from app.core.ratelimit import Limit

JOIN_LIMIT = Limit(capacity=3, refill_seconds=3)     # 1 QPS, burst 3 (decision §14.35)


@pytest.fixture()
def now(monkeypatch):
    """A movable clock; ``now.advance(seconds)`` is the only way time passes."""

    class Clock:
        value = 1000.0

        def advance(self, seconds: float) -> None:
            self.value += seconds

    clock = Clock()
    monkeypatch.setattr(ratelimit, "clock", lambda: clock.value)
    return clock


def test_capacity_is_the_allowed_burst(now):
    for _ in range(JOIN_LIMIT.capacity):
        ratelimit.check("join", "global", JOIN_LIMIT)

    with pytest.raises(ApiError) as excinfo:
        ratelimit.check("join", "global", JOIN_LIMIT)

    assert excinfo.value.status_code == 429
    assert excinfo.value.code == "invite_rate_limited"


def test_tokens_refill_at_the_configured_rate(now):
    for _ in range(3):
        ratelimit.check("join", "global", JOIN_LIMIT)

    now.advance(0.5)                       # half a token: still refused
    with pytest.raises(ApiError):
        ratelimit.check("join", "global", JOIN_LIMIT)

    now.advance(0.5)                       # one whole token is back
    ratelimit.check("join", "global", JOIN_LIMIT)

    with pytest.raises(ApiError):
        ratelimit.check("join", "global", JOIN_LIMIT)


def test_tokens_never_pile_up_above_capacity(now):
    ratelimit.check("login", "1.2.3.4", Limit(capacity=2, refill_seconds=60))
    now.advance(3600)                      # an hour of idling

    limit = Limit(capacity=2, refill_seconds=60)
    ratelimit.check("login", "1.2.3.4", limit)
    ratelimit.check("login", "1.2.3.4", limit)

    with pytest.raises(ApiError):
        ratelimit.check("login", "1.2.3.4", limit)


def test_retry_after_holds_the_whole_seconds_until_the_next_token(now):
    limit = Limit(capacity=10, refill_seconds=60)      # a token every 6 seconds
    for _ in range(10):
        ratelimit.check("login", "203.0.113.7", limit)

    with pytest.raises(ApiError) as excinfo:
        ratelimit.check("login", "203.0.113.7", limit)
    assert excinfo.value.headers == {"Retry-After": "6"}
    assert "6s" in excinfo.value.detail

    now.advance(4)                          # 2 seconds still missing
    with pytest.raises(ApiError) as excinfo:
        ratelimit.check("login", "203.0.113.7", limit)
    assert excinfo.value.headers == {"Retry-After": "2"}

    now.advance(2)
    ratelimit.check("login", "203.0.113.7", limit)


def test_a_refused_call_does_not_push_the_wait_further_out(now):
    """Hammering a dry bucket must not starve the caller forever."""
    limit = Limit(capacity=1, refill_seconds=10)
    ratelimit.check("register", "198.51.100.4", limit)

    for _ in range(5):
        now.advance(1)
        with pytest.raises(ApiError):
            ratelimit.check("register", "198.51.100.4", limit)

    now.advance(5.5)                        # past the 10 seconds one token costs
    ratelimit.check("register", "198.51.100.4", limit)


@pytest.mark.parametrize(
    "bucket,expected",
    [
        ("login", "login_rate_limited"),
        ("register", "register_rate_limited"),
        ("join", "invite_rate_limited"),
        ("import", "import_rate_limited"),
    ],
)
def test_each_bucket_reports_its_own_code(now, bucket, expected):
    limit = Limit(capacity=1, refill_seconds=60)
    ratelimit.check(bucket, "key", limit)

    with pytest.raises(ApiError) as excinfo:
        ratelimit.check(bucket, "key", limit)

    assert excinfo.value.code == expected
    assert excinfo.value.status_code == 429


def test_an_unknown_bucket_is_a_coding_error(now):
    with pytest.raises(KeyError):
        ratelimit.check("nope", "key", Limit(capacity=1, refill_seconds=60))


def test_keys_are_counted_separately(now):
    limit = Limit(capacity=1, refill_seconds=60)
    ratelimit.check("login", "1.1.1.1", limit)
    ratelimit.check("login", "2.2.2.2", limit)

    with pytest.raises(ApiError):
        ratelimit.check("login", "1.1.1.1", limit)


def test_buckets_are_counted_separately(now):
    limit = Limit(capacity=1, refill_seconds=60)
    ratelimit.check("login", "same-key", limit)
    ratelimit.check("register", "same-key", limit)

    with pytest.raises(ApiError):
        ratelimit.check("login", "same-key", limit)


def test_the_join_bucket_is_global_across_callers(now):
    """Decision §14.35: the join limit counts requests, not users."""
    for _ in range(3):
        ratelimit.check("join", "global", JOIN_LIMIT)

    # A different user, the same fixed key, hence the same bucket.
    with pytest.raises(ApiError):
        ratelimit.check("join", "global", JOIN_LIMIT)


def test_reset_clears_one_key_only(now):
    limit = Limit(capacity=1, refill_seconds=60)
    ratelimit.check("login", "1.1.1.1", limit)
    ratelimit.check("login", "2.2.2.2", limit)

    ratelimit.reset("login", "1.1.1.1")

    ratelimit.check("login", "1.1.1.1", limit)      # a successful login cleared it
    with pytest.raises(ApiError):
        ratelimit.check("login", "2.2.2.2", limit)


def test_reset_of_an_unknown_key_is_a_no_op(now):
    ratelimit.reset("login", "never-seen")


def test_reset_all_empties_every_bucket(now):
    limit = Limit(capacity=1, refill_seconds=60)
    ratelimit.check("login", "1.1.1.1", limit)
    ratelimit.check("join", "global", Limit(capacity=1, refill_seconds=3))

    ratelimit.reset_all()

    ratelimit.check("login", "1.1.1.1", limit)
    ratelimit.check("join", "global", Limit(capacity=1, refill_seconds=3))


def test_the_key_table_is_an_lru_capped_at_ten_thousand(now, monkeypatch):
    assert ratelimit.MAX_KEYS == 10000

    monkeypatch.setattr(ratelimit, "MAX_KEYS", 3)
    limit = Limit(capacity=1, refill_seconds=600)
    for index in range(3):
        ratelimit.check("login", f"ip-{index}", limit)

    ratelimit.check("login", "ip-3", limit)          # evicts the oldest, ip-0

    ratelimit.check("login", "ip-0", limit)          # evicted: counting starts over
    with pytest.raises(ApiError):
        ratelimit.check("login", "ip-2", limit)      # still tracked


def test_recent_use_keeps_a_key_out_of_the_eviction_slot(now, monkeypatch):
    monkeypatch.setattr(ratelimit, "MAX_KEYS", 3)
    limit = Limit(capacity=2, refill_seconds=600)
    for index in range(3):
        ratelimit.check("login", f"ip-{index}", limit)

    ratelimit.check("login", "ip-0", limit)          # ip-0 becomes the newest
    ratelimit.check("login", "ip-3", limit)          # so ip-1 is the one dropped

    with pytest.raises(ApiError):
        ratelimit.check("login", "ip-0", limit)      # kept, and out of tokens
    ratelimit.check("login", "ip-1", limit)          # evicted, hence a fresh bucket


def test_the_real_cap_evicts_the_oldest_key(now):
    limit = Limit(capacity=1, refill_seconds=600)
    for index in range(ratelimit.MAX_KEYS):
        ratelimit.check("login", f"ip-{index}", limit)

    with pytest.raises(ApiError):
        ratelimit.check("login", "ip-0", limit)      # nothing evicted yet

    ratelimit.reset_all()
    for index in range(ratelimit.MAX_KEYS + 1):
        ratelimit.check("login", f"ip-{index}", limit)

    ratelimit.check("login", "ip-0", limit)          # pushed out by ip-10000


@pytest.mark.parametrize("capacity,refill", [(0, 60), (-1, 60), (1, 0), (1, -5)])
def test_a_nonsense_limit_is_rejected(capacity, refill):
    with pytest.raises(ValueError):
        Limit(capacity=capacity, refill_seconds=refill)


def test_the_429_reaches_the_client_with_a_retry_after_header(now):
    """End to end through the ApiError handler: body plus the header (§4.1, §8.1)."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.core.errors import install_error_handlers

    app = FastAPI()
    install_error_handlers(app)

    @app.post("/join")
    def join():
        ratelimit.check("join", "global", JOIN_LIMIT)
        return {"joined": True}

    with TestClient(app) as test_client:
        for _ in range(3):
            assert test_client.post("/join").status_code == 200

        response = test_client.post("/join")

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "1"
    assert response.json() == {
        "detail": "Too many join attempts; try again in 1s",
        "code": "invite_rate_limited",
    }
