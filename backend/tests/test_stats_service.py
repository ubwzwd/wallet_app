"""Statistics service tests (03-backend-api.md §5.35, §5.36, decision §7).

Row helpers come from ``test_valuation``: both modules belong to this service
and there is no shared factory yet. Amounts stay in CNY (the ledger base) so
every expected number is exact; the cross-currency and missing-rate paths are
exercised through ``valuation`` and once more here for ``rate_missing_count``.
"""
import datetime as dt
from decimal import Decimal

import pytest

from app.services.stats import add_months, month_bounds, summary, trend
from tests.test_valuation import make_source, make_tx

AUG = dt.date(2026, 8, 15)
SEP = dt.date(2026, 9, 10)


@pytest.fixture()
def book(db, user_factory, ledger_factory):
    """A CNY ledger, its owner and one checking account."""
    user = user_factory()
    ledger = ledger_factory(user, base_currency="CNY")
    source = make_source(db, ledger, user)
    return ledger, user, source


# ---------------------------------------------------------------------------
# Month arithmetic
# ---------------------------------------------------------------------------


def test_month_bounds_and_add_months_cross_year_ends():
    assert month_bounds(dt.date(2026, 2, 17)) == (dt.date(2026, 2, 1), dt.date(2026, 2, 28))
    assert month_bounds(dt.date(2026, 12, 31)) == (dt.date(2026, 12, 1), dt.date(2026, 12, 31))
    assert add_months(dt.date(2026, 1, 1), -1) == dt.date(2025, 12, 1)
    assert add_months(dt.date(2026, 12, 1), 1) == dt.date(2027, 1, 1)


# ---------------------------------------------------------------------------
# summary
# ---------------------------------------------------------------------------


def test_summary_groups_by_category_with_shares_in_descending_order(db, book):
    ledger, user, source = book
    make_tx(db, ledger, source, user, amount="-200.0000", occurred_at=SEP, category_l2="lunch")
    make_tx(db, ledger, source, user, amount="-100.0000", occurred_at=SEP, category_l2="dinner")
    make_tx(db, ledger, source, user, amount="-100.0000", occurred_at=SEP, category_l1="transport")
    make_tx(
        db, ledger, source, user, kind="income", category_l1="salary",
        category_l2="base_salary", amount="1000.0000", occurred_at=SEP,
    )

    result = summary(db, ledger, SEP)

    assert result["month"] == "2026-09"
    assert result["base_currency"] == "CNY"
    assert result["expense_total"] == Decimal("400.0000")
    assert result["income_total"] == Decimal("1000.0000")
    assert result["net"] == Decimal("600.0000")
    assert [row["code"] for row in result["expense"]] == ["food", "transport"]
    food, transport = result["expense"]
    assert food["amount"] == Decimal("300.0000")
    assert food["name_zh"] == "餐饮"
    assert food["name_en"] == "Food & Dining"
    assert food["share"] == 0.75
    assert food["count"] == 2
    assert [child["code"] for child in food["children"]] == ["lunch", "dinner"]
    assert food["children"][0] == {
        "code": "lunch",
        "name_zh": "午餐",
        "name_en": "Lunch",
        "amount": Decimal("200.0000"),
        "count": 1,
    }
    assert transport["share"] == 0.25
    assert result["income"][0]["share"] == 1.0
    assert result["income"][0]["name_zh"] == "工资"
    assert result["refund_total"] == Decimal("0.0000")
    assert result["rate_missing_count"] == 0


def test_summary_puts_rows_without_a_second_level_under_a_null_child(db, book):
    ledger, user, source = book
    make_tx(db, ledger, source, user, amount="-200.0000", occurred_at=SEP)
    make_tx(db, ledger, source, user, amount="-100.0000", occurred_at=SEP, category_l2="lunch")

    food = summary(db, ledger, SEP)["expense"][0]

    assert [child["code"] for child in food["children"]] == [None, "lunch"]
    assert food["children"][0]["name_zh"] == "未细分"
    assert food["children"][0]["name_en"] == "Unspecified"
    assert food["children"][0]["amount"] == Decimal("200.0000")


def test_summary_deducts_a_refund_in_its_own_month_not_the_purchase_month(db, book):
    """Decision §1.1: a September refund moves September, August stays put."""
    ledger, user, source = book
    purchase = make_tx(
        db, ledger, source, user, amount="-100.0000", occurred_at=AUG, category_l2="lunch"
    )
    make_tx(db, ledger, source, user, amount="-500.0000", occurred_at=SEP, category_l1="transport")
    make_tx(
        db, ledger, source, user, kind="refund", amount="30.0000", occurred_at=SEP,
        category_l2="lunch", refund_of=purchase.id,
    )

    august = summary(db, ledger, AUG)
    september = summary(db, ledger, SEP)

    assert august["expense_total"] == Decimal("100.0000")
    assert august["refund_total"] == Decimal("0.0000")
    assert september["expense_total"] == Decimal("470.0000")
    assert september["refund_total"] == Decimal("30.0000")
    food = next(row for row in september["expense"] if row["code"] == "food")
    assert food["amount"] == Decimal("-30.0000")
    assert food["count"] == 1
    assert food["children"][0] == {
        "code": "lunch",
        "name_zh": "午餐",
        "name_en": "Lunch",
        "amount": Decimal("-30.0000"),
        "count": 1,
    }
    # A negative category sorts below the positive one, and shares stay signed.
    assert [row["code"] for row in september["expense"]] == ["transport", "food"]


def test_summary_drops_a_category_refunded_back_to_zero(db, book):
    ledger, user, source = book
    purchase = make_tx(db, ledger, source, user, amount="-50.0000", occurred_at=SEP)
    make_tx(
        db, ledger, source, user, kind="refund", amount="50.0000", occurred_at=SEP,
        refund_of=purchase.id,
    )

    result = summary(db, ledger, SEP)

    assert result["expense"] == []
    assert result["expense_total"] == Decimal("0.0000")
    assert result["refund_total"] == Decimal("50.0000")
    assert result["net"] == Decimal("0.0000")


def test_summary_ignores_transfers_and_other_months(db, book):
    ledger, user, source = book
    other = make_source(db, ledger, user, name="现金", type_="cash")
    make_tx(db, ledger, source, user, amount="-100.0000", occurred_at=SEP)
    make_tx(db, ledger, source, user, amount="-999.0000", occurred_at=AUG)
    make_tx(
        db, ledger, source, user, kind="transfer", amount="-400.0000", occurred_at=SEP,
        transfer_role="out", transfer_subtype="plain", counterparty="老婆",
    )
    make_tx(
        db, ledger, other, user, kind="transfer", amount="400.0000", occurred_at=SEP,
        transfer_role="in", transfer_subtype="plain", counterparty="老婆",
    )

    result = summary(db, ledger, SEP)

    assert result["expense_total"] == Decimal("100.0000")
    assert [row["code"] for row in result["expense"]] == ["food"]
    assert result["income"] == []


def test_summary_of_an_empty_month_has_zero_totals_and_zero_shares(db, book):
    ledger, _user, _source = book

    result = summary(db, ledger, SEP)

    assert result["expense_total"] == Decimal("0.0000")
    assert result["income_total"] == Decimal("0.0000")
    assert result["net"] == Decimal("0.0000")
    assert result["expense"] == [] and result["income"] == []
    assert result["rate_missing_count"] == 0


def test_summary_converts_foreign_rows_and_counts_the_ones_it_cannot(db, book):
    ledger, user, source = book
    make_tx(db, ledger, source, user, amount="-100.0000", occurred_at=SEP)
    make_tx(db, ledger, source, user, amount="-10.0000", occurred_at=SEP, currency="EUR")
    make_tx(db, ledger, source, user, amount="-70.0000", occurred_at=SEP, currency="XXX")
    make_tx(db, ledger, source, user, amount="-30.0000", occurred_at=SEP, currency="XXX")

    result = summary(db, ledger, SEP)

    converted = (Decimal("10.0000") * Decimal("7.82608696")).quantize(Decimal("0.0001"))
    assert result["expense_total"] == Decimal("100.0000") + converted
    assert result["rate_missing_count"] == 2


def test_summary_accepts_any_day_of_the_month(db, book):
    ledger, user, source = book
    make_tx(db, ledger, source, user, amount="-100.0000", occurred_at=dt.date(2026, 9, 30))

    assert summary(db, ledger, dt.date(2026, 9, 1))["expense_total"] == Decimal("100.0000")


# ---------------------------------------------------------------------------
# trend
# ---------------------------------------------------------------------------


def test_trend_returns_a_continuous_run_of_months_with_expense_only(db, book):
    ledger, user, source = book
    make_tx(db, ledger, source, user, amount="-100.0000", occurred_at=dt.date(2025, 10, 5))
    make_tx(db, ledger, source, user, amount="-250.0000", occurred_at=SEP)
    make_tx(db, ledger, source, user, amount="-50.0000", occurred_at=dt.date(2026, 9, 28))

    result = trend(db, ledger, months=12, end=SEP)

    assert result["base_currency"] == "CNY"
    assert result["rate_missing_count"] == 0
    months = result["months"]
    assert len(months) == 12
    assert [row["month"] for row in months][:2] == ["2025-10", "2025-11"]
    assert months[-1]["month"] == "2026-09"
    assert set(months[0]) == {"month", "expense"}
    assert months[0]["expense"] == Decimal("100.0000")
    assert months[1]["expense"] == Decimal("0.0000")     # empty months are present
    assert months[-1]["expense"] == Decimal("300.0000")


def test_trend_deducts_refunds_and_ignores_transfers_and_income(db, book):
    ledger, user, source = book
    purchase = make_tx(db, ledger, source, user, amount="-200.0000", occurred_at=AUG)
    make_tx(
        db, ledger, source, user, kind="refund", amount="30.0000", occurred_at=SEP,
        refund_of=purchase.id,
    )
    make_tx(
        db, ledger, source, user, kind="income", category_l1="salary",
        amount="1000.0000", occurred_at=SEP,
    )
    make_tx(
        db, ledger, source, user, kind="transfer", amount="-400.0000", occurred_at=SEP,
        transfer_role="out", transfer_subtype="plain", counterparty="老婆",
    )

    result = trend(db, ledger, months=3, end=SEP)
    months = {row["month"]: row["expense"] for row in result["months"]}

    assert months == {
        "2026-07": Decimal("0.0000"),
        "2026-08": Decimal("200.0000"),
        "2026-09": Decimal("-30.0000"),     # refund only: negative, reported as is
    }


def test_trend_window_excludes_months_outside_the_range(db, book):
    ledger, user, source = book
    make_tx(db, ledger, source, user, amount="-100.0000", occurred_at=dt.date(2026, 6, 30))
    make_tx(db, ledger, source, user, amount="-100.0000", occurred_at=dt.date(2026, 10, 1))

    result = trend(db, ledger, months=3, end=SEP)

    assert [row["month"] for row in result["months"]] == ["2026-07", "2026-08", "2026-09"]
    assert all(row["expense"] == Decimal("0.0000") for row in result["months"])


def test_trend_of_one_month_counts_missing_rates(db, book):
    ledger, user, source = book
    make_tx(db, ledger, source, user, amount="-100.0000", occurred_at=SEP)
    make_tx(db, ledger, source, user, amount="-40.0000", occurred_at=SEP, currency="XXX")

    result = trend(db, ledger, months=1, end=SEP)

    assert result["months"] == [{"month": "2026-09", "expense": Decimal("100.0000")}]
    assert result["rate_missing_count"] == 1


def test_trend_rejects_a_non_positive_number_of_months(db, book):
    """The endpoint bounds ``months`` to 1..36; the service must still fail honestly."""
    ledger, _user, _source = book
    for months in (0, -1):
        with pytest.raises(ValueError):
            trend(db, ledger, months, dt.date(2026, 8, 31))
