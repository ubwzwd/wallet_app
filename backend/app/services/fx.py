"""Exchange rate service (03-backend-api.md §6, decision §8).

One rate direction only: a stored row means ``1 base = rate symbol``. Rates
come from Frankfurter and are cached in ``exchange_rates`` keyed by
(date, base, symbol); published history is never rewritten (decision §14.1).

Every public function takes the ``Session`` as its first argument and never
commits — the caller owns the transaction. The HTTP client is built by the
module level ``client_factory`` so tests can inject ``httpx.MockTransport``;
the real factory hands out one pooled ``httpx.Client`` for the process.

Two rules this module had to pin down, since the docs leave them to it:

* **Degrading to a stale cache.** ``convert`` follows §6.2 literally: cache ->
  range fetch -> ``/latest`` -> ``ApiError(503, fx_unavailable)``. It never
  reaches around ``latest_rate`` for an old row of its own, so a pair with
  nothing cached fails loudly instead of quietly using a months-old rate. What
  ``latest_rate`` does return when upstream is down is the newest cached row
  whatever its age — that *is* step 4's "use the latest rate", and its
  ``rate_date`` is returned to every caller, so a consumer that cares about
  staleness (stats' ``rate_missing_count``, §6.3) can judge it. 02-database.md
  §6.8 leaves this choice to this file on purpose.
* **Upsert conflict action.** Backfills driven by ``convert`` /
  ``convert_many`` use ``DO UPDATE SET rate, fetched_at``, the write form
  02-database.md §1.10 specifies (published rates do not move, so in practice
  it only refreshes ``fetched_at``). ``warm_cache`` alone uses
  ``DO NOTHING``, because §1.2 says warming leaves existing rows untouched.
* **Throttling.** The one hour throttle (decision §14.1) only suppresses a
  request when the pair already has a cached row to serve — 02-database.md
  §6.8 words it as "库里有，但……"; an empty cache always retries, so one
  transient upstream blip cannot pin a pair to 503 for an hour. Inside a single
  ``latest_rates`` call that is not enough: a pair with no cached row would be
  asked again one by one after the batch call failed, so ``latest_rates`` marks
  the pairs it already asked for and the per symbol resolution skips them. That
  keeps §5.46's "0 or 1 upstream call" without touching the cross request
  throttle semantics.
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


_CLIENT: httpx.Client | None = None


def _default_client() -> httpx.Client:
    """The real Frankfurter client: one pooled instance, built on first use.

    Kept open for the life of the process so retries and successive requests
    reuse the connection and the TLS session. Replaced wholesale in tests.
    """
    global _CLIENT

    if _CLIENT is None or _CLIENT.is_closed:
        _CLIENT = httpx.Client(
            base_url=settings.EXCHANGE_RATE_API_URL,
            timeout=settings.FX_HTTP_TIMEOUT_SECONDS,
        )
    return _CLIENT


client_factory: Callable[[], httpx.Client] = _default_client


def reset_state() -> None:
    """Drop the process level throttle, currency and client caches (tests)."""
    global _CURRENCIES, _CLIENT

    _LAST_FETCH.clear()
    _CURRENCIES = None
    if _CLIENT is not None:
        _CLIENT.close()
        _CLIENT = None


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
        _fetch_range(
            db,
            base,
            [symbol],
            on - dt.timedelta(days=FX_MAX_BACKFILL_DAYS),
            on,
            refresh=True,
        )
    except FxUpstreamError:
        pass
    else:
        fetched = _cached_rate_on(db, base, symbol, on)
        if _within_window(fetched, on):
            return _apply(amount, fetched.rate, fetched.date)

    # Nothing inside the backfill window: step 4, the latest rate; when that
    # has nothing either it raises fx_unavailable, which is §6.2 step 5.
    rate, rate_date = latest_rate(db, base, symbol)
    return _apply(amount, rate, rate_date)


def latest_rate(db: Session, currency: str, to_currency: str) -> tuple[Decimal, dt.date]:
    """Latest usable rate and its quotation day, for balance conversion (§8).

    Uses the newest cached row; refreshes it from upstream when it is more than
    ``FX_STALE_DAYS`` old and the pair was not fetched within the last hour.
    """
    return _latest_rate(db, currency.upper(), to_currency.upper(), frozenset())


def _latest_rate(
    db: Session, base: str, symbol: str, attempted: frozenset[str] | set[str]
) -> tuple[Decimal, dt.date]:
    """``latest_rate`` with the symbols upstream was already asked for this call.

    ``attempted`` holds the symbols a caller (``latest_rates``) already sent to
    ``/latest`` in this very call — successfully or not. They are never asked
    again here, so one request never produces two upstream calls for the same
    pair (§5.46). It is per call state only: the next request starts empty and
    the cross request rule stays exactly the one hour throttle of §6.2/§14.1.
    """
    if base == symbol:
        return Decimal("1"), _today()

    row = _cached_latest(db, base, symbol)
    if not _is_fresh(row) and symbol not in attempted and not _throttled(base, symbol, row):
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

    Returns the rate per symbol plus the quotation day the response may claim:
    the oldest day among the real quotations, so the single ``date`` field never
    overstates how fresh any rate in the map is. ``base`` itself, if asked for,
    contributes a rate of 1 but no day — it is not a quotation (§5.46).
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
    attempted: frozenset[str] = frozenset()
    if stale:
        attempted = frozenset(stale)    # asked now; do not ask again below
        try:
            _fetch_latest(db, base, stale)
        except FxUpstreamError:
            pass  # the loop below decides between a stale row and 503

    rates: dict[str, Decimal] = {}
    days: list[dt.date] = []
    for symbol in symbols:
        rate, rate_date = _latest_rate(db, base, symbol, attempted)
        rates[symbol] = quantize_rate(rate)     # §5.46 renders 8 decimals
        if symbol != base:
            days.append(rate_date)
    return rates, min(days) if days else _today()


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
                _fetch_range(
                    db, currency, [base_currency], window_start, end, refresh=True
                )
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
            # refresh=False: warming never rewrites a row that is already here.
            _fetch_range(db, currency, [target], start, end, refresh=False)
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


def _throttled(base: str, symbol: str, row) -> bool:
    """True when this pair was fetched less than an hour ago (decision §14.1).

    Only a pair that already has a cached row can be throttled: 02-database.md
    §6.8 words the rule as "库里有，但…… `fetched_at` 距今 ≥ 1 小时". With an
    empty cache there is nothing to serve instead, so the request always goes
    out and a failed attempt cannot pin the pair to 503 for an hour.
    """
    if row is None:
        return False
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
            client = client_factory()
            response = client.get(path, params=params)
            if response.status_code >= 500:
                response.raise_for_status()
            if response.is_error:
                # 4xx (an unknown currency, say) will not get better on a retry.
                raise FxUpstreamError(f"{path} returned {response.status_code}")
            try:
                return response.json()
            except ValueError as exc:
                # A 200 carrying HTML (a proxy or captive portal) is an upstream
                # problem, not a bug: §5.46/§5.47 want 503, not 500.
                raise FxUpstreamError(f"{path} returned a non-JSON body") from exc
        except httpx.HTTPError as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(HTTP_RETRY_BACKOFF_SECONDS * (2**attempt))
    raise FxUpstreamError(f"{path} failed after {attempts} attempts") from last_error


def _fetch_range(
    db: Session,
    base: str,
    symbols: Sequence[str],
    start: dt.date,
    end: dt.date,
    *,
    refresh: bool,
) -> None:
    """Fetch a whole date range in one call and upsert it.

    Frankfurter's range endpoint only returns days that have a quotation, so
    "fall back to the last trading day" needs no calendar of its own (§6.2).
    ``refresh`` picks the conflict action: ``True`` is 02-database.md §1.10's
    ``DO UPDATE SET rate, fetched_at`` (backfills), ``False`` leaves existing
    rows alone (``warm_cache``, §1.2).
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
    _upsert(db, rows, refresh=refresh)


def _fetch_latest(db: Session, base: str, symbols: Sequence[str]) -> None:
    """Fetch the latest published day for ``base -> symbols`` and refresh the cache."""
    # The attempt is stamped before the call, so a pair that already has a row
    # to serve is not asked again for an hour; ``_throttled`` ignores the stamp
    # when the cache is empty, so a failure here never suppresses a retry.
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
