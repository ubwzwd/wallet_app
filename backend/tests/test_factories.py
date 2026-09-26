"""Tests for the account/transaction test factories in conftest.py."""
from decimal import Decimal

from app.core.clock import utcnow
from app.models.ledger_source import LedgerSource


def test_source_factory_defaults(db, user_factory, ledger_factory, source_factory):
    owner = user_factory()
    ledger = ledger_factory(owner)

    source = source_factory(ledger)

    # owned by the ledger's creator and shared into the ledger (§14.62)
    assert source.owner_id == owner.id
    share = db.get(LedgerSource, (ledger.id, source.id))
    assert share is not None
    assert share.shared_by == owner.id
    assert source.type == "checking"
    assert source.default_currency == "CNY"
    assert source.opening_balance == Decimal("0")
    assert source.archived is False
    assert source.archived_at is None
    assert source.created_by == owner.id
    assert source.updated_by == owner.id


def test_source_factory_archived_sets_archived_at(db, user_factory, ledger_factory, source_factory):
    owner = user_factory()
    ledger = ledger_factory(owner)

    source = source_factory(ledger, archived=True)

    assert source.archived is True
    assert source.archived_at is not None


def test_source_factory_custom_created_by(db, user_factory, ledger_factory, source_factory):
    owner = user_factory()
    member = user_factory()
    ledger = ledger_factory(owner, members=[member])

    source = source_factory(ledger, created_by=member.id)

    assert source.created_by == member.id
    assert source.updated_by == member.id
    assert source.owner_id == member.id
    assert db.get(LedgerSource, (ledger.id, source.id)).shared_by == member.id


def test_transaction_factory_expense_defaults(
    db, user_factory, ledger_factory, source_factory, transaction_factory
):
    owner = user_factory()
    ledger = ledger_factory(owner)
    source = source_factory(ledger)

    tx = transaction_factory(ledger, source)

    assert tx.kind == "expense"
    assert tx.amount < 0
    assert tx.currency == source.default_currency
    assert tx.category_l1 == "food"
    assert tx.transfer_role is None
    assert tx.transfer_subtype is None
    assert tx.occurred_at == utcnow().date()
    assert tx.created_by == owner.id


def test_transaction_factory_income(
    db, user_factory, ledger_factory, source_factory, transaction_factory
):
    owner = user_factory()
    ledger = ledger_factory(owner)
    source = source_factory(ledger)

    tx = transaction_factory(
        ledger, source, kind="income", amount=Decimal("100.0000"), category_l1="salary"
    )

    assert tx.amount > 0
    assert tx.category_l1 == "salary"


def test_transaction_factory_transfer_infers_role_and_subtype(
    db, user_factory, ledger_factory, source_factory, transaction_factory
):
    owner = user_factory()
    ledger = ledger_factory(owner)
    source = source_factory(ledger)

    out_leg = transaction_factory(
        ledger,
        source,
        kind="transfer",
        amount=Decimal("-50.0000"),
        transfer_pair_id=__import__("uuid").uuid4(),
    )

    assert out_leg.transfer_role == "out"
    assert out_leg.transfer_subtype == "plain"
    assert out_leg.category_l1 is None
    assert out_leg.category_l2 is None

    in_source = source_factory(ledger, name="现金")
    in_leg = transaction_factory(
        ledger,
        in_source,
        kind="transfer",
        amount=Decimal("50.0000"),
        transfer_pair_id=out_leg.transfer_pair_id,
    )

    assert in_leg.transfer_role == "in"


def test_pair_factory_shares_pair_id_and_opposite_signs(
    db, user_factory, ledger_factory, source_factory, pair_factory
):
    owner = user_factory()
    ledger = ledger_factory(owner)
    checking = source_factory(ledger, name="招行储蓄卡")
    cash = source_factory(ledger, name="现金", type="cash")

    out_leg, in_leg = pair_factory(ledger, checking, cash, amount_out=Decimal("-200.0000"))

    assert out_leg.transfer_pair_id == in_leg.transfer_pair_id
    assert out_leg.transfer_role == "out"
    assert in_leg.transfer_role == "in"
    assert out_leg.amount == Decimal("-200.0000")
    assert in_leg.amount == Decimal("200.0000")
    assert out_leg.kind == "transfer"
    assert in_leg.kind == "transfer"


def test_pair_factory_explicit_amount_in(
    db, user_factory, ledger_factory, source_factory, pair_factory
):
    owner = user_factory()
    ledger = ledger_factory(owner)
    sgd_source = source_factory(ledger, name="星展", currency="SGD")
    cny_source = source_factory(ledger, name="招行", currency="CNY")

    out_leg, in_leg = pair_factory(
        ledger,
        sgd_source,
        cny_source,
        amount_out=Decimal("-100.0000"),
        amount_in=Decimal("520.0000"),
        currency_out="SGD",
        currency_in="CNY",
    )

    assert out_leg.currency == "SGD"
    assert in_leg.currency == "CNY"
    assert out_leg.amount == Decimal("-100.0000")
    assert in_leg.amount == Decimal("520.0000")
