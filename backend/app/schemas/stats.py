"""Stats schemas (03-backend-api.md §5.35-§5.36).

Money fields are ``Decimal`` quantized to 4 decimal places (§4.5); see the
``Amount`` annotated type. ``share`` is a plain ``float`` (§5.35: "浮点数保留
4 位") — it is a display ratio, not money, so it does not go through the
``Decimal`` quantizing machinery the other two schema modules use.
"""
from __future__ import annotations

import datetime as dt
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from pydantic import AfterValidator

from app.schemas.common import ApiModel

AMOUNT_QUANTUM = Decimal("0.0001")


def _quantize_amount(value: Decimal) -> Decimal:
    return value.quantize(AMOUNT_QUANTUM, rounding=ROUND_HALF_UP)


Amount = Annotated[Decimal, AfterValidator(_quantize_amount)]


class SubStat(ApiModel):
    """One entry of a ``CategoryStat``'s ``children`` (§5.35): an l2 breakdown."""

    code: str | None
    name_zh: str
    name_en: str
    amount: Amount
    count: int


class CategoryStat(ApiModel):
    """One l1 entry of §5.35's ``expense`` / ``income`` arrays."""

    code: str
    name_zh: str
    name_en: str
    amount: Amount
    share: float
    count: int
    children: list[SubStat]


class SummaryResponse(ApiModel):
    """§5.35 response."""

    month: str
    base_currency: str
    expense_total: Amount
    income_total: Amount
    net: Amount
    expense: list[CategoryStat]
    income: list[CategoryStat]
    refund_total: Amount
    rate_missing_count: int


class MonthExpense(ApiModel):
    """One entry of §5.36's ``months[]``."""

    month: str
    expense: Amount


class TrendResponse(ApiModel):
    """§5.36 response — expense only (decision §14.52 B20)."""

    base_currency: str
    months: list[MonthExpense]
    rate_missing_count: int
