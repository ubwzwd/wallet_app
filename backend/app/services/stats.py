"""Monthly statistics: the category summary and the expense trend.

03-backend-api.md §5.35 / §5.36, decisions §7, §8 and §14.52 B20. Both
functions share one set of rules, so they share the aggregation shape too:

* transfers never count, in either leg (decision §7);
* expenses are reported **positive** (``abs(amount)``);
* a refund reduces its **own** category in its **own** month — a September
  refund of an August purchase moves the September number, never August's
  (decision §1.1). A category refunded past zero is returned negative, on
  purpose (decision §14.44 of 03-10);
* every amount is converted with the row's own ``occurred_at`` rate (§6.4),
  and rows whose rate cannot be found are skipped and counted in
  ``rate_missing_count`` rather than failing the request (§6.3).

The aggregation is one ``GROUP BY`` per call: grouping by
``(kind, category, currency, occurred_at)`` collapses a month of rows into a
handful of subtotals, and those subtotals — not the individual rows — are what
gets converted, so the conversion cost follows the number of
(currency, day) pairs, not the number of transactions.

Two details the doc leaves to this module:

* ``expense_total`` is the sum of the categories as returned, i.e. already net
  of refunds. That is what makes ``share`` add up to 1 and what makes
  ``net = income_total - expense_total`` reflect the refunds §7 says have to
  be deducted; ``refund_total`` is published next to it so the interface can
  still say "refunds of ¥82.98 already deducted".
* a refund adds to its category's ``count`` (it is a transaction of that
  category in that month) while subtracting from its ``amount``.

Amounts stay ``Decimal`` in the returned dicts; rendering them as 4-decimal
strings is the schema's job (§4.5).
"""
import datetime as dt
from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import categories
from app.models.ledger import Ledger
from app.models.transaction import Transaction
from app.services.valuation import ZERO, convert_rows, quantize_amount

# The "level 1 but no level 2" child row of §5.35.
UNSPECIFIED_NAME_ZH = "未细分"
UNSPECIFIED_NAME_EN = "Unspecified"

# ``share`` is a plain float with 4 decimals (§5.35), not a Decimal.
SHARE_DIGITS = 4

# Kinds that reach a statistic at all; transfers are excluded in SQL (§7).
COUNTED_KINDS = ("expense", "income", "refund")


@dataclass
class ChildTotals:
    """One level-2 subtotal inside a ``_Bucket`` while it is being accumulated."""

    amount: Decimal = ZERO
    count: int = 0


@dataclass
class _Bucket:
    """One level-1 category while it is being accumulated."""

    amount: Decimal = ZERO
    count: int = 0
    children: dict[str | None, ChildTotals] = field(default_factory=dict)

    def add(self, l2: str | None, amount: Decimal, count: int) -> None:
        self.amount += amount
        self.count += count
        child = self.children.setdefault(l2, ChildTotals())
        child.amount += amount
        child.count += count


def summary(db: Session, ledger: Ledger, month: dt.date) -> dict:
    """Expense / income by level-1 category for ``month`` (§5.35).

    ``month`` is any day inside the month of interest; only its year and month
    are used. Returns the §5.35 body with ``Decimal`` amounts.
    """
    start, end = month_bounds(month)
    base_currency = ledger.base_currency.upper()

    expense: dict[str, _Bucket] = {}
    income: dict[str, _Bucket] = {}
    refund_total = ZERO
    rate_missing_count = 0

    groups = _category_groups(db, ledger, start, end)
    converted = convert_rows(
        db, [(total, currency, on) for _k, _l1, _l2, currency, on, total, _n in groups],
        base_currency,
    )
    for group, value in zip(groups, converted, strict=True):
        kind, l1, l2, _currency, _on, _total, count = group
        if value is None:
            rate_missing_count += count
            continue
        amount_base = quantize_amount(value[0])
        if kind == "expense":
            expense.setdefault(l1, _Bucket()).add(l2, abs(amount_base), count)
        elif kind == "refund":
            # A refund carries its own category and deducts from it (§7).
            refund_total += amount_base
            expense.setdefault(l1, _Bucket()).add(l2, -amount_base, count)
        elif kind == "income":
            income.setdefault(l1, _Bucket()).add(l2, amount_base, count)

    expense_total = quantize_amount(sum((b.amount for b in expense.values()), ZERO))
    income_total = quantize_amount(sum((b.amount for b in income.values()), ZERO))

    return {
        "month": f"{start.year:04d}-{start.month:02d}",
        "base_currency": base_currency,
        "expense_total": expense_total,
        "income_total": income_total,
        "net": quantize_amount(income_total - expense_total),
        "expense": _render(expense, expense_total),
        "income": _render(income, income_total),
        "refund_total": quantize_amount(refund_total),
        "rate_missing_count": rate_missing_count,
    }


def trend(db: Session, ledger: Ledger, months: int, end: dt.date) -> dict:
    """Expense per month for the ``months`` months ending with ``end`` (§5.36).

    Expenses only (decision §14.52 B20): each expense contributes its
    absolute value and each refund deducts from the month it actually landed
    in — the same rule ``summary`` applies per category. A month with a
    refund of an earlier month's purchase and no expense of its own is
    therefore reported **negative**, not clamped to ``0.0000`` (the same call
    as a category refunded past zero — decision §14.44 of 03-10, same
    reading here). Months without a single transaction are present with
    ``0.0000`` so the front end never has to fill holes.

    Raises ``ValueError`` for a non-positive ``months``: the endpoint already
    bounds the query parameter to 1..36 (§5.36), but a service function
    should still fail honestly rather than build an empty or backwards
    window when called some other way.
    """
    if months <= 0:
        raise ValueError("months must be a positive number of months")

    base_currency = ledger.base_currency.upper()
    last = end.replace(day=1)
    sequence = [add_months(last, offset) for offset in range(-(months - 1), 1)]
    window_start = sequence[0]
    _, window_end = month_bounds(sequence[-1])

    totals: dict[tuple[int, int], Decimal] = {(m.year, m.month): ZERO for m in sequence}
    rate_missing_count = 0

    groups = _kind_groups(db, ledger, window_start, window_end, ("expense", "refund"))
    converted = convert_rows(
        db, [(total, currency, on) for _k, currency, on, total, _n in groups], base_currency
    )
    for group, value in zip(groups, converted, strict=True):
        kind, _currency, on, _total, count = group
        key = (on.year, on.month)
        if key not in totals:
            continue
        if value is None:
            rate_missing_count += count
            continue
        amount_base = quantize_amount(value[0])
        totals[key] += abs(amount_base) if kind == "expense" else -amount_base

    return {
        "base_currency": base_currency,
        "months": [
            {
                "month": f"{m.year:04d}-{m.month:02d}",
                "expense": quantize_amount(totals[(m.year, m.month)]),
            }
            for m in sequence
        ],
        "rate_missing_count": rate_missing_count,
    }


# ---------------------------------------------------------------------------
# Month arithmetic
# ---------------------------------------------------------------------------


def month_bounds(month: dt.date) -> tuple[dt.date, dt.date]:
    """First and last day of the month ``month`` falls in."""
    start = month.replace(day=1)
    return start, add_months(start, 1) - dt.timedelta(days=1)


def add_months(month: dt.date, offset: int) -> dt.date:
    """First day of the month ``offset`` months away from ``month``'s."""
    index = (month.year * 12 + month.month - 1) + offset
    return dt.date(index // 12, index % 12 + 1, 1)


# ---------------------------------------------------------------------------
# Aggregation and rendering
# ---------------------------------------------------------------------------


def _category_groups(
    db: Session, ledger: Ledger, start: dt.date, end: dt.date
) -> list[tuple[str, str, str | None, str, dt.date, Decimal, int]]:
    """``(kind, l1, l2, currency, occurred_at, sum, count)`` for the window (§5.35)."""
    stmt = (
        select(
            Transaction.kind,
            Transaction.category_l1,
            Transaction.category_l2,
            Transaction.currency,
            Transaction.occurred_at,
            func.sum(Transaction.amount),
            func.count(),
        )
        .where(
            Transaction.ledger_id == ledger.id,
            Transaction.occurred_at >= start,
            Transaction.occurred_at <= end,
            Transaction.kind.in_(COUNTED_KINDS),
        )
        .group_by(
            Transaction.kind,
            Transaction.category_l1,
            Transaction.category_l2,
            Transaction.currency,
            Transaction.occurred_at,
        )
    )
    return [
        (kind, l1, l2, currency, on, quantize_amount(Decimal(str(total))), int(count))
        for kind, l1, l2, currency, on, total, count in db.execute(stmt)
    ]


def _kind_groups(
    db: Session, ledger: Ledger, start: dt.date, end: dt.date, kinds: Sequence[str]
) -> list[tuple[str, str, dt.date, Decimal, int]]:
    """``(kind, currency, occurred_at, sum, count)`` for the window (§5.36).

    ``occurred_at`` is part of the key, so the month each subtotal belongs to
    is read off it without a dialect-specific date truncation.
    """
    stmt = (
        select(
            Transaction.kind,
            Transaction.currency,
            Transaction.occurred_at,
            func.sum(Transaction.amount),
            func.count(),
        )
        .where(
            Transaction.ledger_id == ledger.id,
            Transaction.occurred_at >= start,
            Transaction.occurred_at <= end,
            Transaction.kind.in_(list(kinds)),
        )
        .group_by(Transaction.kind, Transaction.currency, Transaction.occurred_at)
    )
    return [
        (kind, currency, on, quantize_amount(Decimal(str(total))), int(count))
        for kind, currency, on, total, count in db.execute(stmt)
    ]


def _render(buckets: dict[str, _Bucket], total: Decimal) -> list[dict]:
    """Level-1 rows, biggest first, zero-amount categories dropped (§5.35)."""
    rows = []
    for code, bucket in buckets.items():
        if bucket.amount == 0:
            continue
        category = categories.find(code)
        names = {child.code: child for child in (category.children if category else ())}
        rows.append(
            {
                "code": code,
                "name_zh": category.name_zh if category else code,
                "name_en": category.name_en if category else code,
                "amount": quantize_amount(bucket.amount),
                "share": _share(bucket.amount, total),
                "count": bucket.count,
                "children": _render_children(bucket, names),
            }
        )
    _sort_by_amount_then_code(rows)
    return rows


def _render_children(bucket: _Bucket, names: dict[str, categories.Category]) -> list[dict]:
    """Level-2 rows of one category; ``code: null`` is the unspecified part."""
    children = []
    for code, totals in bucket.children.items():
        child = names.get(code) if code is not None else None
        children.append(
            {
                "code": code,
                "name_zh": child.name_zh if child else (code or UNSPECIFIED_NAME_ZH),
                "name_en": child.name_en if child else (code or UNSPECIFIED_NAME_EN),
                "amount": quantize_amount(totals.amount),
                "count": totals.count,
            }
        )
    _sort_by_amount_then_code(children)
    return children


def _sort_by_amount_then_code(rows: list[dict]) -> None:
    """Amount descending, ``code`` ascending as a tiebreaker, in place.

    Two categories can land on the same amount (most often two all-zero
    ``0.0000`` rows before they are filtered, or a tie from real data); without
    a deterministic secondary key the response order would depend on
    dict-iteration order, which Python does not guarantee across a rebuild of
    the same aggregation. ``code`` is ``None`` for the level-2 "unspecified"
    row, which sorts before every real code.
    """
    rows.sort(key=lambda row: (-row["amount"], row["code"] or ""))


def _share(amount: Decimal, total: Decimal) -> float:
    """``amount / total`` as a 4-decimal float; 0 when there is no total (§5.35)."""
    if total == 0:
        return 0.0
    return round(float(amount / total), SHARE_DIGITS)
