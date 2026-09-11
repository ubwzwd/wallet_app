"""Valuation service tests (03-backend-api.md §5.20, §5.25).

The fake Frankfurter of ``conftest`` quotes one USD as 7.2 CNY and 0.92 EUR,
so EUR -> CNY is 7.2 / 0.92 = 7.82608696 (8 decimals, §4.5) on every day it is
asked about. ``"XXX"`` is not in that table at all and is how these cases make
a rate genuinely unavailable.
"""
import datetime as dt
import uuid
from decimal import Decimal

import pytest

from app.core.clock import utcnow
from app.models.finance_source import FinanceSource
from app.models.transaction import Transaction
from app.services.valuation import (
    SourceBalance,
    Valuation,
    list_summary,
    net_worth,
    source_balances,
    value_transactions,
)

EUR_TO_CNY = Decimal("7.82608696")
SEP = dt.date(2026, 9, 1)


def make_source(
    db,
    ledger,
    user,
    *,
    name: str = "招商 储蓄卡",
    type_: str = "checking",
    currency: str = "CNY",
    opening: str = "0",
    archived: bool = False,
) -> FinanceSource:
    """Insert one account row directly (no factories in this wave)."""
    now = utcnow()
    source = FinanceSource(
        ledger_id=ledger.id,
        name=name,
        type=type_,
        default_currency=currency,
        opening_balance=Decimal(opening),
        archived=archived,
        archived_at=now if archived else None,
        created_by=user.id,
        updated_by=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(source)
    db.flush()
    return source


def make_tx(
    db,
    ledger,
    source,
    user,
    *,
    amount: str,
    kind: str = "expense",
    currency: str = "CNY",
    occurred_at: dt.date = SEP,
    category_l1: str | None = "food",
    category_l2: str | None = None,
    refund_of: uuid.UUID | None = None,
    transfer_role: str | None = None,
    transfer_subtype: str | None = None,
    counterparty: str | None = None,
) -> Transaction:
    """Insert one transaction row directly, honouring the table's CHECKs."""
    now = utcnow()
    if kind == "transfer":
        category_l1 = category_l2 = None
    tx = Transaction(
        ledger_id=ledger.id,
        source_id=source.id,
        amount=Decimal(amount),
        currency=currency,
        occurred_at=occurred_at,
        kind=kind,
        category_l1=category_l1,
        category_l2=category_l2,
        refund_of=refund_of,
        transfer_role=transfer_role,
        transfer_subtype=transfer_subtype,
        counterparty=counterparty,
        created_by=user.id,
        updated_by=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(tx)
    db.flush()
    return tx


@pytest.fixture()
def ledger_setup(db, user_factory, ledger_factory):
    """A CNY ledger and its owner."""
    user = user_factory()
    ledger = ledger_factory(user, base_currency="CNY")
    return ledger, user


# ---------------------------------------------------------------------------
# source_balances
# ---------------------------------------------------------------------------


def test_balance_is_opening_plus_same_currency_rows(db, ledger_setup):
    ledger, user = ledger_setup
    source = make_source(db, ledger, user, opening="1000.0000")
    make_tx(db, ledger, source, user, amount="-45.5000")
    make_tx(db, ledger, source, user, amount="-4.5000", occurred_at=dt.date(2026, 9, 2))
    make_tx(db, ledger, source, user, kind="income", category_l1="salary", amount="200.0000")

    balances = source_balances(db, ledger, [source])

    assert balances[source.id].balance == Decimal("1150.0000")
    assert balances[source.id].rate_missing_count == 0


def test_balance_converts_foreign_rows_on_their_own_day(db, ledger_setup):
    """A EUR purchase on a CNY card lands in the balance as CNY (§14.2)."""
    ledger, user = ledger_setup
    source = make_source(db, ledger, user, opening="100.0000")
    # Same (currency, day): one aggregated group, converted once.
    make_tx(db, ledger, source, user, amount="-45.5000", currency="EUR")
    make_tx(db, ledger, source, user, amount="-10.0000", currency="EUR")
    make_tx(db, ledger, source, user, amount="-20.0000")

    balance = source_balances(db, ledger, [source])[source.id]

    converted = (Decimal("-55.5000") * EUR_TO_CNY).quantize(Decimal("0.0001"))
    assert balance.balance == Decimal("100.0000") + converted + Decimal("-20.0000")
    assert balance.rate_missing_count == 0


def test_balance_base_uses_the_latest_rate(db, ledger_setup):
    """§5.20: ``balance_base`` is the latest quote, not the transaction day's."""
    ledger, user = ledger_setup
    source = make_source(db, ledger, user, name="Revolut EUR", currency="EUR", opening="100.0000")
    make_tx(db, ledger, source, user, amount="-45.5000", currency="EUR")

    balance = source_balances(db, ledger, [source])[source.id]

    assert balance.balance == Decimal("54.5000")
    assert balance.balance_rate == EUR_TO_CNY
    assert balance.balance_rate_date == dt.date(2026, 9, 11)     # conftest FAKE_RATE_DAY
    assert balance.balance_base == (Decimal("54.5000") * EUR_TO_CNY).quantize(Decimal("0.0001"))


def test_balance_base_of_a_base_currency_account_is_rate_one_today(db, ledger_setup):
    ledger, user = ledger_setup
    source = make_source(db, ledger, user, opening="12.3400")

    balance = source_balances(db, ledger, [source])[source.id]

    assert balance.balance_base == Decimal("12.3400")
    assert balance.balance_rate == Decimal("1.00000000")
    assert balance.balance_rate_date == dt.datetime.now(dt.UTC).date()


def test_rows_without_a_rate_are_skipped_and_counted(db, ledger_setup):
    """§5.20's fallback: keep the balance, report what it left out."""
    ledger, user = ledger_setup
    source = make_source(db, ledger, user, opening="500.0000")
    make_tx(db, ledger, source, user, amount="-100.0000")
    make_tx(db, ledger, source, user, amount="-30.0000", currency="XXX")
    make_tx(db, ledger, source, user, amount="-70.0000", currency="XXX")

    balance = source_balances(db, ledger, [source])[source.id]

    assert balance.balance == Decimal("400.0000")    # the XXX rows are not in it
    assert balance.rate_missing_count == 2           # transactions, not groups
    assert balance.balance_base == Decimal("400.0000")


def test_balance_base_is_null_when_the_account_currency_has_no_rate(db, ledger_setup):
    ledger, user = ledger_setup
    source = make_source(db, ledger, user, currency="XXX", opening="80.0000")
    make_tx(db, ledger, source, user, amount="-30.0000", currency="XXX")

    balance = source_balances(db, ledger, [source])[source.id]

    assert balance.balance == Decimal("50.0000")     # no conversion needed for it
    assert balance.balance_base is None
    assert balance.balance_rate is None
    assert balance.balance_rate_date is None


def test_balances_cover_every_account_and_ignore_other_ledgers(db, user_factory, ledger_factory):
    user = user_factory()
    ledger = ledger_factory(user, base_currency="CNY")
    other = ledger_factory(user, name="别的账本", base_currency="CNY")
    mine = make_source(db, ledger, user, opening="10.0000")
    theirs = make_source(db, other, user, opening="10.0000")
    make_tx(db, other, theirs, user, amount="-5.0000")
    empty = make_source(db, ledger, user, name="现金", type_="cash")

    balances = source_balances(db, ledger, [mine, empty])

    assert set(balances) == {mine.id, empty.id}
    assert balances[mine.id].balance == Decimal("10.0000")
    assert balances[empty.id].balance == Decimal("0.0000")


def test_source_balances_of_nothing_is_empty(db, ledger_setup):
    ledger, _user = ledger_setup
    assert source_balances(db, ledger, []) == {}


# ---------------------------------------------------------------------------
# net_worth
# ---------------------------------------------------------------------------


def test_net_worth_sums_assets_and_negative_liabilities(db, ledger_setup):
    ledger, user = ledger_setup
    checking = make_source(db, ledger, user, opening="1000.0000")
    cash = make_source(db, ledger, user, name="现金", type_="cash", opening="200.0000")
    card = make_source(db, ledger, user, name="信用卡", type_="credit", opening="-2300.0000")
    sources = [checking, cash, card]

    assets, liabilities, total = net_worth(sources, source_balances(db, ledger, sources))

    assert assets == Decimal("1200.0000")
    assert liabilities == Decimal("-2300.0000")
    assert total == Decimal("-1100.0000")


def test_net_worth_ignores_archived_accounts(db, ledger_setup):
    ledger, user = ledger_setup
    live = make_source(db, ledger, user, opening="1000.0000")
    gone = make_source(db, ledger, user, name="旧卡", opening="500.0000", archived=True)
    debt = make_source(
        db, ledger, user, name="旧信用卡", type_="credit", opening="-90.0000", archived=True
    )
    sources = [live, gone, debt]

    assets, liabilities, total = net_worth(sources, source_balances(db, ledger, sources))

    assert (assets, liabilities, total) == (
        Decimal("1000.0000"),
        Decimal("0.0000"),
        Decimal("1000.0000"),
    )


def test_net_worth_is_null_when_an_account_cannot_be_valued(db, ledger_setup):
    ledger, user = ledger_setup
    good = make_source(db, ledger, user, opening="1000.0000")
    unvalued = make_source(db, ledger, user, name="谜之账户", currency="XXX", opening="5.0000")
    sources = [good, unvalued]

    assert net_worth(sources, source_balances(db, ledger, sources)) == (None, None, None)


def test_net_worth_ignores_an_unvalued_but_archived_account(db, ledger_setup):
    ledger, user = ledger_setup
    good = make_source(db, ledger, user, opening="1000.0000")
    unvalued = make_source(
        db, ledger, user, name="谜之账户", currency="XXX", opening="5.0000", archived=True
    )
    sources = [good, unvalued]

    assets, _liabilities, total = net_worth(sources, source_balances(db, ledger, sources))

    assert (assets, total) == (Decimal("1000.0000"), Decimal("1000.0000"))


def test_net_worth_of_a_missing_balance_entry_is_skipped(db, ledger_setup):
    """Defensive: an account the caller did not ask balances for is not counted."""
    ledger, user = ledger_setup
    source = make_source(db, ledger, user, opening="1000.0000")
    balances: dict[uuid.UUID, SourceBalance] = {}

    assert net_worth([source], balances) == (
        Decimal("0.0000"),
        Decimal("0.0000"),
        Decimal("0.0000"),
    )


# ---------------------------------------------------------------------------
# value_transactions / list_summary
# ---------------------------------------------------------------------------


def test_value_transactions_uses_the_row_day_and_marks_missing_rates(db, ledger_setup):
    ledger, user = ledger_setup
    source = make_source(db, ledger, user)
    same = make_tx(db, ledger, source, user, amount="-45.5000")
    foreign = make_tx(db, ledger, source, user, amount="-45.5000", currency="EUR")
    unknown = make_tx(db, ledger, source, user, amount="-45.5000", currency="XXX")

    values = value_transactions(db, ledger.base_currency, [same, foreign, unknown])

    assert values[0] == Valuation(Decimal("-45.5000"), Decimal("1"), same.occurred_at)
    assert values[1] is not None
    assert values[1].amount_base == (Decimal("-45.5000") * EUR_TO_CNY).quantize(
        Decimal("0.0001")
    )
    assert values[1].rate_used == EUR_TO_CNY
    assert values[2] is None


def test_value_transactions_of_nothing_is_empty(db, ledger_setup):
    ledger, _user = ledger_setup
    assert value_transactions(db, ledger.base_currency, []) == []


def test_list_summary_covers_the_four_kinds(db, ledger_setup):
    """§5.25: expense positive, refund only in ``net``, transfers nowhere."""
    ledger, user = ledger_setup
    source = make_source(db, ledger, user)
    rows = [
        make_tx(db, ledger, source, user, amount="-100.0000"),
        make_tx(db, ledger, source, user, kind="income", category_l1="salary", amount="300.0000"),
        make_tx(db, ledger, source, user, kind="refund", amount="20.0000"),
        make_tx(
            db,
            ledger,
            source,
            user,
            kind="transfer",
            amount="-50.0000",
            transfer_role="out",
            transfer_subtype="plain",
            counterparty="老婆",
        ),
    ]

    result = list_summary(
        ledger.base_currency, rows, value_transactions(db, ledger.base_currency, rows)
    )

    assert result == {
        "base_currency": "CNY",
        "expense": Decimal("100.0000"),
        "income": Decimal("300.0000"),
        "net": Decimal("220.0000"),
        "count": 4,
        "rate_missing_count": 0,
    }


def test_list_summary_counts_rows_it_could_not_value(db, ledger_setup):
    ledger, user = ledger_setup
    source = make_source(db, ledger, user)
    rows = [
        make_tx(db, ledger, source, user, amount="-100.0000"),
        make_tx(db, ledger, source, user, amount="-999.0000", currency="XXX"),
    ]

    result = list_summary(
        ledger.base_currency, rows, value_transactions(db, ledger.base_currency, rows)
    )

    assert result["expense"] == Decimal("100.0000")
    assert result["net"] == Decimal("-100.0000")
    assert result["count"] == 2
    assert result["rate_missing_count"] == 1


def test_list_summary_of_an_empty_selection(db, ledger_setup):
    ledger, _user = ledger_setup

    result = list_summary(ledger.base_currency, [], [])

    assert result["expense"] == Decimal("0.0000")
    assert result["income"] == Decimal("0.0000")
    assert result["net"] == Decimal("0.0000")
    assert result["count"] == 0
