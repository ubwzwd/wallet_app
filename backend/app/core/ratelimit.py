"""In-process token bucket rate limiting (03-backend-api.md §8, decision §14.43).

One ``(bucket, key) -> (tokens, last_refill)`` table behind a lock serves all
four limited endpoints — login, register, join and import — which differ only
in the bucket name, how the key is derived and the two :class:`Limit` numbers.

Known limits, spelled out in §8.1: buckets are per process (several workers
multiply every threshold, which the global ``join`` bucket cannot tolerate),
counters reset when the process restarts, and the key table is an LRU capped at
:data:`MAX_KEYS` entries, so an evicted key starts counting from a full bucket.
Replacing this module with a Redis-backed one keeps the same three functions.
"""
import math
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Callable

from app.core.errors import ApiError, ErrorCode

# Which error code each bucket reports when it runs dry (§4.2, §8.2).
BUCKET_CODES: dict[str, str] = {
    "login": ErrorCode.LOGIN_RATE_LIMITED,
    "register": ErrorCode.REGISTER_RATE_LIMITED,
    "join": ErrorCode.INVITE_RATE_LIMITED,
    "import": ErrorCode.IMPORT_RATE_LIMITED,
}

# Upper bound on tracked keys; the oldest entry is dropped past it (§8.1).
MAX_KEYS = 10000

# Slack for binary floating point: refilling 1/6 of a token six times lands a
# hair below one whole token, and nobody should wait another second for that.
TOKEN_EPSILON = 1e-9

# Time source, injectable so tests can move time without sleeping.
clock: Callable[[], float] = time.monotonic

_lock = threading.Lock()
_buckets: "OrderedDict[tuple[str, str], tuple[float, float]]" = OrderedDict()


@dataclass(frozen=True)
class Limit:
    """``capacity`` tokens, refilling a whole bucket every ``refill_seconds``."""

    capacity: int          # bucket size = the burst allowed
    refill_seconds: float  # seconds to refill the bucket from empty

    def __post_init__(self) -> None:
        if self.capacity < 1:
            raise ValueError("capacity must be at least 1")
        if self.refill_seconds <= 0:
            raise ValueError("refill_seconds must be positive")

    @property
    def tokens_per_second(self) -> float:
        return self.capacity / self.refill_seconds


def check(bucket: str, key: str, limit: Limit) -> None:
    """Spend one token of ``(bucket, key)`` or refuse the request.

    Raises:
        ApiError: 429 with the bucket's code and a ``Retry-After`` header
            holding the whole seconds until the next token (§8.1).
        KeyError: If ``bucket`` is not one of :data:`BUCKET_CODES` — a coding
            mistake, caught on the first call rather than on the first 429.
    """
    code = BUCKET_CODES[bucket]
    entry_key = (bucket, key)
    now = clock()

    with _lock:
        current = _buckets.get(entry_key)
        if current is None:
            tokens = float(limit.capacity)
        else:
            tokens, last_refill = current
            elapsed = max(0.0, now - last_refill)
            tokens = min(float(limit.capacity), tokens + elapsed * limit.tokens_per_second)

        allowed = tokens >= 1.0 - TOKEN_EPSILON
        if allowed:
            tokens = max(0.0, tokens - 1.0)

        _buckets[entry_key] = (tokens, now)
        _buckets.move_to_end(entry_key)
        while len(_buckets) > MAX_KEYS:
            _buckets.popitem(last=False)

        if allowed:
            return

        # Seconds until the bucket holds one token again, rounded up to a whole
        # second because that is all Retry-After can say.
        missing = (1.0 - tokens) * limit.refill_seconds / limit.capacity
        wait_seconds = max(1, math.ceil(missing - TOKEN_EPSILON))

    raise ApiError(
        429,
        code,
        f"Too many {bucket} attempts; try again in {wait_seconds}s",
        headers={"Retry-After": str(wait_seconds)},
    )


def reset(bucket: str, key: str) -> None:
    """Forget one key's bucket — used after a successful login (§8.2)."""
    with _lock:
        _buckets.pop((bucket, key), None)


def reset_all() -> None:
    """Drop every bucket; the test fixture calls this before each case (§10.1)."""
    with _lock:
        _buckets.clear()
