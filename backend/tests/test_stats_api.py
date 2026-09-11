"""Tests for GET /ledgers/{id}/stats/summary and /trend (03-backend-api.md §5.35-§5.36).

The aggregation itself is exercised in depth in ``test_stats_service.py``; the
cases here are the HTTP-layer ones §10.2 asks for: transfers excluded, a
cross-month refund offset, a category gone negative returned as is, the two
query-string validation failures, the trend endpoint's expense-only shape with
empty months filled in, a 12-month continuous window, and the member-only
authorization rule.
"""
import datetime as dt
from decimal import Decimal

import pytest

AUG = dt.date(2026, 8, 15)
SEP = dt.date(2026, 9, 10)


@pytest.fixture()
def book(user_factory, auth_headers, ledger_factory, source_factory):
    """A CNY ledger with one owner, one checking account, and auth headers."""
    user = user_factory()
    ledger = ledger_factory(user, base_currency="CNY")
    source = source_factory(ledger, created_by=user.id)
    return ledger, user, source, auth_headers(user)


# ---------------------------------------------------------------------------
# §5.35 GET /stats/summary
# ---------------------------------------------------------------------------


def test_summary_excludes_transfers_and_reports_the_month(
    client, transaction_factory, source_factory, book
):
    ledger, user, source, headers = book
    other = source_factory(ledger, name="现金", type="cash", created_by=user.id)
    transaction_factory(ledger, source, amount=Decimal("-100.0000"), occurred_at=SEP)
    transaction_factory(
        ledger, source, kind="transfer", amount=Decimal("-400.0000"), occurred_at=SEP,
        transfer_role="out", transfer_subtype="plain", counterparty="老婆",
    )
    transaction_factory(
        ledger, other, kind="transfer", amount=Decimal("400.0000"), occurred_at=SEP,
        transfer_role="in", transfer_subtype="plain", counterparty="老婆",
    )

    response = client.get(
        f"/api/v1/ledgers/{ledger.id}/stats/summary?month=2026-09", headers=headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["month"] == "2026-09"
    assert body["base_currency"] == "CNY"
    assert body["expense_total"] == "100.0000"
    assert body["net"] == "-100.0000"
    assert [row["code"] for row in body["expense"]] == ["food"]
    assert body["income"] == []
    assert body["rate_missing_count"] == 0


def test_summary_deducts_a_refund_in_its_own_month_across_a_month_boundary(
    client, transaction_factory, book
):
    """§10.2: an August expense, a September refund — August stays put."""
    ledger, user, source, headers = book
    purchase = transaction_factory(
        ledger, source, amount=Decimal("-100.0000"), occurred_at=AUG,
        category_l1="food", category_l2="lunch",
    )
    transaction_factory(
        ledger, source, kind="refund", amount=Decimal("30.0000"), occurred_at=SEP,
        category_l1="food", category_l2="lunch", refund_of=purchase.id,
    )

    august = client.get(
        f"/api/v1/ledgers/{ledger.id}/stats/summary?month=2026-08", headers=headers
    ).json()
    september = client.get(
        f"/api/v1/ledgers/{ledger.id}/stats/summary?month=2026-09", headers=headers
    ).json()

    assert august["expense_total"] == "100.0000"
    assert august["refund_total"] == "0.0000"
    assert september["expense_total"] == "-30.0000"
    assert september["refund_total"] == "30.0000"
    food = next(row for row in september["expense"] if row["code"] == "food")
    assert food["amount"] == "-30.0000"     # a category refunded past zero is negative, on purpose


def test_summary_defaults_to_the_current_utc_month(client, book, monkeypatch):
    ledger, user, source, headers = book
    import app.api.stats as stats_api

    monkeypatch.setattr(stats_api, "_current_month", lambda: dt.date(2026, 9, 1))

    response = client.get(f"/api/v1/ledgers/{ledger.id}/stats/summary", headers=headers)

    assert response.status_code == 200
    assert response.json()["month"] == "2026-09"


@pytest.mark.parametrize("month", ["2026-9", "2026-13", "2026/09", "26-09", "not-a-month"])
def test_summary_rejects_a_malformed_month(client, book, month):
    ledger, _user, _source, headers = book

    response = client.get(
        f"/api/v1/ledgers/{ledger.id}/stats/summary?month={month}", headers=headers
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_summary_is_404_for_a_non_member(client, user_factory, auth_headers, book):
    ledger, _user, _source, _headers = book
    stranger = user_factory()

    response = client.get(
        f"/api/v1/ledgers/{ledger.id}/stats/summary", headers=auth_headers(stranger)
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


# ---------------------------------------------------------------------------
# §5.36 GET /stats/trend
# ---------------------------------------------------------------------------


def test_trend_has_only_the_expense_field_and_fills_empty_months(
    client, transaction_factory, book
):
    ledger, user, source, headers = book
    transaction_factory(ledger, source, amount=Decimal("-250.0000"), occurred_at=SEP)

    response = client.get(
        f"/api/v1/ledgers/{ledger.id}/stats/trend?months=3&end=2026-09", headers=headers
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"base_currency", "months", "rate_missing_count"}
    assert len(body["months"]) == 3
    for row in body["months"]:
        assert set(row) == {"month", "expense"}
    by_month = {row["month"]: row["expense"] for row in body["months"]}
    assert by_month["2026-07"] == "0.0000"     # empty months are present, not skipped
    assert by_month["2026-08"] == "0.0000"
    assert by_month["2026-09"] == "250.0000"


def test_trend_of_twelve_months_is_continuous_and_ends_on_the_given_month(
    client, transaction_factory, book
):
    ledger, user, source, headers = book
    transaction_factory(ledger, source, amount=Decimal("-10.0000"), occurred_at=SEP)

    response = client.get(
        f"/api/v1/ledgers/{ledger.id}/stats/trend?months=12&end=2026-09", headers=headers
    )

    months = response.json()["months"]
    assert len(months) == 12
    assert months[0]["month"] == "2025-10"
    assert months[-1]["month"] == "2026-09"
    labels = [row["month"] for row in months]
    expected = []
    year, month = 2025, 10
    for _ in range(12):
        expected.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            month = 1
            year += 1
    assert labels == expected


def test_trend_defaults_end_to_the_current_utc_month(client, book, monkeypatch):
    """No ``end``: the trend's last month follows ``app.core.clock.utcnow``."""
    ledger, user, source, headers = book
    import app.api.stats as stats_api

    monkeypatch.setattr(stats_api, "utcnow", lambda: dt.datetime(2026, 9, 15, 3, 0, 0))

    response = client.get(f"/api/v1/ledgers/{ledger.id}/stats/trend?months=1", headers=headers)

    assert response.status_code == 200
    assert response.json()["months"] == [{"month": "2026-09", "expense": "0.0000"}]


@pytest.mark.parametrize("months,end", [(0, "2026-09"), (37, "2026-09"), (12, "2026-9")])
def test_trend_rejects_out_of_range_or_malformed_query(client, book, months, end):
    ledger, _user, _source, headers = book

    response = client.get(
        f"/api/v1/ledgers/{ledger.id}/stats/trend?months={months}&end={end}", headers=headers
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_trend_is_404_for_a_non_member(client, user_factory, auth_headers, book):
    ledger, _user, _source, _headers = book
    stranger = user_factory()

    response = client.get(
        f"/api/v1/ledgers/{ledger.id}/stats/trend", headers=auth_headers(stranger)
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
