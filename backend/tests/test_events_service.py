"""Tests for services/events.py (03-backend-api.md §7, decision §14.51)."""
import datetime as dt
import uuid
from decimal import Decimal

import pytest

from app.core.clock import utcnow
from app.core.security import get_password_hash
from app.models.finance_source import FinanceSource
from app.models.ledger import Ledger, LedgerMember
from app.models.transaction import Transaction
from app.models.transaction_event import TransactionEvent
from app.models.user import User
from app.services import events


# ---------------------------------------------------------------------------
# Local row helpers (the shared factories land in conftest in a sibling task)
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


def make_ledger(db, owner: User) -> Ledger:
    now = utcnow()
    ledger = Ledger(
        name="我的账本",
        base_currency="CNY",
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


def make_source(db, ledger: Ledger, owner: User) -> FinanceSource:
    now = utcnow()
    source = FinanceSource(
        ledger_id=ledger.id,
        name="招行储蓄卡",
        type="checking",
        default_currency="CNY",
        opening_balance=Decimal("0"),
        archived=False,
        created_by=owner.id,
        updated_by=owner.id,
        created_at=now,
        updated_at=now,
    )
    db.add(source)
    db.flush()
    return source


def make_transaction(db, ledger: Ledger, source: FinanceSource, owner: User) -> Transaction:
    now = utcnow()
    tx = Transaction(
        ledger_id=ledger.id,
        source_id=source.id,
        amount=Decimal("-45.5000"),
        currency="CNY",
        occurred_at=dt.date(2026, 9, 1),
        kind="expense",
        category_l1="groceries",
        category_l2="fresh_food",
        created_by=owner.id,
        updated_by=owner.id,
        created_at=now,
        updated_at=now,
    )
    db.add(tx)
    db.flush()
    return tx


@pytest.fixture()
def world(db):
    """A user, a ledger, an account and one expense to hang events on."""
    user = make_user(db)
    ledger = make_ledger(db, user)
    source = make_source(db, ledger, user)
    tx = make_transaction(db, ledger, source, user)
    return {"user": user, "ledger": ledger, "source": source, "tx": tx}


# ---------------------------------------------------------------------------
# record
# ---------------------------------------------------------------------------


def test_record_adds_a_row_without_committing(db, world):
    row = events.record(
        db,
        ledger_id=world["ledger"].id,
        transaction_id=world["tx"].id,
        actor_id=world["user"].id,
        event="created",
        client="web",
    )

    # Still pending: the endpoint owns the transaction (§7.3 rule 1).
    assert row in db.new
    assert db.query(TransactionEvent).count() == 0

    db.flush()
    stored = db.query(TransactionEvent).one()
    assert stored.event == "created"
    assert stored.changes is None
    assert stored.client == "web"
    assert stored.actor_id == world["user"].id
    assert stored.ledger_id == world["ledger"].id
    assert stored.transaction_id == world["tx"].id
    assert stored.import_batch_id is None
    assert isinstance(stored.at, dt.datetime) and stored.at.tzinfo is None


def test_record_stores_changes_and_import_batch(db, world):
    batch_id = None  # no batch row exists here; the column is nullable
    events.record(
        db,
        ledger_id=world["ledger"].id,
        transaction_id=world["tx"].id,
        actor_id=world["user"].id,
        event="updated",
        changes={"amount": {"before": "-45.5000", "after": "-42.0000"}},
        import_batch_id=batch_id,
    )
    db.flush()

    stored = db.query(TransactionEvent).one()
    assert stored.changes == {"amount": {"before": "-45.5000", "after": "-42.0000"}}
    assert stored.client is None


def test_events_are_deleted_with_their_transaction(db, world):
    events.record(
        db,
        ledger_id=world["ledger"].id,
        transaction_id=world["tx"].id,
        actor_id=world["user"].id,
        event="created",
    )
    db.flush()

    db.delete(world["tx"])
    db.flush()

    assert db.query(TransactionEvent).count() == 0


# ---------------------------------------------------------------------------
# list_for
# ---------------------------------------------------------------------------


def test_list_for_returns_newest_first(db, world):
    stamps = [
        dt.datetime(2026, 9, 9, 8, 0, 0),
        dt.datetime(2026, 9, 10, 8, 31, 0),
        dt.datetime(2026, 9, 1, 18, 20, 0),
    ]
    names = ["updated", "paired", "created"]
    for at, name in zip(stamps, names):
        row = events.record(
            db,
            ledger_id=world["ledger"].id,
            transaction_id=world["tx"].id,
            actor_id=world["user"].id,
            event=name,
        )
        row.at = at
    db.flush()

    listed = events.list_for(db, world["tx"].id)
    assert [row.event for row in listed] == ["paired", "updated", "created"]


def test_list_for_only_sees_its_own_transaction(db, world):
    other = make_transaction(db, world["ledger"], world["source"], world["user"])
    events.record(
        db,
        ledger_id=world["ledger"].id,
        transaction_id=world["tx"].id,
        actor_id=world["user"].id,
        event="created",
    )
    events.record(
        db,
        ledger_id=world["ledger"].id,
        transaction_id=other.id,
        actor_id=world["user"].id,
        event="created",
    )
    db.flush()

    listed = events.list_for(db, other.id)
    assert [row.transaction_id for row in listed] == [other.id]


def test_list_for_is_empty_for_an_untouched_transaction(db, world):
    assert events.list_for(db, world["tx"].id) == []


# ---------------------------------------------------------------------------
# diff_changes
# ---------------------------------------------------------------------------


def test_diff_changes_keeps_only_what_moved():
    before = {"amount": Decimal("-45.50"), "merchant": "Carrefour", "note": "周末采购"}
    after = {"amount": Decimal("-42.00"), "merchant": "Carrefour", "note": None}

    diff = events.diff_changes(before, after)

    assert diff == {
        "amount": {"before": "-45.5000", "after": "-42.0000"},
        "note": {"before": "周末采购", "after": None},
    }


def test_diff_changes_ignores_decimal_scale():
    diff = events.diff_changes(
        {"amount": Decimal("-45.5000")}, {"amount": Decimal("-45.50")}
    )
    assert diff == {}


def test_diff_changes_serializes_dates_uuids_and_timestamps():
    target = uuid.UUID("f59f243d-3246-49ab-adb5-60761e061571")
    diff = events.diff_changes(
        {
            "occurred_at": dt.date(2026, 9, 1),
            "refund_of": None,
            "created_at": dt.datetime(2026, 9, 1, 18, 20, 0),
        },
        {
            "occurred_at": dt.date(2026, 9, 4),
            "refund_of": target,
            "created_at": dt.datetime(2026, 9, 2, 6, 0, 0, 442000),
        },
    )

    assert diff["occurred_at"] == {"before": "2026-09-01", "after": "2026-09-04"}
    assert diff["refund_of"] == {
        "before": None,
        "after": "f59f243d-3246-49ab-adb5-60761e061571",
    }
    assert diff["created_at"]["after"] == "2026-09-02T06:00:00.442000Z"


def test_diff_changes_handles_missing_keys_on_either_side():
    diff = events.diff_changes({"category_l2": "fresh_food"}, {"merchant": "Aldi"})

    assert diff == {
        "category_l2": {"before": "fresh_food", "after": None},
        "merchant": {"before": None, "after": "Aldi"},
    }


def test_diff_changes_rounds_amounts_half_up():
    diff = events.diff_changes({"amount": Decimal("1")}, {"amount": Decimal("1.00005")})
    assert diff["amount"] == {"before": "1.0000", "after": "1.0001"}


def test_diff_changes_of_an_unchanged_row_is_empty():
    row = {"kind": "expense", "amount": Decimal("-1.0000"), "refund_of": None}
    assert events.diff_changes(row, dict(row)) == {}


def test_snapshot_reads_the_named_columns(db, world):
    snap = events.snapshot(world["tx"], ("kind", "amount", "category_l1"))
    assert snap == {
        "kind": "expense",
        "amount": Decimal("-45.5000"),
        "category_l1": "groceries",
    }
