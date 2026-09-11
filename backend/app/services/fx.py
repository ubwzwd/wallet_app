"""Exchange rate service (03-backend-api.md §6, decision §8).

One rate direction only: a stored row means ``1 base = rate symbol``. Rates
come from Frankfurter and are cached in ``exchange_rates`` keyed by
(date, base, symbol); published history is never rewritten (decision §14.1).

Every public function takes the ``Session`` as its first argument and never
commits — the caller owns the transaction. The HTTP client is built by the
module level ``client_factory`` so tests can inject ``httpx.MockTransport``.
"""
import datetime as dt
import time
from bisect import bisect_right
from collections.abc import Callable, Iterable, Sequence
from decimal import ROUND_HALF_UP, Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import ApiError, ErrorCode
from app.models.exchange_rate import ExchangeRate

# Algorithm parameters, not deployment knobs (§6.2), hence module constants.
FX_MAX_BACKFILL_DAYS = 10       # decision §14.44 (03-12): past that, use the latest rate
FX_STALE_DAYS = 4               # a "latest" row older than this is refreshed (§6.2)
FX_FETCH_THROTTLE = dt.timedelta(hours=1)   # one /latest call per pair per hour (§14.1)

# Retries only make sense now that the client raises httpx errors instead of
# swallowing them into an HTTPException (§6.1, known issue M-04).
HTTP_RETRY_ATTEMPTS = 3
HTTP_RETRY_BACKOFF_SECONDS = 0.5

AMOUNT_QUANTUM = Decimal("0.0001")          # Numeric(18, 4), §6.2
RATE_QUANTUM = Decimal("0.00000001")        # Numeric(18, 8), §4.5

# (base, symbol) -> last time a /latest call was attempted, for the throttle.
_LAST_FETCH: dict[tuple[str, str], dt.datetime] = {}
# Supported currency names; a process-lifetime cache (§5.45).
_CURRENCIES: dict[str, str] | None = None


class FxUpstreamError(Exception):
    """Frankfurter could not be reached or answered with an error."""


def _default_client() -> httpx.Client:
    """The real Frankfurter client; replaced wholesale in tests."""
    return httpx.Client(
        base_url=settings.EXCHANGE_RATE_API_URL,
        timeout=settings.FX_HTTP_TIMEOUT_SECONDS,
    )


client_factory: Callable[[], httpx.Client] = _default_client


def reset_state() -> None:
    """Drop the process level throttle and currency caches (tests use this)."""
    global _CURRENCIES

    _LAST_FETCH.clear()
    _CURRENCIES = None


# ---------------------------------------------------------------------------
# Public API (03-backend-api.md §1.2)
# ---------------------------------------------------------------------------


def convert(
    db: Session, amount: Decimal, currency: str, to_currency: str, on: dt.date
) -> tuple[Decimal, Decimal, dt.date]:
    """Convert ``amount`` (in ``currency``) to ``to_currency`` using ``on``'s rate.

    Returns ``(amount_base, rate_used, rate_date)``; ``rate_date`` may be older
    than ``on`` when that day has no quotation (§6.2). Raises
    ``ApiError(503, fx_unavailable)`` when no rate can be found at all.
    """
    base, symbol = currency.upper(), to_currency.upper()
    if base == symbol:
        return amount, Decimal("1"), on

    cached = _cached_rate_on(db, base, symbol, on)
    if _within_window(cached, on):
        return _apply(amount, cached.rate, cached.date)

    try:
        _fetch_range(db, base, [symbol], on - dt.timedelta(days=FX_MAX_BACKFILL_DAYS), on)
    except FxUpstreamError:
        pass
    else:
        fetched = _cached_rate_on(db, base, symbol, on)
        if _within_window(fetched, on):
            return _apply(amount, fetched.rate, fetched.date)

    # Nothing inside the backfill window: fall back to the latest rate.
    try:
        rate, rate_date = latest_rate(db, base, symbol)
    except ApiError:
        if cached is None:
            raise
        # Upstream is down but the cache still holds something usable (§6.8).
        return _apply(amount, cached.rate, cached.date)
    return _apply(amount, rate, rate_date)


def latest_rate(db: Session, currency: str, to_currency: str) -> tuple[Decimal, dt.date]:
    """Latest usable rate and its quotation day, for balance conversion (§8).

    Uses the newest cached row; refreshes it from upstream when it is more than
    ``FX_STALE_DAYS`` old and the pair was not fetched within the last hour.
    """
    base, symbol = currency.upper(), to_currency.upper()
    if base == symbol:
        return Decimal("1"), _today()

    row = _cached_latest(db, base, symbol)
    if not _is_fresh(row) and not _throttled(base, symbol, row):
        try:
            _fetch_latest(db, base, [symbol])
        except FxUpstreamError:
            if row is None:
                raise _fx_unavailable(f"No exchange rate available for {base}->{symbol}") from None
        else:
            row = _cached_latest(db, base, symbol)

    if row is None:
        raise _fx_unavailable(f"No exchange rate available for {base}->{symbol}")
    return quantize_rate(row.rate), row.date


def latest_rates(
    db: Session, currency: str, to_currencies: Sequence[str]
) -> tuple[dict[str, Decimal], dt.date]:
    """Batch ``latest_rate`` for ``GET /rates/latest`` (§5.46): one upstream call.

    Returns the rate per symbol plus the newest quotation day among them.
    """
    base = currency.upper()
    symbols = [code.upper() for code in to_currencies]
    stale: list[str] = []
    for code in dict.fromkeys(symbols):
        if code == base:
            continue
        row = _cached_latest(db, base, code)
        if not _is_fresh(row) and not _throttled(base, code, row):
            stale.append(code)
    if stale:
        try:
            _fetch_latest(db, base, stale)
        except FxUpstreamError:
            pass  # latest_rate below decides between a stale row and 503

    rates: dict[str, Decimal] = {}
    days: list[dt.date] = []
    for symbol in symbols:
        rate, rate_date = latest_rate(db, base, symbol)
        rates[symbol] = rate
        days.append(rate_date)
    return rates, max(days)


def convert_many(
    db: Session, items: Sequence[tuple[Decimal, str, dt.date]], to_currency: str
) -> list[tuple[Decimal, Decimal, dt.date]]:
    """Batch version of ``convert``: at most one upstream call per currency (§6.3)."""
    base_currency = to_currency.upper()
    rows = list(items)
    if not rows:
        return []

    foreign = [
        (amount, currency.upper(), on)
        for amount, currency, on in rows
        if currency.upper() != base_currency
    ]
    if not foreign:
        return [(amount, Decimal("1"), on) for amount, _currency, on in rows]

    start = min(on for _amount, _currency, on in foreign)
    end = max(on for _amount, _currency, on in foreign)
    window_start = start - dt.timedelta(days=FX_MAX_BACKFILL_DAYS)

    currencies = sorted({currency for _amount, currency, _on in foreign})
    table = _load_rates(db, currencies, base_currency, window_start, end)

    for currency in currencies:
        wanted = [on for _amount, code, on in foreign if code == currency]
        if any(_pick(table.get(currency, ()), on) is None for on in wanted):
            try:
                _fetch_range(db, currency, [base_currency], window_start, end)
            except FxUpstreamError:
                continue
            table[currency] = _load_rates(
                db, [currency], base_currency, window_start, end
            ).get(currency, [])

    results: list[tuple[Decimal, Decimal, dt.date]] = []
    for amount, currency, on in rows:
        code = currency.upper()
        if code == base_currency:
            results.append((amount, Decimal("1"), on))
            continue
        hit = _pick(table.get(code, ()), on)
        if hit is None:
            rate, rate_date = latest_rate(db, code, base_currency)
            results.append(_apply(amount, rate, rate_date))
        else:
            results.append(_apply(amount, hit[1], hit[0]))
    return results


def warm_cache(
    db: Session, currencies: Iterable[str], base: str, start: dt.date, end: dt.date
) -> None:
    """Pull ``start..end`` for every ``currency -> base`` pair and upsert it.

    Rows already cached are left untouched (published history never changes,
    decision §14.1). Warming is best effort: upstream failures are swallowed,
    since callers resolve missing rates themselves.
    """
    target = base.upper()
    for currency in sorted({code.upper() for code in currencies}):
        if currency == target:
            continue
        try:
            _fetch_range(db, currency, [target], start, end)
        except FxUpstreamError:
            continue


def supported_currencies() -> dict[str, str]:
    """Frankfurter's currency code -> name map, cached for the process (§5.45)."""
    global _CURRENCIES

    if _CURRENCIES is not None:
        return _CURRENCIES
    try:
        payload = _get("/currencies", {})
    except FxUpstreamError as exc:
        raise _fx_unavailable("Failed to fetch the supported currency list") from exc
    _CURRENCIES = {str(code).upper(): str(name) for code, name in payload.items()}
    return _CURRENCIES


# ---------------------------------------------------------------------------
# Cache reads
# ---------------------------------------------------------------------------


def _cached_rate_on(db: Session, base: str, symbol: str, on: dt.date):
    """Newest cached row on or before ``on`` (02-database.md §1.10)."""
    stmt = (
        select(ExchangeRate.date, ExchangeRate.rate)
        .where(
            ExchangeRate.base == base,
            ExchangeRate.symbol == symbol,
            ExchangeRate.date <= on,
        )
        .order_by(ExchangeRate.date.desc())
        .limit(1)
    )
    return db.execute(stmt).first()


def _cached_latest(db: Session, base: str, symbol: str):
    """Newest cached row for the pair, whatever its date."""
    stmt = (
        select(ExchangeRate.date, ExchangeRate.rate, ExchangeRate.fetched_at)
        .where(ExchangeRate.base == base, ExchangeRate.symbol == symbol)
        .order_by(ExchangeRate.date.desc())
        .limit(1)
    )
    return db.execute(stmt).first()


def _load_rates(
    db: Session, bases: Sequence[str], symbol: str, start: dt.date, end: dt.date
) -> dict[str, list[tuple[dt.date, Decimal]]]:
    """All cached rows for ``bases -> symbol`` in ``start..end``, per base, by date."""
    stmt = (
        select(ExchangeRate.base, ExchangeRate.date, ExchangeRate.rate)
        .where(
            ExchangeRate.symbol == symbol,
            ExchangeRate.base.in_(list(bases)),
            ExchangeRate.date >= start,
            ExchangeRate.date <= end,
        )
        .order_by(ExchangeRate.base, ExchangeRate.date)
    )
    table: dict[str, list[tuple[dt.date, Decimal]]] = {}
    for base, day, rate in db.execute(stmt):
        table.setdefault(base, []).append((day, rate))
    return table


def _pick(
    rows: Sequence[tuple[dt.date, Decimal]], on: dt.date
) -> tuple[dt.date, Decimal] | None:
    """Newest row on or before ``on``, within the backfill window."""
    if not rows:
        return None
    index = bisect_right([day for day, _rate in rows], on)
    if index == 0:
        return None
    day, rate = rows[index - 1]
    if (on - day).days > FX_MAX_BACKFILL_DAYS:
        return None
    return day, rate


def _within_window(row, on: dt.date) -> bool:
    return row is not None and (on - row.date).days <= FX_MAX_BACKFILL_DAYS


def _is_fresh(row) -> bool:
    return row is not None and (_today() - row.date).days <= FX_STALE_DAYS


def _throttled(base: str, symbol: str, row=None) -> bool:
    """True when this pair was fetched less than an hour ago (decision §14.1)."""
    stamps = [
        stamp
        for stamp in (_LAST_FETCH.get((base, symbol)), getattr(row, "fetched_at", None))
        if stamp is not None
    ]
    if not stamps:
        return False
    return (_utcnow() - max(stamps)) < FX_FETCH_THROTTLE


# ---------------------------------------------------------------------------
# Upstream calls and cache writes
# ---------------------------------------------------------------------------


def _get(path: str, params: dict[str, str]) -> dict:
    """One Frankfurter GET with retries; raises ``FxUpstreamError`` on failure."""
    attempts = max(1, HTTP_RETRY_ATTEMPTS)
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with client_factory() as client:
                response = client.get(path, params=params)
            if response.status_code >= 500:
                response.raise_for_status()
            if response.is_error:
                # 4xx (an unknown currency, say) will not get better on a retry.
                raise FxUpstreamError(f"{path} returned {response.status_code}")
            return response.json()
        except httpx.HTTPError as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(HTTP_RETRY_BACKOFF_SECONDS * (2**attempt))
    raise FxUpstreamError(f"{path} failed after {attempts} attempts") from last_error


def _fetch_range(
    db: Session, base: str, symbols: Sequence[str], start: dt.date, end: dt.date
) -> None:
    """Fetch a whole date range in one call and upsert it, keeping existing rows.

    Frankfurter's range endpoint only returns days that have a quotation, so
    "fall back to the last trading day" needs no calendar of its own (§6.2).
    """
    payload = _get(
        f"/{start.isoformat()}..{end.isoformat()}",
        {"from": base, "to": ",".join(symbols)},
    )
    rows: list[tuple[dt.date, str, str, Decimal]] = []
    for day, quotes in (payload.get("rates") or {}).items():
        quotation_day = dt.date.fromisoformat(day)
        for symbol, value in (quotes or {}).items():
            rows.append((quotation_day, base, symbol.upper(), Decimal(str(value))))
    _upsert(db, rows, refresh=False)


def _fetch_latest(db: Session, base: str, symbols: Sequence[str]) -> None:
    """Fetch the latest published day for ``base -> symbols`` and refresh the cache."""
    now = _utcnow()
    for symbol in symbols:
        _LAST_FETCH[(base, symbol.upper())] = now
    payload = _get("/latest", {"from": base, "to": ",".join(symbols)})
    day = payload.get("date")
    if not day:
        raise FxUpstreamError("/latest returned no date")
    quotation_day = dt.date.fromisoformat(day)
    rows = [
        (quotation_day, base, symbol.upper(), Decimal(str(value)))
        for symbol, value in (payload.get("rates") or {}).items()
    ]
    _upsert(db, rows, refresh=True)


def _upsert(
    db: Session, rows: Sequence[tuple[dt.date, str, str, Decimal]], *, refresh: bool
) -> None:
    """Upsert rate rows on (date, base, symbol); ``refresh`` rewrites rate/fetched_at."""
    fetched_at = _utcnow()
    values = [
        {"date": day, "base": base, "symbol": symbol, "rate": rate, "fetched_at": fetched_at}
        for day, base, symbol, rate in rows
        if base != symbol and rate > 0
    ]
    if not values:
        return

    dialect = db.get_bind().dialect.name
    insert = sqlite_insert if dialect == "sqlite" else pg_insert
    stmt = insert(ExchangeRate.__table__).values(values)
    key = ["date", "base", "symbol"]
    if refresh:
        stmt = stmt.on_conflict_do_update(
            index_elements=key,
            set_={"rate": stmt.excluded.rate, "fetched_at": stmt.excluded.fetched_at},
        )
    else:
        stmt = stmt.on_conflict_do_nothing(index_elements=key)
    db.execute(stmt)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _apply(amount: Decimal, rate: Decimal, rate_date: dt.date) -> tuple[Decimal, Decimal, dt.date]:
    """Quantize as §6.2 demands: amount to 4 places, rate to 8, both HALF_UP."""
    rate_used = quantize_rate(rate)
    amount_base = (amount * rate_used).quantize(AMOUNT_QUANTUM, rounding=ROUND_HALF_UP)
    return amount_base, rate_used, rate_date


def quantize_rate(rate: Decimal) -> Decimal:
    return Decimal(rate).quantize(RATE_QUANTUM, rounding=ROUND_HALF_UP)


def _fx_unavailable(detail: str) -> ApiError:
    return ApiError(503, ErrorCode.FX_UNAVAILABLE, detail)


def _utcnow() -> dt.datetime:
    """Naive UTC, matching how timestamps are stored (02-database.md §7.2)."""
    return dt.datetime.now(dt.UTC).replace(tzinfo=None)


def _today() -> dt.date:
    return dt.datetime.now(dt.UTC).date()
