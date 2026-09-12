"""Valuation helpers: per-row conversion, account balances, list summary.

This is the read-time arithmetic of 03-backend-api.md §5.20 and §5.25
(decisions §8, §14.2, §14.50, §14.52 A14). Nothing here writes business data
and nothing commits — the endpoints own the transaction; ``fx`` may upsert
cached rate rows as a side effect of converting, which is its own concern.

Two rules shape every function in this module:

* **A missing rate degrades, it never fails.** ``fx.convert_many`` raises
  ``ApiError(503, fx_unavailable)`` as soon as one currency has no rate at
  all, which would take a whole account list or a whole statistic down with
  it. ``convert_rows`` catches that, retries currency by currency, and hands
  back ``None`` for the rows it still cannot value. Every caller turns those
  ``None`` rows into a ``rate_missing_count`` instead (§5.20, §5.25, §6.3).
* **Dates follow §6.4.** Transaction rows are valued on their own
  ``occurred_at``; an account's ``balance_base`` uses the *latest* rate.
"""
import datetime as dt
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.errors import ApiError, ErrorCode
from app.models.finance_source import FinanceSource
from app.models.ledger import Ledger
from app.models.transaction import Transaction
from app.services import fx
from app.services.fx import RATE_QUANTUM, quantize_rate  # one rate quantizer for the whole app

# Money is Numeric(18, 4) everywhere (03 §4.5); the Numeric(18, 8) rate quantum is fx.RATE_QUANTUM.
AMOUNT_QUANTUM = Decimal("0.0001")
ZERO = Decimal("0.0000")

# Account types that are debt rather than an asset (decision §14.50).
CREDIT_TYPE = "credit"


@dataclass(frozen=True)
class Valuation:
    """One row converted to the ledger's base currency (§5.25)."""

    amount_base: Decimal
    rate_used: Decimal
    rate_date: dt.date


@dataclass
class SourceBalance:
    """The five balance fields §5.20 puts on every account row.

    ``balance`` is always a number: rows that could not be converted into the
    account currency are simply left out of it and counted in
    ``rate_missing_count`` instead. ``balance_base`` / ``balance_rate`` /
    ``balance_rate_date`` are ``None`` together when the account currency
    cannot be converted to the ledger base currency at all (§5.20's last
    paragraph).
    """

    balance: Decimal
    balance_base: Decimal | None
    balance_rate: Decimal | None
    balance_rate_date: dt.date | None
    rate_missing_count: int


def quantize_amount(value: Decimal) -> Decimal:
    """Round to the 4 decimals every money column and response field uses."""
    return Decimal(value).quantize(AMOUNT_QUANTUM, rounding=ROUND_HALF_UP)


def convert_rows(
    db: Session,
    items: Sequence[tuple[Decimal, str, dt.date]],
    to_currency: str,
) -> list[tuple[Decimal, Decimal, dt.date] | None]:
    """``fx.convert_many`` that yields ``None`` instead of raising (§6.3).

    The batch call is tried first, which is the fast path and the only one
    that runs when every currency has rates. If it raises ``fx_unavailable``,
    the currencies are retried one at a time so that one unknown currency does
    not cost the caller every other row; the rows of a currency that still has
    no rate come back as ``None``.
    """
    rows = list(items)
    if not rows:
        return []

    try:
        return list(fx.convert_many(db, rows, to_currency))
    except ApiError as exc:
        if exc.code != ErrorCode.FX_UNAVAILABLE:
            raise

    results: list[tuple[Decimal, Decimal, dt.date] | None] = [None] * len(rows)
    by_currency: dict[str, list[int]] = {}
    for index, (_amount, currency, _on) in enumerate(rows):
        by_currency.setdefault(currency.upper(), []).append(index)

    for currency, indexes in by_currency.items():
        try:
            converted = fx.convert_many(db, [rows[i] for i in indexes], to_currency)
        except ApiError as exc:
            if exc.code != ErrorCode.FX_UNAVAILABLE:
                raise
            continue    # leave this currency's rows as None -> rate_missing_count
        for index, value in zip(indexes, converted, strict=True):
            results[index] = value
    return results


def value_transactions(
    db: Session, base_currency: str, rows: Sequence[Transaction]
) -> list[Valuation | None]:
    """Value every row on its own ``occurred_at`` (§5.25, §6.4, decision §8).

    Positionally aligned with ``rows``; a row whose rate is unavailable is
    ``None``, which §5.25 renders as three ``null`` fields on that row.
    """
    converted = convert_rows(
        db,
        [(row.amount, row.currency, row.occurred_at) for row in rows],
        base_currency,
    )
    return [
        None if value is None else Valuation(quantize_amount(value[0]), value[1], value[2])
        for value in converted
    ]


def source_balances(
    db: Session, ledger: Ledger, sources: Sequence[FinanceSource]
) -> dict[uuid.UUID, SourceBalance]:
    """Balance and base-currency balance per account (§5.20, decisions §14.2, §8).

    ``balance`` is ``opening_balance`` plus every transaction of the account
    converted into the account's own currency on its ``occurred_at``. One
    ``GROUP BY source_id, currency, occurred_at`` query pulls the subtotals for
    all accounts at once and one ``fx.convert_many`` per distinct account
    currency converts them, so the number of upstream calls depends on how many
    currencies exist, never on how many transactions do (§5.20, §6.3).
    """
    accounts = list(sources)
    if not accounts:
        return {}

    by_id = {source.id: source for source in accounts}
    groups = _amount_groups(db, ledger, list(by_id))

    # One conversion batch per target currency; a group already in the account
    # currency still goes through it (fx returns it unchanged, rate 1).
    per_target: dict[str, list[tuple[uuid.UUID, Decimal, str, dt.date, int]]] = {}
    for source_id, currency, occurred_at, total, count in groups:
        target = by_id[source_id].default_currency.upper()
        per_target.setdefault(target, []).append(
            (source_id, total, currency.upper(), occurred_at, count)
        )

    totals: dict[uuid.UUID, Decimal] = {source.id: ZERO for source in accounts}
    missing: dict[uuid.UUID, int] = {source.id: 0 for source in accounts}
    for target, entries in per_target.items():
        converted = convert_rows(
            db, [(total, currency, on) for _sid, total, currency, on, _n in entries], target
        )
        for (source_id, _total, _currency, _on, count), value in zip(
            entries, converted, strict=True
        ):
            if value is None:
                missing[source_id] += count
                continue
            totals[source_id] += value[0]

    balances: dict[uuid.UUID, SourceBalance] = {}
    base_rates: dict[str, tuple[Decimal, dt.date] | None] = {}
    for source in accounts:
        balance = quantize_amount(source.opening_balance + totals[source.id])
        rate = _base_rate(
            db, source.default_currency.upper(), ledger.base_currency.upper(), base_rates
        )
        if rate is None:
            balances[source.id] = SourceBalance(
                balance=balance,
                balance_base=None,
                balance_rate=None,
                balance_rate_date=None,
                rate_missing_count=missing[source.id],
            )
            continue
        rate_used, rate_date = rate
        balances[source.id] = SourceBalance(
            balance=balance,
            balance_base=quantize_amount(balance * rate_used),
            balance_rate=rate_used,
            balance_rate_date=rate_date,
            rate_missing_count=missing[source.id],
        )
    return balances


def net_worth(
    sources: Sequence[FinanceSource], balances: dict[uuid.UUID, SourceBalance]
) -> tuple[Decimal | None, Decimal | None, Decimal | None]:
    """``(assets, liabilities, net_worth)`` over the non-archived accounts (§14.50).

    Credit cards are the liability side and their balance is already negative
    (decision §14.52 A13), so the net worth is a sum, not a difference.
    Archived accounts never count, even when the caller asked for them.
    All three are ``None`` when any counted account has no ``balance_base``:
    §5.20 would rather say "unknown" than publish a total that silently
    dropped an account.
    """
    assets = ZERO
    liabilities = ZERO
    for source in sources:
        if source.archived:
            continue
        balance = balances.get(source.id)
        if balance is None:
            continue
        if balance.balance_base is None:
            return None, None, None
        if source.type == CREDIT_TYPE:
            liabilities += balance.balance_base
        else:
            assets += balance.balance_base
    return (
        quantize_amount(assets),
        quantize_amount(liabilities),
        quantize_amount(assets + liabilities),
    )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _amount_groups(
    db: Session, ledger: Ledger, source_ids: Sequence[uuid.UUID]
) -> list[tuple[uuid.UUID, str, dt.date, Decimal, int]]:
    """``(source_id, currency, occurred_at, sum(amount), count)`` per group (§5.20)."""
    stmt = (
        select(
            Transaction.source_id,
            Transaction.currency,
            Transaction.occurred_at,
            func.sum(Transaction.amount),
            func.count(),
        )
        .where(
            Transaction.ledger_id == ledger.id,
            Transaction.source_id.in_(list(source_ids)),
        )
        .group_by(Transaction.source_id, Transaction.currency, Transaction.occurred_at)
    )
    return [
        (source_id, currency, occurred_at, quantize_amount(Decimal(str(total))), int(count))
        for source_id, currency, occurred_at, total, count in db.execute(stmt)
    ]


def _base_rate(
    db: Session,
    currency: str,
    base_currency: str,
    cache: dict[str, tuple[Decimal, dt.date] | None],
) -> tuple[Decimal, dt.date] | None:
    """Latest ``currency -> base_currency`` rate, memoized; ``None`` when unavailable.

    An account whose currency *is* the base currency converts at 1 on today's
    date — §5.20 spells that case out so the response never shows a stale
    quotation day for a conversion that did not happen.
    """
    if currency in cache:
        return cache[currency]
    if currency == base_currency:
        result: tuple[Decimal, dt.date] | None = (
            quantize_rate(Decimal("1")),
            utcnow().date(),
        )
    else:
        try:
            rate, rate_date = fx.latest_rate(db, currency, base_currency)
            result = (quantize_rate(rate), rate_date)
        except ApiError as exc:
            if exc.code != ErrorCode.FX_UNAVAILABLE:
                raise
            result = None
    cache[currency] = result
    return result
