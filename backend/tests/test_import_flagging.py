"""The flagging algorithms of 05 §3, case by case from §7.3's table.

Every case seeds the committed transactions with the factories, then runs
``flag_rows`` over hand-built drafts and asserts the flags, the pre-filled
``matched_transaction_id`` / ``counterpart_source_id`` and the hint.
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.core.categories import CATEGORY_VERSION
from app.services.importing.flagging import flag_rows
from app.services.importing.validation import ImportContext, RowDraft

DAY = date(2026, 8, 20)


@pytest.fixture()
def ledger(db, user_factory, ledger_factory):
    return ledger_factory(user_factory())


@pytest.fixture()
def credit(db, ledger, source_factory):
    return source_factory(ledger, name="招行信用卡", type="credit")


@pytest.fixture()
def checking(db, ledger, source_factory):
    return source_factory(ledger, name="招行储蓄卡", type="checking")


def context(ledger, source) -> ImportContext:
    """The ``ImportContext`` an upload against ``source`` would carry (§0.3)."""
    return ImportContext(
        ledger_id=ledger.id,
        source_id=source.id,
        source_currency=source.default_currency,
        source_type=source.type,
        base_currency=ledger.base_currency,
        actor_id=ledger.created_by,
        category_version=CATEGORY_VERSION,
    )


def draft(
    *,
    row_no: int = 1,
    occurred_at: date | None = DAY,
    amount: str = "-128.00",
    currency: str = "CNY",
    kind: str = "expense",
    transfer_role: str | None = None,
    transfer_subtype: str | None = None,
    merchant: str | None = None,
    note: str | None = None,
    category_l1: str | None = None,
    category_l2: str | None = None,
    source_ref: str | None = None,
) -> RowDraft:
    """One normalized draft row, the way ``normalize_rows`` would hand it over."""
    if category_l1 is None and kind != "transfer":
        category_l1 = "food"
    return RowDraft(
        row_no=row_no,
        occurred_at=occurred_at,
        amount=Decimal(amount).quantize(Decimal("0.0001")),
        currency=currency,
        kind=kind,
        transfer_role=transfer_role,
        transfer_subtype=transfer_subtype,
        merchant=merchant,
        note=note,
        category_l1=category_l1,
        category_l2=category_l2,
        source_ref=source_ref,
    )


def transfer_draft(role: str, amount: str, **kwargs) -> RowDraft:
    kwargs.setdefault("transfer_subtype", "plain")
    return draft(kind="transfer", transfer_role=role, amount=amount, **kwargs)


# ---------------------------------------------------------------------------
# §3.1 duplicate
# ---------------------------------------------------------------------------


def test_duplicate_same_account_day_amount_currency(db, ledger, checking, transaction_factory):
    existing = transaction_factory(
        ledger, checking, amount=Decimal("-128.0000"), occurred_at=DAY
    )
    row = draft()

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == {"duplicate"}
    assert row.matched_transaction_id == existing.id
    assert "账户里已有 1 笔同日同额交易" in row.hint


def test_duplicate_needs_the_same_account(db, ledger, checking, credit, transaction_factory):
    transaction_factory(ledger, credit, amount=Decimal("-128.0000"), occurred_at=DAY)
    row = draft()

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == set()
    assert row.matched_transaction_id is None


def test_duplicate_needs_the_same_currency(db, ledger, checking, transaction_factory):
    transaction_factory(
        ledger, checking, amount=Decimal("-128.0000"), occurred_at=DAY, currency="USD"
    )
    row = draft()

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == set()
    assert row.matched_transaction_id is None


def test_duplicate_does_not_prefill_when_two_match(db, ledger, checking, transaction_factory):
    for _ in range(2):
        transaction_factory(ledger, checking, amount=Decimal("-128.0000"), occurred_at=DAY)
    row = draft()

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == {"duplicate"}
    assert row.matched_transaction_id is None
    assert "已有 2 笔" in row.hint


def test_duplicate_ignores_other_ledgers(
    db, ledger, checking, user_factory, ledger_factory, source_factory, transaction_factory
):
    other_ledger = ledger_factory(user_factory(), name="别人的账本")
    other_source = source_factory(other_ledger, name="他的储蓄卡")
    transaction_factory(
        other_ledger, other_source, amount=Decimal("-128.0000"), occurred_at=DAY
    )
    row = draft()

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == set()


# ---------------------------------------------------------------------------
# §3.2 refund_candidate
# ---------------------------------------------------------------------------


def test_refund_unique_candidate_is_prefilled_with_its_category(
    db, ledger, checking, transaction_factory
):
    expense = transaction_factory(
        ledger,
        checking,
        amount=Decimal("-32.0000"),
        occurred_at=DAY - timedelta(days=30),
        merchant="星巴克",
        category_l1="food",
        category_l2="snacks_drinks",
    )
    row = draft(kind="refund", amount="32.00", merchant="星巴克", category_l1="")

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == {"refund_candidate"}
    assert row.matched_transaction_id == expense.id
    assert (row.category_l1, row.category_l2) == ("food", "snacks_drinks")
    assert "已关联 2026-07-21 的原支出" in row.hint


def test_refund_two_candidates_are_not_prefilled(db, ledger, checking, transaction_factory):
    for merchant in ("A 商店", "B 商店"):
        transaction_factory(
            ledger,
            checking,
            amount=Decimal("-32.0000"),
            occurred_at=DAY - timedelta(days=10),
            merchant=merchant,
        )
    row = draft(kind="refund", amount="32.00", merchant="C 商店")

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == {"refund_candidate", "needs_review"}
    assert row.matched_transaction_id is None
    assert "找到 2 笔可能的原支出，请选一笔" in row.hint


def test_refund_matching_merchant_only_scores(db, ledger, checking, transaction_factory):
    """A merchant hit adds points; it never makes a second candidate go away."""
    transaction_factory(
        ledger,
        checking,
        amount=Decimal("-32.0000"),
        occurred_at=DAY - timedelta(days=10),
        merchant="星巴克咖啡",
    )
    transaction_factory(
        ledger,
        checking,
        amount=Decimal("-32.0000"),
        occurred_at=DAY - timedelta(days=11),
        merchant="别的店",
    )
    row = draft(kind="refund", amount="32.00", merchant="星巴克")

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == {"refund_candidate", "needs_review"}
    assert row.matched_transaction_id is None
    assert "找到 2 笔可能的原支出，请选一笔" in row.hint


def test_refund_ignores_expenses_older_than_ninety_days(
    db, ledger, checking, transaction_factory
):
    transaction_factory(
        ledger, checking, amount=Decimal("-32.0000"), occurred_at=DAY - timedelta(days=100)
    )
    row = draft(kind="refund", amount="32.00")

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == set()
    assert row.matched_transaction_id is None


def test_refund_window_includes_the_ninetieth_day(db, ledger, checking, transaction_factory):
    expense = transaction_factory(
        ledger, checking, amount=Decimal("-32.0000"), occurred_at=DAY - timedelta(days=90)
    )
    row = draft(kind="refund", amount="32.00")

    flag_rows(db, context(ledger, checking), [row])

    assert row.matched_transaction_id == expense.id


def test_refund_skips_a_fully_refunded_expense(db, ledger, checking, transaction_factory):
    expense = transaction_factory(
        ledger, checking, amount=Decimal("-32.0000"), occurred_at=DAY - timedelta(days=20)
    )
    transaction_factory(
        ledger,
        checking,
        kind="refund",
        amount=Decimal("32.0000"),
        occurred_at=DAY - timedelta(days=5),
        refund_of=expense.id,
    )
    row = draft(kind="refund", amount="32.00")

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == set()
    assert row.matched_transaction_id is None


def test_refund_keeps_an_expense_with_room_left(db, ledger, checking, transaction_factory):
    expense = transaction_factory(
        ledger, checking, amount=Decimal("-100.0000"), occurred_at=DAY - timedelta(days=20)
    )
    transaction_factory(
        ledger,
        checking,
        kind="refund",
        amount=Decimal("68.0000"),
        occurred_at=DAY - timedelta(days=5),
        refund_of=expense.id,
    )
    row = draft(kind="refund", amount="32.00")

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == {"refund_candidate"}
    assert row.matched_transaction_id == expense.id


def test_refund_ignores_an_expense_smaller_than_itself(
    db, ledger, checking, transaction_factory
):
    transaction_factory(
        ledger, checking, amount=Decimal("-30.0000"), occurred_at=DAY - timedelta(days=3)
    )
    row = draft(kind="refund", amount="50.00")

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == set()
    assert row.matched_transaction_id is None


def test_refund_clears_a_duplicate_match_when_no_candidate_is_found(
    db, ledger, checking, transaction_factory
):
    """§3.2 clears ``matched_transaction_id`` *before* looking for candidates."""
    transaction_factory(
        ledger, checking, kind="income", amount=Decimal("32.0000"), occurred_at=DAY
    )
    row = draft(kind="refund", amount="32.00")

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == {"duplicate"}
    assert row.matched_transaction_id is None
    assert "账户里已有 1 笔同日同额交易" in row.hint


def test_refund_candidates_must_share_the_currency(db, ledger, checking, transaction_factory):
    transaction_factory(
        ledger,
        checking,
        amount=Decimal("-32.0000"),
        occurred_at=DAY - timedelta(days=10),
        currency="USD",
    )
    row = draft(kind="refund", amount="32.00")

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == set()


def test_refund_candidates_must_be_on_the_same_account(
    db, ledger, checking, credit, transaction_factory
):
    transaction_factory(
        ledger, credit, amount=Decimal("-32.0000"), occurred_at=DAY - timedelta(days=10)
    )
    row = draft(kind="refund", amount="32.00")

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == set()


def test_credit_card_income_becomes_a_refund_and_inherits_the_category(
    db, ledger, credit, transaction_factory
):
    expense = transaction_factory(
        ledger,
        credit,
        amount=Decimal("-32.0000"),
        occurred_at=DAY - timedelta(days=12),
        category_l1="food",
        category_l2="snacks_drinks",
    )
    row = draft(
        kind="income", amount="32.00", category_l1="salary", category_l2="bonus"
    )

    flag_rows(db, context(ledger, credit), [row])

    assert row.kind == "refund"
    assert row.flags == {"refund_candidate", "needs_review"}
    assert row.matched_transaction_id == expense.id
    assert (row.category_l1, row.category_l2) == ("food", "snacks_drinks")


def test_positive_row_on_a_checking_account_is_not_a_refund_trigger(
    db, ledger, checking, transaction_factory
):
    transaction_factory(
        ledger, checking, amount=Decimal("-32.0000"), occurred_at=DAY - timedelta(days=12)
    )
    row = draft(kind="income", amount="32.00", category_l1="salary")

    flag_rows(db, context(ledger, checking), [row])

    assert row.kind == "income"
    assert row.flags == set()


def test_draft_rows_of_the_same_batch_are_never_candidates(
    db, ledger, checking
):
    """Drafts have no ``transactions.id`` yet, so they cannot be matched (§14.7)."""
    expense = draft(row_no=1, amount="-32.00", occurred_at=DAY - timedelta(days=2))
    refund = draft(row_no=2, kind="refund", amount="32.00")

    flag_rows(db, context(ledger, checking), [expense, refund])

    assert refund.flags == set()
    assert refund.matched_transaction_id is None


# ---------------------------------------------------------------------------
# §3.3 transfer_candidate
# ---------------------------------------------------------------------------


def test_transfer_unique_single_leg_is_prefilled(
    db, ledger, credit, checking, transaction_factory
):
    leg = transaction_factory(
        ledger,
        checking,
        kind="transfer",
        amount=Decimal("-3000.0000"),
        occurred_at=DAY,
        transfer_role="out",
    )
    row = transfer_draft("in", "3000.00")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == {"transfer_candidate"}
    assert row.matched_transaction_id == leg.id
    assert row.counterpart_source_id == checking.id
    assert "已勾选" in row.hint


def test_transfer_counterpart_four_days_away_is_out_of_range(
    db, ledger, credit, checking, transaction_factory
):
    transaction_factory(
        ledger,
        checking,
        kind="transfer",
        amount=Decimal("-3000.0000"),
        occurred_at=DAY - timedelta(days=4),
        transfer_role="out",
    )
    row = transfer_draft("in", "3000.00")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == set()
    assert row.matched_transaction_id is None
    assert row.counterpart_source_id is None
    assert "没找到对腿" in row.hint


def test_transfer_counterpart_three_days_away_still_matches(
    db, ledger, credit, checking, transaction_factory
):
    leg = transaction_factory(
        ledger,
        checking,
        kind="transfer",
        amount=Decimal("-3000.0000"),
        occurred_at=DAY - timedelta(days=3),
        transfer_role="out",
    )
    row = transfer_draft("in", "3000.00")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == {"transfer_candidate"}
    assert row.matched_transaction_id == leg.id


def test_transfer_counterpart_in_another_currency_does_not_match(
    db, ledger, credit, checking, transaction_factory
):
    transaction_factory(
        ledger,
        checking,
        kind="transfer",
        amount=Decimal("-3000.0000"),
        occurred_at=DAY,
        currency="USD",
        transfer_role="out",
    )
    row = transfer_draft("in", "3000.00")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == set()
    assert "没找到对腿" in row.hint


def test_transfer_counterpart_off_by_one_cent_does_not_match(
    db, ledger, credit, checking, transaction_factory
):
    transaction_factory(
        ledger,
        checking,
        kind="transfer",
        amount=Decimal("-2999.9900"),
        occurred_at=DAY,
        transfer_role="out",
    )
    row = transfer_draft("in", "3000.00")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == set()
    assert row.matched_transaction_id is None


def test_transfer_counterpart_on_the_same_account_does_not_match(
    db, ledger, credit, transaction_factory
):
    transaction_factory(
        ledger,
        credit,
        kind="transfer",
        amount=Decimal("-3000.0000"),
        occurred_at=DAY,
        transfer_role="out",
    )
    row = transfer_draft("in", "3000.00")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == set()
    assert row.matched_transaction_id is None
    assert "没找到对腿" in row.hint


def test_transfer_subtype_is_neither_a_filter_nor_a_tiebreak(
    db, ledger, credit, checking, transaction_factory
):
    leg = transaction_factory(
        ledger,
        checking,
        kind="transfer",
        amount=Decimal("-3000.0000"),
        occurred_at=DAY,
        transfer_role="out",
        transfer_subtype="plain",
    )
    row = transfer_draft("in", "3000.00", transfer_subtype="repayment")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == {"transfer_candidate"}
    assert row.matched_transaction_id == leg.id


def test_transfer_counterpart_already_paired_is_a_duplicate(
    db, ledger, credit, checking, source_factory, pair_factory
):
    third = source_factory(ledger, name="工行储蓄卡")
    pair_factory(
        ledger, checking, third, amount_out=Decimal("-3000.0000"), occurred_at=DAY
    )
    row = transfer_draft("in", "3000.00")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == {"duplicate"}
    assert "transfer_candidate" not in row.flags
    assert row.matched_transaction_id is None
    assert "已经配好对了" in row.hint


def test_transfer_row_that_is_also_a_duplicate_keeps_no_match(
    db, ledger, credit, checking, source_factory, pair_factory, transaction_factory
):
    """Both §3.1 and the "counterpart already paired" branch fire (§7.3)."""
    transaction_factory(
        ledger,
        credit,
        kind="transfer",
        amount=Decimal("3000.0000"),
        occurred_at=DAY,
        transfer_role="in",
    )
    third = source_factory(ledger, name="工行储蓄卡")
    pair_factory(
        ledger, checking, third, amount_out=Decimal("-3000.0000"), occurred_at=DAY
    )
    row = transfer_draft("in", "3000.00")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == {"duplicate"}
    assert "transfer_candidate" not in row.flags
    assert row.matched_transaction_id is None


def test_transfer_two_single_legs_are_not_prefilled(
    db, ledger, credit, checking, source_factory, transaction_factory
):
    other = source_factory(ledger, name="工行储蓄卡")
    for source, day in ((checking, DAY), (other, DAY - timedelta(days=1))):
        transaction_factory(
            ledger,
            source,
            kind="transfer",
            amount=Decimal("-3000.0000"),
            occurred_at=day,
            transfer_role="out",
        )
    row = transfer_draft("in", "3000.00")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == {"transfer_candidate", "needs_review"}
    assert row.matched_transaction_id is None
    assert row.counterpart_source_id is None
    assert "找到 2 条可以配对的转账，请选一条" in row.hint


def test_transfer_one_paired_and_one_single_prefills_the_single(
    db, ledger, credit, checking, source_factory, pair_factory, transaction_factory
):
    third = source_factory(ledger, name="工行储蓄卡")
    pair_factory(
        ledger, checking, third, amount_out=Decimal("-3000.0000"), occurred_at=DAY
    )
    free = source_factory(ledger, name="建行储蓄卡")
    single = transaction_factory(
        ledger,
        free,
        kind="transfer",
        amount=Decimal("-3000.0000"),
        occurred_at=DAY,
        transfer_role="out",
    )
    row = transfer_draft("in", "3000.00")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == {"transfer_candidate"}
    assert row.matched_transaction_id == single.id
    assert row.counterpart_source_id == free.id


def test_transfer_unique_leg_on_an_unusable_account_is_not_prefilled(
    db, ledger, credit, user_factory, owned_source_factory, transaction_factory
):
    """The counterpart is unique but belongs to someone else, unshared here.

    Pre-filling it anyway would pass review only to have ``load_counterpart``
    404 it at commit (§4.5 ②, decision §14.62); leaving it ``None`` lets the
    user pick a real account.
    """
    stranger = user_factory()
    outside = owned_source_factory(stranger, name="陌生人的储蓄卡")
    leg = transaction_factory(
        ledger,
        outside,
        kind="transfer",
        amount=Decimal("-3000.0000"),
        occurred_at=DAY,
        transfer_role="out",
        created_by=stranger.id,
    )
    row = transfer_draft("in", "3000.00")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == {"transfer_candidate"}
    assert row.matched_transaction_id == leg.id
    assert row.counterpart_source_id is None
    assert "已勾选" in row.hint


def test_transfer_unique_leg_on_an_archived_account_is_not_prefilled(
    db, ledger, credit, source_factory, transaction_factory
):
    """The counterpart is unique and usable, but archived (decision §14.62)."""
    from datetime import datetime, timezone

    archived_checking = source_factory(ledger, name="已归档储蓄卡")
    leg = transaction_factory(
        ledger,
        archived_checking,
        kind="transfer",
        amount=Decimal("-3000.0000"),
        occurred_at=DAY,
        transfer_role="out",
    )
    archived_checking.archived = True
    archived_checking.archived_at = datetime.now(timezone.utc)
    db.flush()
    row = transfer_draft("in", "3000.00")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == {"transfer_candidate"}
    assert row.matched_transaction_id == leg.id
    assert row.counterpart_source_id is None
    assert "已勾选" in row.hint


def test_transfer_without_counterpart_never_guesses_one_account(
    db, ledger, credit, checking
):
    row = transfer_draft("out", "-3000.00", transfer_subtype="repayment")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == set()
    assert row.counterpart_source_id is None
    assert row.matched_transaction_id is None
    assert "没找到对腿" in row.hint


def test_transfer_without_counterpart_never_guesses_among_three_accounts(
    db, ledger, credit, checking, source_factory
):
    source_factory(ledger, name="工行储蓄卡")
    source_factory(ledger, name="建行储蓄卡")
    row = transfer_draft("out", "-3000.00", transfer_subtype="repayment")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == set()
    assert row.counterpart_source_id is None
    assert row.matched_transaction_id is None
    assert "没找到对腿" in row.hint


def test_transfer_leg_wins_over_the_refund_trigger_on_a_credit_card(
    db, ledger, credit, checking, transaction_factory
):
    """§3's order: a repayment landing on a credit card is not a refund (§3.2)."""
    transaction_factory(
        ledger,
        credit,
        amount=Decimal("-3000.0000"),
        occurred_at=DAY - timedelta(days=10),
    )
    leg = transaction_factory(
        ledger,
        checking,
        kind="transfer",
        amount=Decimal("-3000.0000"),
        occurred_at=DAY,
        transfer_role="out",
    )
    row = transfer_draft("in", "3000.00", transfer_subtype="repayment")

    flag_rows(db, context(ledger, credit), [row])

    assert row.flags == {"transfer_candidate"}
    assert "refund_candidate" not in row.flags
    assert row.matched_transaction_id == leg.id


# ---------------------------------------------------------------------------
# Batch behaviour
# ---------------------------------------------------------------------------


def test_rows_without_a_date_are_left_alone(db, ledger, checking, transaction_factory):
    transaction_factory(ledger, checking, amount=Decimal("-128.0000"), occurred_at=DAY)
    row = draft(occurred_at=None)

    flag_rows(db, context(ledger, checking), [row])

    assert row.flags == set()
    assert row.matched_transaction_id is None


def test_three_queries_for_a_whole_batch(db, ledger, credit, checking, transaction_factory):
    """No N+1: one query per flagging step, however many rows there are."""
    from sqlalchemy import event

    transaction_factory(
        ledger, credit, amount=Decimal("-32.0000"), occurred_at=DAY - timedelta(days=4)
    )
    rows = [
        draft(row_no=index, amount=f"-{index}.00", occurred_at=DAY - timedelta(days=index))
        for index in range(1, 21)
    ]
    rows += [
        draft(row_no=30 + index, kind="refund", amount=f"{index}.00") for index in range(1, 6)
    ]
    rows += [
        transfer_draft("in", "3000.00", row_no=50 + index) for index in range(1, 6)
    ]

    seen: list[str] = []

    def record(conn, cursor, statement, parameters, context_, executemany):
        seen.append(statement)

    event.listen(db.get_bind(), "before_cursor_execute", record)
    try:
        flag_rows(db, context(ledger, credit), rows)
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", record)

    selects = [statement for statement in seen if statement.lstrip().upper().startswith("SELECT")]
    assert len(selects) == 3
    assert all("ledger_id" in statement for statement in selects)
