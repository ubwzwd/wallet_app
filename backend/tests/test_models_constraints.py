"""CHECK constraints and ON DELETE behaviour, exercised on SQLite (§8.1 rule 2)."""
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.models import (
    ExchangeRate,
    FinanceSource,
    ImportBatch,
    ImportRow,
    Ledger,
    LedgerInvite,
    LedgerMember,
    Transaction,
    TransactionEvent,
    User,
)

NOW = datetime(2026, 9, 12, 10, 0, 0)
TODAY = date(2026, 9, 12)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _reject(db, obj, constraint_name: str | None = None) -> None:
    """Adding ``obj`` must fail; ``constraint_name`` is checked when given."""
    db.add(obj)
    with pytest.raises(IntegrityError) as excinfo:
        db.commit()
    if constraint_name is not None:
        assert constraint_name in str(excinfo.value)
    db.rollback()


def _accept(db, obj):
    db.add(obj)
    db.commit()
    return obj


class World:
    """A minimal, valid graph: one user, one ledger, two accounts."""

    def __init__(self, db):
        self.user = _accept(
            db,
            User(
                email="owner@example.com",
                password_hash="hash",
                base_currency="SGD",
                created_at=NOW,
                updated_at=NOW,
            ),
        )
        self.ledger = _accept(
            db,
            Ledger(
                name="Home",
                base_currency="SGD",
                created_by=self.user.id,
                created_at=NOW,
                updated_at=NOW,
            ),
        )
        self.source = self.make_source(db, "DBS")
        self.other_source = self.make_source(db, "Amex", type_="credit")

    def build_source(self, name: str, type_: str = "checking", **overrides) -> FinanceSource:
        values = {
            "ledger_id": self.ledger.id,
            "name": name,
            "type": type_,
            "default_currency": "SGD",
            "archived": False,
            "created_by": self.user.id,
            "updated_by": self.user.id,
            "created_at": NOW,
            "updated_at": NOW,
        }
        values.update(overrides)
        return FinanceSource(**values)

    def make_source(self, db, name: str, type_: str = "checking") -> FinanceSource:
        return _accept(db, self.build_source(name, type_))

    def transaction(self, **overrides) -> Transaction:
        values = {
            "ledger_id": self.ledger.id,
            "source_id": self.source.id,
            "amount": Decimal("-12.50"),
            "currency": "SGD",
            "occurred_at": TODAY,
            "kind": "expense",
            "category_l1": "food",
            "created_by": self.user.id,
            "updated_by": self.user.id,
            "created_at": NOW,
            "updated_at": NOW,
        }
        values.update(overrides)
        return Transaction(**values)

    def batch(self, **overrides) -> ImportBatch:
        values = {
            "ledger_id": self.ledger.id,
            "source_id": self.source.id,
            "created_by": self.user.id,
            "source": "csv",
            "filename": "dbs.csv",
            "size_bytes": 1024,
            "skill_version": "2026-09-10",
            "status": "ready",
            "row_count": 2,
            "created_at": NOW,
            "updated_at": NOW,
        }
        values.update(overrides)
        return ImportBatch(**values)

    def row(self, **overrides) -> ImportRow:
        values = {
            "row_no": 1,
            "status": "pending",
            "created_at": NOW,
            "updated_at": NOW,
        }
        values.update(overrides)
        return ImportRow(**values)

    def event(self, transaction: Transaction, **overrides) -> TransactionEvent:
        values = {
            "ledger_id": self.ledger.id,
            "transaction_id": transaction.id,
            "actor_id": self.user.id,
            "at": NOW,
            "event": "created",
        }
        values.update(overrides)
        return TransactionEvent(**values)


@pytest.fixture()
def world(db) -> World:
    return World(db)


# ---------------------------------------------------------------------------
# transactions — the eight constraints of §1.6.1 plus the value CHECKs
# ---------------------------------------------------------------------------


def test_valid_transactions_are_accepted(db, world):
    _accept(db, world.transaction())
    _accept(db, world.transaction(kind="income", amount=Decimal("3000"), category_l1="salary"))
    expense = _accept(db, world.transaction(amount=Decimal("-80")))
    _accept(
        db,
        world.transaction(
            kind="refund",
            amount=Decimal("80"),
            category_l1="food",
            refund_of=expense.id,
        ),
    )
    pair_id = uuid.uuid4()
    _accept(
        db,
        world.transaction(
            kind="transfer",
            amount=Decimal("-200"),
            category_l1=None,
            transfer_role="out",
            transfer_subtype="plain",
            transfer_pair_id=pair_id,
        ),
    )
    _accept(
        db,
        world.transaction(
            source_id=world.other_source.id,
            kind="transfer",
            amount=Decimal("200"),
            category_l1=None,
            transfer_role="in",
            transfer_subtype="repayment",
            transfer_pair_id=pair_id,
        ),
    )
    assert db.scalar(select(func.count()).select_from(Transaction)) == 6


def test_kind_must_be_one_of_four(db, world):
    _reject(db, world.transaction(kind="donation"), "ck_transactions_kind")


@pytest.mark.parametrize(
    ("kind", "amount", "extra"),
    [
        ("expense", Decimal("10"), {}),
        ("expense", Decimal("0"), {}),
        ("income", Decimal("-10"), {}),
        ("refund", Decimal("-10"), {}),
        (
            "transfer",
            Decimal("10"),
            {"transfer_role": "out", "transfer_subtype": "plain", "category_l1": None},
        ),
        (
            "transfer",
            Decimal("-10"),
            {"transfer_role": "in", "transfer_subtype": "plain", "category_l1": None},
        ),
    ],
)
def test_amount_sign_must_agree_with_kind(db, world, kind, amount, extra):
    _reject(
        db,
        world.transaction(kind=kind, amount=amount, **extra),
        "ck_transactions_amount_sign",
    )


def test_non_transfer_may_not_carry_a_transfer_role(db, world):
    _reject(db, world.transaction(transfer_role="out"), "ck_transactions_transfer_role")


def test_transfer_without_a_role_is_rejected(db, world):
    # amount_sign already fails here (no branch matches), which is why this one
    # only asserts that the row does not get in.
    _reject(
        db,
        world.transaction(
            kind="transfer",
            amount=Decimal("-10"),
            category_l1=None,
            transfer_subtype="plain",
        ),
    )


def test_non_transfer_may_not_carry_a_transfer_subtype(db, world):
    _reject(db, world.transaction(transfer_subtype="plain"), "ck_transactions_transfer_subtype")


def test_transfer_without_a_subtype_is_rejected(db, world):
    _reject(
        db,
        world.transaction(
            kind="transfer",
            amount=Decimal("-10"),
            category_l1=None,
            transfer_role="out",
        ),
        "ck_transactions_transfer_subtype",
    )


def test_transfer_may_not_have_a_category(db, world):
    _reject(
        db,
        world.transaction(
            kind="transfer",
            amount=Decimal("-10"),
            category_l1="food",
            transfer_role="out",
            transfer_subtype="plain",
        ),
        "ck_transactions_category",
    )


def test_non_transfer_needs_a_first_level_category(db, world):
    _reject(db, world.transaction(category_l1=None), "ck_transactions_category")


def test_second_level_category_cannot_stand_alone(db, world):
    _reject(db, world.transaction(category_l1=None, category_l2="groceries"))


def test_only_a_refund_may_point_at_an_original(db, world):
    original = _accept(db, world.transaction(amount=Decimal("-80")))
    _reject(db, world.transaction(refund_of=original.id), "ck_transactions_refund_of")


def test_a_refund_may_not_point_at_itself(db, world):
    own_id = uuid.uuid4()
    _reject(
        db,
        world.transaction(id=own_id, kind="refund", amount=Decimal("80"), refund_of=own_id),
        "ck_transactions_not_self_refund",
    )


def test_a_paired_leg_may_not_keep_a_counterparty_text(db, world):
    _reject(
        db,
        world.transaction(
            kind="transfer",
            amount=Decimal("-10"),
            category_l1=None,
            transfer_role="out",
            transfer_subtype="plain",
            transfer_pair_id=uuid.uuid4(),
            counterparty="wife",
        ),
        "ck_transactions_counterparty",
    )


def test_a_single_leg_may_carry_a_counterparty_text(db, world):
    _accept(
        db,
        world.transaction(
            kind="transfer",
            amount=Decimal("-10"),
            category_l1=None,
            transfer_role="out",
            transfer_subtype="plain",
            counterparty="wife",
        ),
    )


def test_a_pair_cannot_have_two_legs_in_the_same_direction(db, world):
    pair_id = uuid.uuid4()
    leg = {
        "kind": "transfer",
        "amount": Decimal("-10"),
        "category_l1": None,
        "transfer_role": "out",
        "transfer_subtype": "plain",
        "transfer_pair_id": pair_id,
    }
    _accept(db, world.transaction(**leg))
    _reject(db, world.transaction(source_id=world.other_source.id, **leg))


def test_many_single_legs_may_coexist(db, world):
    """(NULL, NULL) does not participate in the unique constraint."""
    for _ in range(3):
        _accept(
            db,
            world.transaction(
                kind="transfer",
                amount=Decimal("-10"),
                category_l1=None,
                transfer_role="out",
                transfer_subtype="plain",
            ),
        )
    assert db.scalar(select(func.count()).select_from(Transaction)) == 3


def test_transfer_role_and_subtype_values_are_constrained(db, world):
    _reject(
        db,
        world.transaction(
            kind="transfer",
            amount=Decimal("-10"),
            category_l1=None,
            transfer_role="sideways",
            transfer_subtype="plain",
        ),
    )
    _reject(
        db,
        world.transaction(
            kind="transfer",
            amount=Decimal("-10"),
            category_l1=None,
            transfer_role="out",
            transfer_subtype="loan",
        ),
        "ck_transactions_transfer_subtype_values",
    )


def test_currency_must_be_upper_case(db, world):
    _reject(db, world.transaction(currency="sgd"), "ck_transactions_currency_upper")


# ---------------------------------------------------------------------------
# the other tables
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("source_type", ["checking", "credit", "cash", "other"])
def test_the_four_account_types_are_accepted(db, world, source_type):
    world.make_source(db, f"acct-{source_type}", type_=source_type)


def test_a_fifth_account_type_is_rejected(db, world):
    _reject(db, world.build_source("POSB", type_="savings"), "ck_finance_sources_type")


def test_archived_flag_and_archived_at_move_together(db, world):
    _reject(
        db,
        world.build_source("Old card", "credit", archived=True, archived_at=None),
        "ck_finance_sources_archived_at",
    )
    _reject(
        db,
        world.build_source("Old card", "credit", archived=False, archived_at=NOW),
        "ck_finance_sources_archived_at",
    )
    _accept(db, world.build_source("Old card", "credit", archived=True, archived_at=NOW))


def test_account_name_may_not_be_blank(db, world):
    _reject(db, world.build_source("   "), "ck_finance_sources_name_not_blank")


@pytest.mark.parametrize(
    "event",
    ["created", "updated", "imported", "paired", "unpaired", "refund_linked", "refund_unlinked"],
)
def test_the_seven_transaction_events_are_accepted(db, world, event):
    transaction = _accept(db, world.transaction())
    _accept(db, world.event(transaction, event=event))


def test_an_eighth_event_name_is_rejected(db, world):
    transaction = _accept(db, world.transaction())
    _reject(db, world.event(transaction, event="deleted"), "ck_transaction_events_event")


def test_exchange_rate_constraints(db):
    _accept(
        db,
        ExchangeRate(
            date=TODAY, base="SGD", symbol="USD", rate=Decimal("0.74"), fetched_at=NOW
        ),
    )
    _reject(
        db,
        ExchangeRate(date=TODAY, base="SGD", symbol="EUR", rate=Decimal("0"), fetched_at=NOW),
        "ck_exchange_rates_rate_positive",
    )
    _reject(
        db,
        ExchangeRate(date=TODAY, base="SGD", symbol="SGD", rate=Decimal("1"), fetched_at=NOW),
        "ck_exchange_rates_not_self",
    )
    _reject(
        db,
        ExchangeRate(date=TODAY, base="sgd", symbol="USD", rate=Decimal("1.1"), fetched_at=NOW),
        "ck_exchange_rates_base_upper",
    )
    # the composite primary key is the uniqueness rule
    _reject(
        db,
        ExchangeRate(date=TODAY, base="SGD", symbol="USD", rate=Decimal("0.75"), fetched_at=NOW),
    )


def test_user_constraints(db):
    _reject(
        db,
        User(
            email="a@example.com",
            password_hash="h",
            base_currency="sgd",
            created_at=NOW,
            updated_at=NOW,
        ),
        "ck_users_base_currency_upper",
    )
    _reject(
        db,
        User(
            email="a@example.com",
            password_hash="h",
            base_currency="SGD",
            language="fr",
            created_at=NOW,
            updated_at=NOW,
        ),
        "ck_users_language",
    )
    _reject(
        db,
        User(
            email="a@example.com",
            password_hash="h",
            base_currency="SGD",
            display_name="  ",
            created_at=NOW,
            updated_at=NOW,
        ),
        "ck_users_display_name_not_blank",
    )
    _accept(
        db,
        User(
            email="a@example.com",
            password_hash="h",
            base_currency="SGD",
            display_name="Ann",
            language="zh",
            created_at=NOW,
            updated_at=NOW,
        ),
    )
    _reject(
        db,
        User(
            email="a@example.com",
            password_hash="h",
            base_currency="SGD",
            created_at=NOW,
            updated_at=NOW,
        ),
    )


def test_member_role_is_owner_or_member(db, world):
    _reject(
        db,
        LedgerMember(
            ledger_id=world.ledger.id, user_id=world.user.id, role="admin", joined_at=NOW
        ),
        "ck_ledger_members_role",
    )
    _accept(
        db,
        LedgerMember(
            ledger_id=world.ledger.id, user_id=world.user.id, role="owner", joined_at=NOW
        ),
    )


def _invite(world, **overrides) -> LedgerInvite:
    values = {
        "ledger_id": world.ledger.id,
        "code": "123456",
        "created_by": world.user.id,
        "created_at": NOW,
        "expires_at": NOW + timedelta(minutes=10),
    }
    values.update(overrides)
    return LedgerInvite(**values)


def test_invite_code_must_be_six_digits(db, world):
    _accept(db, _invite(world))
    _reject(db, _invite(world, code="12a456"), "ck_ledger_invites_code_digits")
    _reject(db, _invite(world, code="12345"), "ck_ledger_invites_code_digits")
    _reject(db, _invite(world, expires_at=NOW), "ck_ledger_invites_expiry")


def test_the_same_invite_code_may_exist_twice(db, world):
    """No unique index on code (decision §14.29)."""
    _accept(db, _invite(world))
    _accept(db, _invite(world, expires_at=NOW + timedelta(minutes=20)))
    assert db.scalar(select(func.count()).select_from(LedgerInvite)) == 2


def test_import_batch_constraints(db, world):
    _accept(db, world.batch())
    _reject(db, world.batch(source="json"), "ck_import_batches_source")
    _reject(db, world.batch(status="parsing"), "ck_import_batches_status")
    _reject(db, world.batch(source="paste", filename="x.csv"), "ck_import_batches_filename")
    _reject(db, world.batch(filename=None), "ck_import_batches_filename")
    _reject(db, world.batch(size_bytes=0), "ck_import_batches_size")
    _reject(db, world.batch(size_bytes=2097153), "ck_import_batches_size")
    _reject(db, world.batch(row_count=2001), "ck_import_batches_row_count")
    _reject(db, world.batch(status="committed"), "ck_import_batches_committed_at")
    _reject(db, world.batch(committed_at=NOW), "ck_import_batches_committed_at")
    _accept(db, world.batch(source="paste", filename=None))
    _accept(db, world.batch(status="committed", committed_at=NOW))


def test_import_row_constraints(db, world):
    batch = _accept(db, world.batch())
    _accept(db, world.row(batch_id=batch.id))
    _reject(db, world.row(batch_id=batch.id, row_no=2, status="confirmed"), "ck_import_rows_status")
    _reject(db, world.row(batch_id=batch.id, row_no=0), "ck_import_rows_row_no")
    _reject(db, world.row(batch_id=batch.id, row_no=2, kind="donation"), "ck_import_rows_kind")
    _reject(
        db,
        world.row(batch_id=batch.id, row_no=2, transfer_role="sideways"),
        "ck_import_rows_transfer_role",
    )
    _reject(
        db,
        world.row(batch_id=batch.id, row_no=2, transfer_subtype="loan"),
        "ck_import_rows_transfer_subtype",
    )
    # (batch_id, row_no) is unique
    _reject(db, world.row(batch_id=batch.id, row_no=1))


# ---------------------------------------------------------------------------
# ON DELETE behaviour (needs PRAGMA foreign_keys=ON, §8.1 rule 3)
# ---------------------------------------------------------------------------


def test_foreign_keys_are_enforced(db, world):
    _reject(db, world.transaction(source_id=uuid.uuid4()))


def test_deleting_a_transaction_removes_its_events(db, world):
    transaction = _accept(db, world.transaction())
    for event in ("created", "updated", "refund_linked"):
        _accept(db, world.event(transaction, event=event))
    assert db.scalar(select(func.count()).select_from(TransactionEvent)) == 3

    db.execute(delete(Transaction).where(Transaction.id == transaction.id))
    db.commit()
    assert db.scalar(select(func.count()).select_from(TransactionEvent)) == 0


def test_deleting_an_original_only_clears_refund_of(db, world):
    original = _accept(db, world.transaction(amount=Decimal("-80")))
    refund = _accept(
        db,
        world.transaction(kind="refund", amount=Decimal("80"), refund_of=original.id),
    )

    db.execute(delete(Transaction).where(Transaction.id == original.id))
    db.commit()
    db.expire_all()
    assert db.get(Transaction, refund.id).refund_of is None


def test_deleting_a_ledger_cascades_to_everything_it_owns(db, world):
    _accept(
        db,
        LedgerMember(
            ledger_id=world.ledger.id, user_id=world.user.id, role="owner", joined_at=NOW
        ),
    )
    _accept(db, _invite(world))
    transaction = _accept(db, world.transaction())
    _accept(db, world.event(transaction))
    batch = _accept(db, world.batch())
    _accept(db, world.row(batch_id=batch.id))

    db.execute(delete(Ledger).where(Ledger.id == world.ledger.id))
    db.commit()

    for model in (
        LedgerMember,
        LedgerInvite,
        FinanceSource,
        Transaction,
        TransactionEvent,
        ImportBatch,
        ImportRow,
    ):
        assert db.scalar(select(func.count()).select_from(model)) == 0, model.__name__
    # users survive: nothing cascades into them
    assert db.scalar(select(func.count()).select_from(User)) == 1


def test_deleting_a_batch_removes_its_rows_and_unlinks_transactions(db, world):
    batch = _accept(db, world.batch())
    _accept(db, world.row(batch_id=batch.id))
    _accept(db, world.row(batch_id=batch.id, row_no=2))
    transaction = _accept(db, world.transaction(import_batch_id=batch.id))
    event = _accept(db, world.event(transaction, event="imported", import_batch_id=batch.id))

    db.execute(delete(ImportBatch).where(ImportBatch.id == batch.id))
    db.commit()
    db.expire_all()

    assert db.scalar(select(func.count()).select_from(ImportRow)) == 0
    assert db.get(Transaction, transaction.id).import_batch_id is None
    assert db.get(TransactionEvent, event.id).import_batch_id is None
