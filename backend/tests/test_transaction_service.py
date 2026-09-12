"""Tests for services/transaction_service.py (03-backend-api.md §5.26-§5.34).

The cases follow the §10.2 rows for ``POST/PATCH/DELETE /transactions``, the
transfer endpoints, ``pair`` and ``unpair`` — one per branch the spec names.
Rows are built locally (the shared factories are a sibling task's file).
"""
import datetime as dt
import uuid
from decimal import Decimal

import httpx
import pytest

from app.core.clock import utcnow
from app.core.errors import ApiError
from app.core.security import get_password_hash
from app.models.finance_source import FinanceSource
from app.models.ledger import Ledger, LedgerMember
from app.models.transaction import Transaction
from app.models.transaction_event import TransactionEvent
from app.models.user import User
from app.services import events
from app.services import transaction_service as svc
from app.services.transaction_service import SingleTxInput, TransferInput

DAY = dt.date(2026, 9, 1)


# ---------------------------------------------------------------------------
# Local row helpers
# ---------------------------------------------------------------------------


def make_user(db) -> User:
    now = utcnow()
    user = User(
        email=f"u-{uuid.uuid4().hex[:10]}@example.test",
        password_hash=get_password_hash("correct horse battery"),
        base_currency="CNY",
        language="zh",
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    db.flush()
    return user


def make_ledger(db, owner: User, base_currency: str = "CNY") -> Ledger:
    now = utcnow()
    ledger = Ledger(
        name="我的账本",
        base_currency=base_currency,
        created_by=owner.id,
        created_at=now,
        updated_at=now,
    )
    db.add(ledger)
    db.flush()
    db.add(
        LedgerMember(ledger_id=ledger.id, user_id=owner.id, role="owner", joined_at=now)
    )
    db.flush()
    return ledger


def make_source(
    db,
    ledger: Ledger,
    owner: User,
    name: str = "招行储蓄卡",
    type: str = "checking",
    currency: str = "CNY",
    archived: bool = False,
) -> FinanceSource:
    now = utcnow()
    source = FinanceSource(
        ledger_id=ledger.id,
        name=name,
        type=type,
        default_currency=currency,
        opening_balance=Decimal("0"),
        archived=archived,
        archived_at=now if archived else None,
        created_by=owner.id,
        updated_by=owner.id,
        created_at=now,
        updated_at=now,
    )
    db.add(source)
    db.flush()
    return source


@pytest.fixture()
def world(db):
    """One ledger with a checking, a credit, a USD and an archived account."""
    user = make_user(db)
    ledger = make_ledger(db, user)
    return {
        "db": db,
        "user": user,
        "ledger": ledger,
        "checking": make_source(db, ledger, user),
        "credit": make_source(db, ledger, user, name="招行信用卡", type="credit"),
        "usd": make_source(db, ledger, user, name="US account", currency="USD"),
        "archived": make_source(db, ledger, user, name="旧卡", archived=True),
    }


def single(world, **overrides) -> SingleTxInput:
    """A valid expense, with the named fields replaced."""
    values: dict = {
        "source_id": world["checking"].id,
        "kind": "expense",
        "amount": Decimal("-45.50"),
        "currency": "CNY",
        "occurred_at": DAY,
        "category_l1": "groceries",
        "category_l2": "fresh_food",
    }
    values.update(overrides)
    return SingleTxInput(**values)


def create(world, **overrides) -> Transaction:
    return svc.create_single(
        world["db"], world["ledger"], world["user"].id, single(world, **overrides), "web"
    )


def update(world, tx, changes, updated_at=None, client="web") -> Transaction:
    return svc.update_single(
        world["db"],
        world["ledger"],
        world["user"].id,
        tx,
        changes,
        updated_at if updated_at is not None else tx.updated_at,
        client,
    )


def transfer(world, **overrides) -> TransferInput:
    values: dict = {
        "from_source_id": world["checking"].id,
        "to_source_id": world["usd"].id,
        "amount_out": Decimal("100.00"),
        "currency_out": "CNY",
        "amount_in": Decimal("14.00"),
        "currency_in": "USD",
        "occurred_at": DAY,
        "subtype": "plain",
        "note": "换汇",
    }
    values.update(overrides)
    return TransferInput(**values)


def create_transfer(world, **overrides) -> tuple[Transaction, Transaction]:
    return svc.create_transfer(
        world["db"], world["ledger"], world["user"].id, transfer(world, **overrides), "web"
    )


def make_leg(
    world,
    source: FinanceSource,
    role: str,
    amount: Decimal,
    subtype: str = "plain",
    currency: str | None = None,
    occurred_at: dt.date = DAY,
    counterparty: str | None = None,
    note: str | None = None,
) -> Transaction:
    """A single-leg transfer inserted straight into the table."""
    now = utcnow()
    leg = Transaction(
        ledger_id=world["ledger"].id,
        source_id=source.id,
        amount=amount,
        currency=currency or source.default_currency,
        occurred_at=occurred_at,
        kind="transfer",
        transfer_role=role,
        transfer_subtype=subtype,
        counterparty=counterparty,
        note=note,
        created_by=world["user"].id,
        updated_by=world["user"].id,
        created_at=now,
        updated_at=now,
    )
    world["db"].add(leg)
    world["db"].flush()
    return leg


def names(world, tx) -> list[str]:
    """Event names of one transaction, newest first."""
    return [row.event for row in events.list_for(world["db"], tx.id)]


def latest_event(world, tx) -> TransactionEvent:
    return events.list_for(world["db"], tx.id)[0]


# ---------------------------------------------------------------------------
# create_single (§5.26)
# ---------------------------------------------------------------------------


def test_create_expense_writes_row_and_created_event(world):
    tx = create(world, currency="eur", merchant="  Carrefour  ", note="周末采购")

    assert tx.kind == "expense"
    assert tx.amount == Decimal("-45.5000")
    assert tx.currency == "EUR"
    assert tx.merchant == "Carrefour"
    assert tx.transfer_pair_id is None
    assert tx.created_by == tx.updated_by == world["user"].id

    event = latest_event(world, tx)
    assert (event.event, event.changes, event.client) == ("created", None, "web")


def test_create_income_and_refund_and_transfer(world):
    income = create(
        world, kind="income", amount=Decimal("3000"), category_l1="salary", category_l2=None
    )
    expense = create(world)
    refund = create(
        world,
        kind="refund",
        amount=Decimal("10.00"),
        category_l1=None,
        category_l2=None,
        refund_of=expense.id,
    )
    leg = create(
        world,
        kind="transfer",
        amount=Decimal("500"),
        category_l1=None,
        category_l2=None,
        transfer_role="in",
        transfer_subtype="plain",
        counterparty="老婆",
    )

    assert income.kind == "income" and income.amount == Decimal("3000.0000")
    # Decision §1.1: a linked refund without a category inherits the original's.
    assert (refund.category_l1, refund.category_l2) == ("groceries", "fresh_food")
    assert refund.refund_of == expense.id
    assert (leg.category_l1, leg.transfer_role, leg.counterparty) == (None, "in", "老婆")
    assert leg.transfer_pair_id is None


def test_create_refund_keeps_an_explicit_category(world):
    expense = create(world)
    refund = create(
        world,
        kind="refund",
        amount=Decimal("10.00"),
        category_l1="food",
        category_l2="lunch",
        refund_of=expense.id,
    )
    assert (refund.category_l1, refund.category_l2) == ("food", "lunch")


@pytest.mark.parametrize(
    "overrides",
    [
        {"kind": "expense", "amount": Decimal("45.50")},
        {"kind": "income", "amount": Decimal("-1"), "category_l1": "salary", "category_l2": None},
        {"kind": "refund", "amount": Decimal("-1")},
        {"kind": "expense", "amount": Decimal("0")},
    ],
    ids=["expense-positive", "income-negative", "refund-negative", "zero"],
)
def test_create_rejects_a_sign_that_contradicts_kind(world, overrides):
    with pytest.raises(ApiError) as exc:
        create(world, **overrides)
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")


@pytest.mark.parametrize("role, amount", [("out", Decimal("5")), ("in", Decimal("-5"))])
def test_create_rejects_a_transfer_leg_signed_against_its_role(world, role, amount):
    with pytest.raises(ApiError) as exc:
        create(
            world,
            kind="transfer",
            amount=amount,
            category_l1=None,
            category_l2=None,
            transfer_role=role,
            transfer_subtype="plain",
        )
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")


def test_create_rejects_a_transfer_carrying_a_category(world):
    with pytest.raises(ApiError) as exc:
        create(
            world,
            kind="transfer",
            amount=Decimal("500"),
            transfer_role="in",
            transfer_subtype="plain",
        )
    assert (exc.value.status_code, exc.value.code) == (400, "category_invalid")


def test_create_rejects_a_transfer_carrying_a_merchant(world):
    with pytest.raises(ApiError) as exc:
        create(
            world,
            kind="transfer",
            amount=Decimal("500"),
            category_l1=None,
            category_l2=None,
            transfer_role="in",
            transfer_subtype="plain",
            merchant="Carrefour",
        )
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")


def test_create_rejects_a_single_leg_in_another_currency(world):
    """A11: a single leg has no counter leg to carry a second currency."""
    with pytest.raises(ApiError) as exc:
        create(
            world,
            kind="transfer",
            amount=Decimal("500"),
            currency="USD",
            category_l1=None,
            category_l2=None,
            transfer_role="in",
            transfer_subtype="plain",
        )
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")


def test_repayment_is_judged_on_the_incoming_leg_only(world):
    """A11: only the leg the money lands on has to be a credit account."""
    with pytest.raises(ApiError) as exc:
        create(
            world,
            kind="transfer",
            amount=Decimal("3000"),
            category_l1=None,
            category_l2=None,
            transfer_role="in",
            transfer_subtype="repayment",
        )
    assert (exc.value.status_code, exc.value.code) == (400, "repayment_target_not_credit")

    # The same request on the outgoing leg (the debit card's side) is fine.
    out_leg = create(
        world,
        kind="transfer",
        amount=Decimal("-3000"),
        category_l1=None,
        category_l2=None,
        transfer_role="out",
        transfer_subtype="repayment",
    )
    assert out_leg.transfer_subtype == "repayment"

    on_credit = create(
        world,
        source_id=world["credit"].id,
        kind="transfer",
        amount=Decimal("3000"),
        category_l1=None,
        category_l2=None,
        transfer_role="in",
        transfer_subtype="repayment",
    )
    assert on_credit.transfer_subtype == "repayment"


def test_create_rejects_transfer_without_role_or_subtype(world):
    with pytest.raises(ApiError) as exc:
        create(world, kind="transfer", amount=Decimal("500"), category_l1=None, category_l2=None)
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")


def test_create_rejects_transfer_fields_on_a_non_transfer(world):
    with pytest.raises(ApiError) as exc:
        create(world, transfer_role="out", transfer_subtype="plain")
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")


def test_create_rejects_counterparty_on_a_non_transfer(world):
    with pytest.raises(ApiError) as exc:
        create(world, counterparty="老婆")
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")


def test_create_rejects_an_income_category_on_an_expense(world):
    with pytest.raises(ApiError) as exc:
        create(world, category_l1="salary", category_l2=None)
    assert (exc.value.status_code, exc.value.code) == (400, "category_kind_mismatch")


def test_refund_of_must_point_at_an_expense_in_this_ledger(world, db):
    income = create(
        world, kind="income", amount=Decimal("3000"), category_l1="salary", category_l2=None
    )
    with pytest.raises(ApiError) as exc:
        create(
            world,
            kind="refund",
            amount=Decimal("10"),
            refund_of=income.id,
        )
    assert (exc.value.status_code, exc.value.code) == (400, "refund_target_invalid")

    # Another ledger's expense is just as invalid (400, not 404 — §5.26).
    other_user = make_user(db)
    other_ledger = make_ledger(db, other_user)
    other_source = make_source(db, other_ledger, other_user)
    other_world = {"db": db, "user": other_user, "ledger": other_ledger, "checking": other_source}
    foreign_expense = create(other_world)

    with pytest.raises(ApiError) as exc:
        create(world, kind="refund", amount=Decimal("10"), refund_of=foreign_expense.id)
    assert (exc.value.status_code, exc.value.code) == (400, "refund_target_invalid")


def test_refund_of_is_only_allowed_on_a_refund(world):
    expense = create(world)
    with pytest.raises(ApiError) as exc:
        create(world, kind="expense", amount=Decimal("-1"), refund_of=expense.id)
    assert (exc.value.status_code, exc.value.code) == (400, "refund_target_invalid")


def test_create_on_an_archived_account_is_rejected(world):
    with pytest.raises(ApiError) as exc:
        create(world, source_id=world["archived"].id)
    assert (exc.value.status_code, exc.value.code) == (409, "source_archived")


def test_create_on_another_ledgers_account_is_not_found(world, db):
    other_user = make_user(db)
    other_ledger = make_ledger(db, other_user)
    foreign = make_source(db, other_ledger, other_user)

    with pytest.raises(ApiError) as exc:
        create(world, source_id=foreign.id)
    assert (exc.value.status_code, exc.value.code) == (404, "not_found")


def test_create_rejects_a_date_too_far_in_the_future(world):
    with pytest.raises(ApiError) as exc:
        create(world, occurred_at=utcnow().date() + dt.timedelta(days=2))
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")
    # Tomorrow is still allowed (decision §14.44, 03-13).
    assert create(world, occurred_at=utcnow().date() + dt.timedelta(days=1)) is not None


def test_create_rejects_an_unsupported_currency(world):
    with pytest.raises(ApiError) as exc:
        create(world, currency="XXX")
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")


# ---------------------------------------------------------------------------
# update_single (§5.28)
# ---------------------------------------------------------------------------


def test_update_applies_changes_and_writes_one_updated_event(world):
    tx = create(world)
    before_stamp = tx.updated_at

    update(world, tx, {"amount": Decimal("-42.00"), "category_l2": "toiletries", "note": None})

    assert tx.amount == Decimal("-42.0000")
    assert tx.category_l2 == "toiletries"
    assert tx.updated_at > before_stamp
    assert names(world, tx) == ["updated", "created"]
    assert latest_event(world, tx).changes == {
        "amount": {"before": "-45.5000", "after": "-42.0000"},
        "category_l2": {"before": "fresh_food", "after": "toiletries"},
    }


def test_update_with_a_stale_stamp_is_rejected(world):
    tx = create(world)
    stale = tx.updated_at - dt.timedelta(microseconds=1)

    with pytest.raises(ApiError) as exc:
        update(world, tx, {"note": "改一下"}, updated_at=stale)
    assert (exc.value.status_code, exc.value.code) == (409, "stale_update")
    assert names(world, tx) == ["created"]


def test_update_that_changes_nothing_writes_no_event(world):
    tx = create(world)
    before_stamp = tx.updated_at

    update(world, tx, {"amount": Decimal("-45.5000"), "merchant": None})

    assert names(world, tx) == ["created"]
    assert tx.updated_at > before_stamp


def test_update_of_another_field_survives_an_unreachable_upstream(world, monkeypatch):
    """The currency already in effect is waved through (fx.ensure_supported)."""
    from app.services import fx

    tx = create(world)

    dead = httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(503)),
        base_url="https://frankfurter.test/v1",
    )
    monkeypatch.setattr(fx, "HTTP_RETRY_ATTEMPTS", 1)
    fx.reset_state()
    monkeypatch.setattr(fx, "client_factory", lambda: dead)
    try:
        update(world, tx, {"note": "补记"})
    finally:
        dead.close()
        fx.reset_state()

    assert tx.note == "补记"


def test_expense_can_become_a_refund_when_the_whole_row_fits(world):
    tx = create(world)

    update(world, tx, {"kind": "refund", "amount": Decimal("45.50")})

    assert (tx.kind, tx.amount) == ("refund", Decimal("45.5000"))
    assert latest_event(world, tx).changes == {
        "kind": {"before": "expense", "after": "refund"},
        "amount": {"before": "-45.5000", "after": "45.5000"},
    }


def test_expense_cannot_cross_the_transfer_boundary(world):
    """Even a request that satisfies every CHECK is refused (decision §14.3)."""
    tx = create(world)

    with pytest.raises(ApiError) as exc:
        update(
            world,
            tx,
            {
                "kind": "transfer",
                "amount": Decimal("-45.50"),
                "category_l1": None,
                "category_l2": None,
                "transfer_role": "out",
                "transfer_subtype": "plain",
            },
        )
    assert (exc.value.status_code, exc.value.code) == (400, "kind_change_not_allowed")


def test_a_single_leg_transfer_cannot_become_an_expense(world):
    leg = create(
        world,
        kind="transfer",
        amount=Decimal("-500"),
        category_l1=None,
        category_l2=None,
        transfer_role="out",
        transfer_subtype="plain",
    )

    with pytest.raises(ApiError) as exc:
        update(
            world,
            leg,
            {
                "kind": "expense",
                "category_l1": "groceries",
                "transfer_role": None,
                "transfer_subtype": None,
            },
        )
    assert (exc.value.status_code, exc.value.code) == (400, "kind_change_not_allowed")


def test_a_single_leg_transfer_can_change_its_subtype(world):
    leg = create(
        world,
        source_id=world["credit"].id,
        kind="transfer",
        amount=Decimal("3000"),
        category_l1=None,
        category_l2=None,
        transfer_role="in",
        transfer_subtype="plain",
    )

    update(world, leg, {"transfer_subtype": "repayment"})

    assert leg.transfer_subtype == "repayment"
    assert names(world, leg) == ["updated", "created"]


def test_update_revalidates_the_category_side(world):
    tx = create(world)
    with pytest.raises(ApiError) as exc:
        update(world, tx, {"category_l1": "salary", "category_l2": None})
    assert (exc.value.status_code, exc.value.code) == (400, "category_kind_mismatch")


def test_linking_and_unlinking_a_refund_writes_its_own_event(world):
    expense = create(world)
    refund = create(
        world, kind="refund", amount=Decimal("10.00"), category_l1="groceries", category_l2=None
    )

    update(world, refund, {"refund_of": expense.id})
    assert refund.refund_of == expense.id
    assert names(world, refund) == ["refund_linked", "created"]
    assert latest_event(world, refund).changes == {
        "refund_of": {"before": None, "after": str(expense.id)}
    }

    update(world, refund, {"refund_of": None, "note": "解除关联"})
    assert refund.refund_of is None
    # At most two events per PATCH: the plain fields, plus the unlink (§7.2).
    # One PATCH is one instant, so both carry the row's new stamp (§1.9).
    trail = events.list_for(world["db"], refund.id)
    assert {row.event for row in trail[:2]} == {"refund_unlinked", "updated"}
    assert trail[0].at == trail[1].at == refund.updated_at
    plain_fields = next(row for row in trail if row.event == "updated")
    assert plain_fields.changes == {"note": {"before": None, "after": "解除关联"}}


def test_the_created_event_is_stamped_with_the_rows_own_created_at(world):
    """02-database.md §1.9: one operation, one instant — event and row agree."""
    tx = create(world)

    event = latest_event(world, tx)
    assert event.at == tx.created_at == tx.updated_at


def test_one_patch_stamps_both_of_its_events_with_the_rows_updated_at(world):
    """A PATCH that links a refund writes ``updated`` + ``refund_linked`` (§7.2).

    Both belong to the same operation, so both carry the stamp the row itself
    got; ``list_for`` then orders the tie by id, which is what makes the
    detail page's ``events[]`` stable instead of database dependent.
    """
    expense = create(world)
    refund = create(
        world, kind="refund", amount=Decimal("10.00"), category_l1="groceries",
        category_l2=None,
    )

    update(world, refund, {"refund_of": expense.id, "note": "一起改"})

    trail = events.list_for(world["db"], refund.id)
    assert [row.event for row in trail[2:]] == ["created"]
    assert {row.event for row in trail[:2]} == {"updated", "refund_linked"}
    assert trail[0].at == trail[1].at == refund.updated_at
    # Deterministic: the same query twice gives the same order, and it is the
    # one the (at DESC, id DESC) ordering names.
    assert [row.id for row in events.list_for(world["db"], refund.id)] == [
        row.id for row in trail
    ]
    assert trail[0].id > trail[1].id


def test_an_amount_wider_than_the_column_is_rejected(world):
    """NUMERIC(18, 4) holds 14 integer digits; 15 is a 400, not a 500 (§1.6)."""
    with pytest.raises(ApiError) as exc:
        create(world, amount=Decimal("-1" + "0" * 14))
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")

    # The widest amount the column does hold goes through untouched.
    tx = create(world, amount=Decimal("-99999999999999.9999"))
    assert tx.amount == Decimal("-99999999999999.9999")


def test_a_transfer_leg_amount_wider_than_the_column_is_rejected(world):
    with pytest.raises(ApiError) as exc:
        create_transfer(world, amount_in=Decimal("1" + "0" * 20))
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")


def test_an_amount_out_of_the_decimal_context_is_rejected_too(world):
    """``1e40`` cannot even be quantized; it must still be a 400, not a 500."""
    with pytest.raises(ApiError) as exc:
        create(world, amount=Decimal("-1e40"))
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")


def test_update_can_move_a_row_but_not_onto_an_archived_account(world):
    tx = create(world)
    with pytest.raises(ApiError) as exc:
        update(world, tx, {"source_id": world["archived"].id})
    assert (exc.value.status_code, exc.value.code) == (409, "source_archived")

    update(world, tx, {"source_id": world["credit"].id})
    assert tx.source_id == world["credit"].id


def test_history_on_an_archived_account_stays_editable(world):
    """Decision §14.40 (01-12): the row is old, the ban is on new bookings."""
    tx = create(world)
    world["archived"].archived = False
    world["archived"].archived_at = None
    world["db"].flush()
    update(world, tx, {"source_id": world["archived"].id})
    world["archived"].archived = True
    world["archived"].archived_at = utcnow()
    world["db"].flush()

    update(world, tx, {"note": "补一句备注"})
    assert tx.note == "补一句备注"


def test_update_rejects_an_immutable_field(world):
    tx = create(world)
    with pytest.raises(ApiError) as exc:
        update(world, tx, {"transfer_pair_id": uuid.uuid4()})
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")


def test_update_ignores_the_version_token_in_the_body(world):
    tx = create(world)
    update(world, tx, {"note": "ok", "updated_at": tx.updated_at})
    assert tx.note == "ok"


def test_update_of_a_paired_leg_is_refused(world):
    out_leg, _ = create_transfer(world)

    with pytest.raises(ApiError) as exc:
        update(world, out_leg, {"note": "改一下"})
    assert (exc.value.status_code, exc.value.code) == (409, "use_transfer_endpoint")


# ---------------------------------------------------------------------------
# delete_single (§5.29)
# ---------------------------------------------------------------------------


def test_delete_removes_the_row_and_its_events(world, db):
    tx = create(world)
    tx_id = tx.id

    svc.delete_single(db, world["ledger"], tx)

    assert db.get(Transaction, tx_id) is None
    assert db.query(TransactionEvent).filter_by(transaction_id=tx_id).count() == 0


def test_deleting_an_expense_leaves_its_refunds_with_a_null_link(world, db):
    expense = create(world)
    refund = create(
        world,
        kind="refund",
        amount=Decimal("10.00"),
        category_l1=None,
        category_l2=None,
        refund_of=expense.id,
    )

    svc.delete_single(db, world["ledger"], expense)
    db.refresh(refund)

    assert refund.refund_of is None
    # No refund_unlinked event: the database did it, not a person (§7.2).
    assert names(world, refund) == ["created"]


def test_delete_of_a_paired_leg_is_refused(world, db):
    out_leg, in_leg = create_transfer(world)

    with pytest.raises(ApiError) as exc:
        svc.delete_single(db, world["ledger"], out_leg)
    assert (exc.value.status_code, exc.value.code) == (409, "use_transfer_endpoint")
    assert db.get(Transaction, in_leg.id) is not None


# ---------------------------------------------------------------------------
# create_transfer (§5.30)
# ---------------------------------------------------------------------------


def test_create_transfer_books_both_legs_in_one_pair(world):
    out_leg, in_leg = create_transfer(world)

    assert out_leg.transfer_pair_id == in_leg.transfer_pair_id is not None
    assert (out_leg.amount, out_leg.currency) == (Decimal("-100.0000"), "CNY")
    assert (in_leg.amount, in_leg.currency) == (Decimal("14.0000"), "USD")
    assert (out_leg.transfer_role, in_leg.transfer_role) == ("out", "in")
    for leg in (out_leg, in_leg):
        assert leg.kind == "transfer"
        assert leg.transfer_subtype == "plain"
        assert leg.category_l1 is None and leg.merchant is None
        assert leg.counterparty is None
        assert leg.note == "换汇"
        assert names(world, leg) == ["created"]


def test_transfer_currencies_default_to_the_accounts(world):
    out_leg, in_leg = create_transfer(
        world, currency_out=None, currency_in=None, amount_in=Decimal("14")
    )
    assert (out_leg.currency, in_leg.currency) == ("CNY", "USD")


def test_same_currency_transfer_may_omit_amount_in(world, db):
    other = make_source(db, world["ledger"], world["user"], name="现金", type="cash")
    out_leg, in_leg = create_transfer(
        world,
        to_source_id=other.id,
        currency_out=None,
        currency_in=None,
        amount_in=None,
    )
    assert (out_leg.amount, in_leg.amount) == (Decimal("-100.0000"), Decimal("100.0000"))


def test_cross_currency_transfer_must_name_amount_in(world):
    with pytest.raises(ApiError) as exc:
        create_transfer(world, amount_in=None)
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")


def test_repayment_must_land_on_a_credit_account(world):
    with pytest.raises(ApiError) as exc:
        create_transfer(world, subtype="repayment")
    assert (exc.value.status_code, exc.value.code) == (400, "repayment_target_not_credit")

    out_leg, in_leg = create_transfer(
        world,
        to_source_id=world["credit"].id,
        currency_in="CNY",
        amount_in=Decimal("100"),
        subtype="repayment",
    )
    assert (out_leg.transfer_subtype, in_leg.transfer_subtype) == ("repayment", "repayment")


def test_transfer_between_the_same_account_is_refused(world):
    with pytest.raises(ApiError) as exc:
        create_transfer(world, to_source_id=world["checking"].id, currency_in="CNY")
    assert (exc.value.status_code, exc.value.code) == (400, "same_source")


def test_transfer_touching_an_archived_account_is_refused(world):
    with pytest.raises(ApiError) as exc:
        create_transfer(world, to_source_id=world["archived"].id, currency_in="CNY")
    assert (exc.value.status_code, exc.value.code) == (409, "source_archived")


def test_transfer_with_an_unknown_account_is_not_found(world):
    with pytest.raises(ApiError) as exc:
        create_transfer(world, to_source_id=uuid.uuid4())
    assert (exc.value.status_code, exc.value.code) == (404, "not_found")


@pytest.mark.parametrize("field", ["amount_out", "amount_in"])
def test_transfer_amounts_must_be_positive(world, field):
    with pytest.raises(ApiError) as exc:
        create_transfer(world, **{field: Decimal("0")})
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")


def test_transfer_rejects_an_unknown_subtype(world):
    with pytest.raises(ApiError) as exc:
        create_transfer(world, subtype="settlement")
    assert (exc.value.status_code, exc.value.code) == (400, "validation_error")


def test_a_failed_transfer_insert_leaves_no_half_pair(world, db, monkeypatch):
    """§10.2: never one leg on its own — the two rows land or neither does.

    The service only ``flush()``es; the rollback itself belongs to the endpoint
    session, so the case makes the flush fail and checks that rolling back
    really clears both legs.
    """
    real_flush = db.flush

    def exploding_flush(*args, **kwargs):
        raise RuntimeError("insert failed halfway")

    monkeypatch.setattr(db, "flush", exploding_flush)
    with pytest.raises(RuntimeError):
        create_transfer(world)
    monkeypatch.setattr(db, "flush", real_flush)
    db.rollback()

    assert db.query(Transaction).filter_by(kind="transfer").count() == 0


# ---------------------------------------------------------------------------
# get_pair / update_transfer / delete_transfer (§5.31, §5.32)
# ---------------------------------------------------------------------------


def patch_pair(world, pair_id, changes, updated_at) -> tuple[Transaction, Transaction]:
    return svc.update_transfer(
        world["db"], world["ledger"], world["user"].id, pair_id, changes, updated_at, "web"
    )


def test_get_pair_returns_out_then_in(world, db):
    out_leg, in_leg = create_transfer(world)
    assert svc.get_pair(db, world["ledger"], out_leg.transfer_pair_id) == (out_leg, in_leg)


def test_get_pair_of_an_unknown_id_is_not_found(world, db):
    with pytest.raises(ApiError) as exc:
        svc.get_pair(db, world["ledger"], uuid.uuid4())
    assert (exc.value.status_code, exc.value.code) == (404, "not_found")


def test_patch_transfer_writes_the_shared_fields_to_both_legs(world, db):
    out_leg, in_leg = create_transfer(world, to_source_id=world["credit"].id, currency_in="CNY")
    pair_id = out_leg.transfer_pair_id

    patch_pair(
        world,
        pair_id,
        {"occurred_at": dt.date(2026, 9, 6), "subtype": "repayment", "note": "还信用卡"},
        max(out_leg.updated_at, in_leg.updated_at),
    )

    for leg in (out_leg, in_leg):
        assert leg.occurred_at == dt.date(2026, 9, 6)
        assert leg.transfer_subtype == "repayment"
        assert leg.note == "还信用卡"
        assert names(world, leg) == ["updated", "created"]
        assert set(latest_event(world, leg).changes) == {
            "occurred_at",
            "transfer_subtype",
            "note",
        }


def test_patch_transfer_touches_only_the_leg_a_field_belongs_to(world):
    out_leg, in_leg = create_transfer(world)

    patch_pair(
        world,
        out_leg.transfer_pair_id,
        {"amount_in": Decimal("13.50")},
        max(out_leg.updated_at, in_leg.updated_at),
    )

    assert in_leg.amount == Decimal("13.5000")
    assert out_leg.amount == Decimal("-100.0000")
    assert names(world, in_leg) == ["updated", "created"]
    assert names(world, out_leg) == ["created"]


def test_patch_transfer_leaves_a_paired_legs_own_date_and_note_alone(world, db):
    """§14.53a: only the fields a PATCH names are written to both legs.

    A pair tied together by :func:`pair` keeps one date per leg (swipe day vs
    posting day) and one note per statement; an edit of the amount must not
    flatten either.
    """
    out_leg = make_leg(
        world,
        world["checking"],
        "out",
        Decimal("-3000"),
        occurred_at=dt.date(2026, 9, 5),
        note="还信用卡",
    )
    in_leg = make_leg(
        world,
        world["credit"],
        "in",
        Decimal("3000"),
        occurred_at=dt.date(2026, 9, 6),
        note="AUTOPAY",
    )
    do_pair(world, out_leg, in_leg)

    patch_pair(
        world,
        out_leg.transfer_pair_id,
        {"amount_in": Decimal("2999")},
        max(out_leg.updated_at, in_leg.updated_at),
    )

    assert (out_leg.occurred_at, out_leg.note) == (dt.date(2026, 9, 5), "还信用卡")
    assert (in_leg.occurred_at, in_leg.note) == (dt.date(2026, 9, 6), "AUTOPAY")
    assert in_leg.amount == Decimal("2999.0000")
    assert set(latest_event(world, in_leg).changes) == {"amount"}
    assert names(world, out_leg) == ["paired"]


def test_patch_transfer_can_move_a_leg_to_another_account(world, db):
    out_leg, in_leg = create_transfer(world)
    other = make_source(db, world["ledger"], world["user"], name="现金", type="cash")

    patch_pair(
        world,
        out_leg.transfer_pair_id,
        {"from_source_id": other.id},
        max(out_leg.updated_at, in_leg.updated_at),
    )
    assert out_leg.source_id == other.id


def test_patch_transfer_rejects_a_stale_stamp_from_either_leg(world):
    out_leg, in_leg = create_transfer(world)
    newest = max(out_leg.updated_at, in_leg.updated_at)

    with pytest.raises(ApiError) as exc:
        patch_pair(
            world,
            out_leg.transfer_pair_id,
            {"note": "改"},
            newest - dt.timedelta(microseconds=1),
        )
    assert (exc.value.status_code, exc.value.code) == (409, "stale_update")

    # A leg moved on behind the client's back: the echoed stamp is now old.
    patch_pair(world, out_leg.transfer_pair_id, {"note": "第一次"}, newest)
    with pytest.raises(ApiError) as exc:
        patch_pair(world, out_leg.transfer_pair_id, {"note": "第二次"}, newest)
    assert (exc.value.status_code, exc.value.code) == (409, "stale_update")


def test_patch_transfer_rejects_the_same_account_on_both_legs(world):
    out_leg, in_leg = create_transfer(world)
    with pytest.raises(ApiError) as exc:
        patch_pair(
            world,
            out_leg.transfer_pair_id,
            {"to_source_id": world["checking"].id, "currency_in": "CNY"},
            max(out_leg.updated_at, in_leg.updated_at),
        )
    assert (exc.value.status_code, exc.value.code) == (400, "same_source")


def test_patch_transfer_rejects_an_archived_target(world):
    out_leg, in_leg = create_transfer(world)
    with pytest.raises(ApiError) as exc:
        patch_pair(
            world,
            out_leg.transfer_pair_id,
            {"to_source_id": world["archived"].id},
            max(out_leg.updated_at, in_leg.updated_at),
        )
    assert (exc.value.status_code, exc.value.code) == (409, "source_archived")


def test_patch_transfer_rechecks_the_repayment_target(world):
    out_leg, in_leg = create_transfer(world)
    with pytest.raises(ApiError) as exc:
        patch_pair(
            world,
            out_leg.transfer_pair_id,
            {"subtype": "repayment"},
            max(out_leg.updated_at, in_leg.updated_at),
        )
    assert (exc.value.status_code, exc.value.code) == (400, "repayment_target_not_credit")


def test_patch_of_a_half_broken_pair_is_refused(world, db):
    out_leg, in_leg = create_transfer(world)
    pair_id = out_leg.transfer_pair_id
    stamp = max(out_leg.updated_at, in_leg.updated_at)
    db.delete(in_leg)
    db.flush()

    with pytest.raises(ApiError) as exc:
        patch_pair(world, pair_id, {"note": "改"}, stamp)
    assert (exc.value.status_code, exc.value.code) == (409, "transfer_pair_incomplete")


def test_patch_of_an_unknown_pair_is_not_found(world):
    with pytest.raises(ApiError) as exc:
        patch_pair(world, uuid.uuid4(), {"note": "改"}, utcnow())
    assert (exc.value.status_code, exc.value.code) == (404, "not_found")


def test_delete_transfer_removes_both_legs_and_their_events(world, db):
    out_leg, in_leg = create_transfer(world)
    pair_id = out_leg.transfer_pair_id
    ids = [out_leg.id, in_leg.id]

    svc.delete_transfer(db, world["ledger"], pair_id)

    assert [db.get(Transaction, tx_id) for tx_id in ids] == [None, None]
    assert db.query(TransactionEvent).filter(TransactionEvent.transaction_id.in_(ids)).count() == 0


def test_delete_transfer_also_clears_a_half_broken_pair(world, db):
    out_leg, in_leg = create_transfer(world)
    pair_id = out_leg.transfer_pair_id
    remaining = out_leg.id
    db.delete(in_leg)
    db.flush()

    svc.delete_transfer(db, world["ledger"], pair_id)
    assert db.get(Transaction, remaining) is None


def test_delete_of_an_unknown_pair_is_not_found(world, db):
    with pytest.raises(ApiError) as exc:
        svc.delete_transfer(db, world["ledger"], uuid.uuid4())
    assert (exc.value.status_code, exc.value.code) == (404, "not_found")


# ---------------------------------------------------------------------------
# pair / unpair (§5.33, §5.34, decision §14.53a)
# ---------------------------------------------------------------------------


def do_pair(world, first, second) -> tuple[Transaction, Transaction]:
    return svc.pair(
        world["db"], world["ledger"], world["user"].id, first.id, second.id, "web"
    )


def test_pair_ties_two_single_legs_together(world):
    out_leg = make_leg(
        world, world["checking"], "out", Decimal("-3000"), counterparty="工资卡"
    )
    in_leg = make_leg(
        world, world["credit"], "in", Decimal("3000"), occurred_at=dt.date(2026, 9, 2)
    )

    paired_out, paired_in = do_pair(world, in_leg, out_leg)

    assert (paired_out, paired_in) == (out_leg, in_leg)
    assert out_leg.transfer_pair_id == in_leg.transfer_pair_id is not None
    assert out_leg.counterparty is None
    # Decision §14.53a: the two dates stay as they are.
    assert (out_leg.occurred_at, in_leg.occurred_at) == (DAY, dt.date(2026, 9, 2))
    assert names(world, out_leg) == ["paired"]
    assert names(world, in_leg) == ["paired"]

    changes = latest_event(world, out_leg).changes
    assert changes["transfer_pair_id"] == {
        "before": None,
        "after": str(out_leg.transfer_pair_id),
    }
    assert changes["counterparty"] == {"before": "工资卡", "after": None}


def test_paired_event_records_counterparty_even_when_it_was_empty(world):
    """§7.2 asks ``paired`` for both values, not only for the ones that moved."""
    out_leg = make_leg(world, world["checking"], "out", Decimal("-500"))
    in_leg = make_leg(world, world["credit"], "in", Decimal("500"))

    do_pair(world, out_leg, in_leg)

    for leg in (out_leg, in_leg):
        changes = latest_event(world, leg).changes
        assert changes["counterparty"] == {"before": None, "after": None}
        assert changes["transfer_pair_id"] == {
            "before": None,
            "after": str(leg.transfer_pair_id),
        }


@pytest.mark.parametrize(
    "out_subtype, in_subtype, in_account, expected, updated_legs",
    [
        ("plain", "plain", "credit", "plain", 0),
        ("plain", "repayment", "credit", "repayment", 1),
        ("repayment", "plain", "credit", "repayment", 1),
        ("repayment", "repayment", "credit", "repayment", 0),
        ("repayment", "plain", "checking", "plain", 1),
        ("repayment", "repayment", "checking", "plain", 2),
    ],
)
def test_pairing_unifies_the_subtype(
    world, db, out_subtype, in_subtype, in_account, expected, updated_legs
):
    target = world["credit"] if in_account == "credit" else make_source(
        db, world["ledger"], world["user"], name="另一张储蓄卡"
    )
    out_leg = make_leg(world, world["checking"], "out", Decimal("-3000"), out_subtype)
    in_leg = make_leg(world, target, "in", Decimal("3000"), in_subtype)

    do_pair(world, out_leg, in_leg)

    assert out_leg.transfer_subtype == in_leg.transfer_subtype == expected
    changed = [
        leg for leg in (out_leg, in_leg) if "updated" in names(world, leg)
    ]
    assert len(changed) == updated_legs
    for leg in changed:
        trail = events.list_for(world["db"], leg.id)
        # ``paired`` and the subtype ``updated`` come out of the same operation,
        # so they share its stamp (§1.9) and only their pair — not their order —
        # is meaningful; ``created`` stays below them.
        assert {row.event for row in trail[:2]} == {"updated", "paired"}
        assert trail[0].at == trail[1].at == leg.updated_at
        subtype_event = next(row for row in trail if row.event == "updated")
        assert set(subtype_event.changes) == {"transfer_subtype"}


def test_pair_does_not_reject_a_repayment_onto_a_plain_account(world, db):
    """§5.33: the subtype is computed, never used to refuse the pairing."""
    target = make_source(db, world["ledger"], world["user"], name="另一张储蓄卡")
    out_leg = make_leg(world, world["checking"], "out", Decimal("-3000"), "repayment")
    in_leg = make_leg(world, target, "in", Decimal("3000"), "repayment")

    do_pair(world, out_leg, in_leg)
    assert out_leg.transfer_subtype == "plain"


def test_pair_ignores_amount_currency_and_date(world):
    out_leg = make_leg(world, world["checking"], "out", Decimal("-100"))
    in_leg = make_leg(
        world, world["usd"], "in", Decimal("14"), occurred_at=dt.date(2026, 8, 20)
    )

    do_pair(world, out_leg, in_leg)
    assert out_leg.transfer_pair_id == in_leg.transfer_pair_id


def test_pair_with_itself_is_invalid(world):
    leg = make_leg(world, world["checking"], "out", Decimal("-100"))
    with pytest.raises(ApiError) as exc:
        do_pair(world, leg, leg)
    assert (exc.value.status_code, exc.value.code) == (400, "pair_invalid")


def test_pair_needs_two_transfers(world):
    leg = make_leg(world, world["checking"], "out", Decimal("-100"))
    expense = create(world)
    with pytest.raises(ApiError) as exc:
        do_pair(world, leg, expense)
    assert (exc.value.status_code, exc.value.code) == (400, "pair_invalid")


def test_pair_needs_two_single_legs(world):
    out_leg, in_leg = create_transfer(world)
    lonely = make_leg(world, world["credit"], "in", Decimal("100"))
    with pytest.raises(ApiError) as exc:
        do_pair(world, lonely, out_leg)
    assert (exc.value.status_code, exc.value.code) == (400, "pair_invalid")


def test_pair_needs_opposite_directions(world):
    first = make_leg(world, world["checking"], "out", Decimal("-100"))
    second = make_leg(world, world["credit"], "out", Decimal("-100"))
    with pytest.raises(ApiError) as exc:
        do_pair(world, first, second)
    assert (exc.value.status_code, exc.value.code) == (400, "pair_invalid")


def test_pair_needs_two_different_accounts(world):
    first = make_leg(world, world["checking"], "out", Decimal("-100"))
    second = make_leg(world, world["checking"], "in", Decimal("100"))
    with pytest.raises(ApiError) as exc:
        do_pair(world, first, second)
    assert (exc.value.status_code, exc.value.code) == (400, "pair_invalid")


def test_pair_across_ledgers_is_not_found(world, db):
    other_user = make_user(db)
    other_ledger = make_ledger(db, other_user)
    other_source = make_source(db, other_ledger, other_user)
    other_world = {"db": db, "user": other_user, "ledger": other_ledger}
    foreign = make_leg(other_world, other_source, "in", Decimal("100"))
    mine = make_leg(world, world["checking"], "out", Decimal("-100"))

    with pytest.raises(ApiError) as exc:
        do_pair(world, mine, foreign)
    assert (exc.value.status_code, exc.value.code) == (404, "not_found")


def test_unpair_turns_both_legs_back_into_single_ones(world, db):
    out_leg, in_leg = create_transfer(world)
    pair_id = out_leg.transfer_pair_id

    unpaired = svc.unpair(db, world["ledger"], world["user"].id, pair_id, "web")

    assert unpaired == [out_leg, in_leg]
    for leg in unpaired:
        assert leg.transfer_pair_id is None
        assert leg.counterparty is None
        assert names(world, leg) == ["unpaired", "created"]
        assert latest_event(world, leg).changes == {
            "transfer_pair_id": {"before": str(pair_id), "after": None}
        }


def test_after_unpairing_each_leg_can_be_patched_and_deleted(world, db):
    out_leg, in_leg = create_transfer(world)
    svc.unpair(db, world["ledger"], world["user"].id, out_leg.transfer_pair_id, "web")

    update(world, out_leg, {"note": "单腿了"})
    assert out_leg.note == "单腿了"

    svc.delete_single(db, world["ledger"], in_leg)
    assert db.get(Transaction, in_leg.id) is None


def test_unpair_of_a_half_broken_pair_is_refused(world, db):
    out_leg, in_leg = create_transfer(world)
    pair_id = out_leg.transfer_pair_id
    db.delete(in_leg)
    db.flush()

    with pytest.raises(ApiError) as exc:
        svc.unpair(db, world["ledger"], world["user"].id, pair_id, "web")
    assert (exc.value.status_code, exc.value.code) == (409, "unpair_invalid")


def test_unpair_of_an_unknown_pair_is_not_found(world, db):
    with pytest.raises(ApiError) as exc:
        svc.unpair(db, world["ledger"], world["user"].id, uuid.uuid4(), "web")
    assert (exc.value.status_code, exc.value.code) == (404, "not_found")


def test_unify_subtype_rule(world):
    assert svc.unify_subtype("plain", "plain", "credit") == "plain"
    assert svc.unify_subtype("repayment", "plain", "credit") == "repayment"
    assert svc.unify_subtype("plain", "repayment", "credit") == "repayment"
    assert svc.unify_subtype("repayment", "repayment", "checking") == "plain"
    assert svc.unify_subtype("plain", "plain", "checking") == "plain"


# ---------------------------------------------------------------------------
# refund_totals (§5.25, §5.27)
# ---------------------------------------------------------------------------


def test_refund_totals_sums_every_refund_of_an_expense(world, db):
    expense = create(world)
    untouched = create(world, amount=Decimal("-20.00"))
    for amount in (Decimal("10.00"), Decimal("5.00")):
        create(
            world,
            kind="refund",
            amount=amount,
            category_l1=None,
            category_l2=None,
            refund_of=expense.id,
        )

    totals = svc.refund_totals(db, world["ledger"], [expense.id, untouched.id])

    assert totals[expense.id] == (Decimal("15.0000"), Decimal("30.5000"))
    assert totals[untouched.id] == (Decimal("0.0000"), Decimal("20.0000"))


def test_refund_totals_allows_an_over_refunded_expense(world, db):
    expense = create(world, amount=Decimal("-10.00"))
    create(
        world,
        kind="refund",
        amount=Decimal("12.00"),
        category_l1=None,
        category_l2=None,
        refund_of=expense.id,
    )

    refunded, refundable = svc.refund_totals(db, world["ledger"], [expense.id])[expense.id]
    assert (refunded, refundable) == (Decimal("12.0000"), Decimal("-2.0000"))


def test_refund_totals_of_unknown_ids_is_zero(world, db):
    stranger = uuid.uuid4()
    assert svc.refund_totals(db, world["ledger"], [stranger]) == {
        stranger: (Decimal("0.0000"), Decimal("0.0000"))
    }
    assert svc.refund_totals(db, world["ledger"], []) == {}
