"""Commit and revert of an import batch (05 §4.3-§4.8, §7.4's service half).

Every case drives ``commit_batch`` / ``delete_batch`` straight on the ``db``
session, the way the endpoint will: the service flushes, the caller commits.
The three transfer landings of §4.5, the events of §4.6, the single-transaction
rollback of §4.7 and both delete modes of §4.8 each have their own case.
"""
import datetime as dt
import uuid
from dataclasses import dataclass
from decimal import Decimal

import pytest

from app.core.categories import CATEGORY_VERSION
from app.core.clock import utcnow
from app.core.errors import ApiError
from app.models.finance_source import FinanceSource
from app.models.import_batch import ImportBatch, ImportRow
from app.models.ledger_source import LedgerSource
from app.models.transaction import Transaction
from app.models.transaction_event import TransactionEvent
from app.services.importing.committing import commit_batch, delete_batch

DAY = dt.date(2026, 8, 20)


@dataclass
class World:
    """One ledger, its owner, a second member and three accounts."""

    user: object
    member: object
    ledger: object
    credit: FinanceSource
    checking: FinanceSource
    cash: FinanceSource


@pytest.fixture()
def world(user_factory, ledger_factory, source_factory) -> World:
    owner = user_factory()
    member = user_factory()
    ledger = ledger_factory(owner, members=[member])
    return World(
        user=owner,
        member=member,
        ledger=ledger,
        credit=source_factory(ledger, name="信用卡", type="credit"),
        checking=source_factory(ledger, name="储蓄卡", type="checking"),
        cash=source_factory(ledger, name="现金", type="cash"),
    )


def make_batch(db, world: World, source: FinanceSource | None = None, status="ready"):
    """An ``import_batches`` row, as the upload endpoint would have written it."""
    now = utcnow()
    batch = ImportBatch(
        ledger_id=world.ledger.id,
        source_id=(source or world.credit).id,
        created_by=world.user.id,
        source="csv",
        filename="bill.csv",
        size_bytes=512,
        skill_version=CATEGORY_VERSION,
        status=status,
        row_count=0,
        created_at=now,
        updated_at=now,
        committed_at=now if status == "committed" else None,
    )
    db.add(batch)
    db.flush()
    return batch


def add_row(db, batch: ImportBatch, **overrides) -> ImportRow:
    """One draft row; the defaults are a valid 10 CNY expense."""
    now = utcnow()
    values: dict = {
        "status": "pending",
        "occurred_at": DAY,
        "amount": Decimal("-10.0000"),
        "currency": "CNY",
        "kind": "expense",
        "category_l1": "food",
        "merchant": "便利店",
    }
    values.update(overrides)
    row_no = values.pop("row_no", None) or len(db.query(ImportRow).filter_by(
        batch_id=batch.id).all()) + 1
    row = ImportRow(batch_id=batch.id, row_no=row_no, created_at=now,
                    updated_at=now, **values)
    db.add(row)
    batch.row_count = row_no
    db.flush()
    return row


def imported(db, batch_id) -> list[Transaction]:
    """The transactions one batch created, oldest row first."""
    return (
        db.query(Transaction)
        .filter(Transaction.import_batch_id == batch_id)
        .order_by(Transaction.amount)
        .all()
    )


def event_names(db, transaction_id) -> list[str]:
    return [
        row.event
        for row in db.query(TransactionEvent)
        .filter(TransactionEvent.transaction_id == transaction_id)
        .all()
    ]


# ---------------------------------------------------------------------------
# §4.5 ①: pair with a single leg that is already in the ledger
# ---------------------------------------------------------------------------


def test_pairs_with_existing_leg_and_unifies_subtype(db, world, transaction_factory):
    leg = transaction_factory(
        world.ledger,
        world.checking,
        kind="transfer",
        amount=Decimal("-3000.0000"),
        occurred_at=dt.date(2026, 8, 19),
        transfer_role="out",
        transfer_subtype="plain",
        counterparty="招行信用卡",
    )
    batch = make_batch(db, world)  # the credit-card statement
    row = add_row(
        db,
        batch,
        kind="transfer",
        amount=Decimal("3000.0000"),
        category_l1=None,
        merchant=None,
        transfer_role="in",
        transfer_subtype="repayment",
        matched_transaction_id=leg.id,
    )

    result = commit_batch(db, batch.id, world.member.id, "web")

    assert (result.transaction_count, result.paired_count) == (1, 1)
    assert result.created_transfer_pairs == 0
    near = imported(db, batch.id)[0]
    assert near.transfer_pair_id is not None
    assert leg.transfer_pair_id == near.transfer_pair_id
    assert (near.counterparty, leg.counterparty) == (None, None)
    # Decision §14.53a: the money lands on a credit card, so the whole pair is
    # a repayment even though the savings statement called it a plain transfer.
    assert (near.transfer_subtype, leg.transfer_subtype) == ("repayment", "repayment")
    assert leg.occurred_at == dt.date(2026, 8, 19)  # dates are not aligned
    assert row.transaction_id == near.id
    assert near.created_by == world.member.id  # the committer, not the uploader

    assert event_names(db, near.id) == ["imported"]
    assert sorted(event_names(db, leg.id)) == ["paired", "updated"]
    paired = db.query(TransactionEvent).filter_by(
        transaction_id=leg.id, event="paired").one()
    assert paired.changes["counterparty"] == {"before": "招行信用卡", "after": None}
    assert paired.changes["transfer_pair_id"]["after"] == str(near.transfer_pair_id)
    assert (paired.import_batch_id, paired.client) == (batch.id, "web")
    assert paired.actor_id == world.member.id
    updated = db.query(TransactionEvent).filter_by(
        transaction_id=leg.id, event="updated").one()
    assert updated.changes == {
        "transfer_subtype": {"before": "plain", "after": "repayment"}
    }
    assert batch.status == "committed" and batch.committed_at is not None


def test_pairing_downgrades_to_plain_when_target_is_not_credit(
    db, world, transaction_factory
):
    """The incoming leg is a savings account, so the pair cannot be a repayment."""
    leg = transaction_factory(
        world.ledger,
        world.checking,
        kind="transfer",
        amount=Decimal("800.0000"),
        transfer_role="in",
        transfer_subtype="repayment",
    )
    batch = make_batch(db, world, source=world.cash)
    add_row(
        db,
        batch,
        kind="transfer",
        amount=Decimal("-800.0000"),
        category_l1=None,
        merchant=None,
        transfer_role="out",
        transfer_subtype="plain",
        matched_transaction_id=leg.id,
    )

    commit_batch(db, batch.id, world.user.id, None)

    near = imported(db, batch.id)[0]
    assert (near.transfer_subtype, leg.transfer_subtype) == ("plain", "plain")
    assert sorted(event_names(db, leg.id)) == ["paired", "updated"]


def test_pairing_without_subtype_change_writes_no_updated_event(
    db, world, transaction_factory
):
    leg = transaction_factory(
        world.ledger,
        world.checking,
        kind="transfer",
        amount=Decimal("-50.0000"),
        transfer_role="out",
        transfer_subtype="plain",
    )
    batch = make_batch(db, world, source=world.cash)
    add_row(
        db,
        batch,
        kind="transfer",
        amount=Decimal("50.0000"),
        category_l1=None,
        merchant=None,
        transfer_role="in",
        transfer_subtype="plain",
        matched_transaction_id=leg.id,
    )

    commit_batch(db, batch.id, world.user.id, None)
    assert event_names(db, leg.id) == ["paired"]


# ---------------------------------------------------------------------------
# §4.5 ② and ③: two fresh legs, or one
# ---------------------------------------------------------------------------


def test_counterpart_source_creates_both_legs(db, world):
    batch = make_batch(db, world, source=world.checking)
    row = add_row(
        db,
        batch,
        kind="transfer",
        amount=Decimal("-500.0000"),
        category_l1=None,
        merchant=None,
        note="转给现金",
        transfer_role="out",
        transfer_subtype="plain",
        counterpart_source_id=world.cash.id,
    )

    result = commit_batch(db, batch.id, world.user.id, "web")

    assert (result.transaction_count, result.created_transfer_pairs) == (2, 1)
    assert result.paired_count == 0
    legs = imported(db, batch.id)
    out_leg, in_leg = legs[0], legs[1]
    assert out_leg.transfer_pair_id == in_leg.transfer_pair_id is not None
    assert (out_leg.source_id, in_leg.source_id) == (world.checking.id, world.cash.id)
    assert (out_leg.amount, in_leg.amount) == (Decimal("-500.0000"), Decimal("500.0000"))
    assert (out_leg.transfer_role, in_leg.transfer_role) == ("out", "in")
    assert (out_leg.counterparty, in_leg.counterparty) == (None, None)
    assert in_leg.occurred_at == out_leg.occurred_at == DAY
    assert in_leg.currency == out_leg.currency == "CNY"
    assert row.transaction_id == out_leg.id  # the near leg
    for leg in legs:
        assert event_names(db, leg.id) == ["imported"]


def test_single_leg_keeps_the_counterparty_text(db, world):
    batch = make_batch(db, world, source=world.checking)
    add_row(
        db,
        batch,
        kind="transfer",
        amount=Decimal("-200.0000"),
        category_l1=None,
        merchant=None,
        transfer_role="out",
        transfer_subtype="plain",
        counterparty="老婆",
    )

    result = commit_batch(db, batch.id, world.user.id, None)

    tx = imported(db, batch.id)[0]
    assert result.transaction_count == 1 and result.created_transfer_pairs == 0
    assert tx.transfer_pair_id is None and tx.counterparty == "老婆"


def test_refund_row_writes_refund_of(db, world, transaction_factory):
    original = transaction_factory(
        world.ledger,
        world.credit,
        amount=Decimal("-1299.0000"),
        category_l1="shopping",
        merchant="京东",
    )
    batch = make_batch(db, world)
    add_row(
        db,
        batch,
        kind="refund",
        amount=Decimal("299.0000"),
        category_l1="shopping",
        matched_transaction_id=original.id,
    )

    result = commit_batch(db, batch.id, world.user.id, None)

    refund = imported(db, batch.id)[0]
    assert result.linked_refunds == 1
    assert refund.refund_of == original.id
    # §4.6: no refund_linked, the imported event already says it all.
    assert event_names(db, refund.id) == ["imported"]


def test_expense_and_income_signs_follow_kind(db, world):
    batch = make_batch(db, world)
    add_row(db, batch, amount=Decimal("120.0000"), category_l1="food")
    add_row(db, batch, kind="income", amount=Decimal("-8000.0000"), category_l1="salary")

    commit_batch(db, batch.id, world.user.id, None)

    amounts = sorted(tx.amount for tx in imported(db, batch.id))
    assert amounts == [Decimal("-120.0000"), Decimal("8000.0000")]


def test_skipped_rows_are_not_booked(db, world):
    batch = make_batch(db, world)
    add_row(db, batch)
    skipped = add_row(db, batch, status="skipped", category_l1=None, kind=None)

    result = commit_batch(db, batch.id, world.user.id, None)

    assert (result.transaction_count, result.skipped_rows) == (1, 1)
    assert skipped.transaction_id is None


# ---------------------------------------------------------------------------
# §4.3: the pre-commit checks
# ---------------------------------------------------------------------------


def commit_error(db, batch, actor_id) -> ApiError:
    with pytest.raises(ApiError) as excinfo:
        commit_batch(db, batch.id, actor_id, None)
    return excinfo.value


def test_second_commit_is_rejected(db, world):
    batch = make_batch(db, world)
    add_row(db, batch)
    commit_batch(db, batch.id, world.user.id, None)

    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (409, "batch_already_committed")
    assert len(imported(db, batch.id)) == 1


def test_missing_column_is_batch_not_ready(db, world):
    batch = make_batch(db, world)
    add_row(db, batch)
    add_row(db, batch, currency=None)

    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (409, "batch_not_ready")
    assert error.rows == [2] and error.body()["rows"] == [2]


def test_zero_amount_is_batch_not_ready(db, world):
    batch = make_batch(db, world)
    add_row(db, batch, amount=Decimal("0.0000"))
    assert commit_error(db, batch, world.user.id).code == "batch_not_ready"


def test_transfer_without_role_is_batch_not_ready(db, world):
    batch = make_batch(db, world)
    add_row(db, batch, kind="transfer", category_l1=None, merchant=None)
    assert commit_error(db, batch, world.user.id).code == "batch_not_ready"


def test_all_rows_skipped(db, world):
    batch = make_batch(db, world)
    add_row(db, batch, status="skipped")
    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (409, "rows_all_skipped")


def test_uncategorized_rows_block_the_commit(db, world):
    batch = make_batch(db, world)
    add_row(db, batch)
    add_row(db, batch, category_l1=None)
    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (409, "rows_uncategorized")
    assert error.rows == [2]


def test_category_on_the_wrong_side(db, world):
    batch = make_batch(db, world)
    add_row(db, batch, category_l1="salary")
    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (400, "category_kind_mismatch")
    assert error.rows == [1]


def test_transfer_row_with_a_category(db, world):
    batch = make_batch(db, world)
    add_row(
        db,
        batch,
        kind="transfer",
        amount=Decimal("-30.0000"),
        transfer_role="out",
        transfer_subtype="plain",
        category_l1="food",
        merchant=None,
    )
    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (400, "category_invalid")


def test_refund_target_must_be_an_expense(db, world, transaction_factory):
    income = transaction_factory(
        world.ledger, world.credit, kind="income", amount=Decimal("100.0000"),
        category_l1="salary",
    )
    batch = make_batch(db, world)
    add_row(db, batch, kind="refund", amount=Decimal("10.0000"),
            matched_transaction_id=income.id)
    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (400, "refund_target_invalid")


def test_pair_target_must_still_be_a_single_leg(db, world, pair_factory):
    out_leg, _ = pair_factory(
        world.ledger, world.checking, world.cash, amount_out=Decimal("-70.0000")
    )
    batch = make_batch(db, world)
    add_row(db, batch, kind="transfer", amount=Decimal("70.0000"), category_l1=None,
            merchant=None, transfer_role="in", transfer_subtype="plain",
            matched_transaction_id=out_leg.id)
    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (400, "pair_invalid")


def test_pair_target_must_point_the_other_way(db, world, transaction_factory):
    leg = transaction_factory(
        world.ledger, world.checking, kind="transfer", amount=Decimal("60.0000"),
        transfer_role="in", transfer_subtype="plain",
    )
    batch = make_batch(db, world)
    add_row(db, batch, kind="transfer", amount=Decimal("60.0000"), category_l1=None,
            merchant=None, transfer_role="in", transfer_subtype="plain",
            matched_transaction_id=leg.id)
    assert commit_error(db, batch, world.user.id).code == "pair_invalid"


def test_counterpart_account_of_another_ledger(db, world, user_factory,
                                               ledger_factory, source_factory):
    stranger = user_factory()
    far_source = source_factory(ledger_factory(stranger), name="别人的卡")
    batch = make_batch(db, world, source=world.checking)
    add_row(db, batch, kind="transfer", amount=Decimal("-40.0000"), category_l1=None,
            merchant=None, transfer_role="out", transfer_subtype="plain",
            counterpart_source_id=far_source.id)
    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (404, "not_found")


def unshare(db, ledger, source) -> None:
    db.execute(
        LedgerSource.__table__.delete().where(
            LedgerSource.ledger_id == ledger.id, LedgerSource.source_id == source.id
        )
    )
    db.flush()


def test_counterpart_unshared_after_review_is_not_found(db, world, source_factory):
    """§14.62: a member withdraws their card between review and commit."""
    theirs = source_factory(world.ledger, name="她的卡", created_by=world.member.id)
    batch = make_batch(db, world, source=world.checking)
    add_row(db, batch, kind="transfer", amount=Decimal("-40.0000"), category_l1=None,
            merchant=None, transfer_role="out", transfer_subtype="plain",
            counterpart_source_id=theirs.id)
    unshare(db, world.ledger, theirs)

    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (404, "not_found")
    assert db.query(Transaction).filter_by(import_batch_id=batch.id).count() == 0


def _pair_row_onto(db, world, transaction_factory, source):
    """A credit-card batch whose one row pairs with an out leg on ``source``."""
    leg = transaction_factory(
        world.ledger, source, kind="transfer", amount=Decimal("-3000.0000"),
        occurred_at=DAY, transfer_role="out", transfer_subtype="plain",
    )
    batch = make_batch(db, world)
    add_row(db, batch, kind="transfer", amount=Decimal("3000.0000"), category_l1=None,
            merchant=None, transfer_role="in", transfer_subtype="repayment",
            matched_transaction_id=leg.id)
    return batch, leg


def test_pair_target_on_an_unshared_account_is_not_found(
    db, world, source_factory, transaction_factory
):
    """§5.33 1a / §14.62 e: pairing touches the far leg, so its account must be usable."""
    theirs = source_factory(world.ledger, name="她的卡", created_by=world.member.id)
    batch, leg = _pair_row_onto(db, world, transaction_factory, theirs)
    unshare(db, world.ledger, theirs)

    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (404, "not_found")
    assert leg.transfer_pair_id is None
    assert db.query(Transaction).filter_by(import_batch_id=batch.id).count() == 0


def test_pair_target_on_an_archived_account_is_refused(
    db, world, source_factory, transaction_factory
):
    old = source_factory(world.ledger, name="旧储蓄卡")
    batch, leg = _pair_row_onto(db, world, transaction_factory, old)
    old.archived, old.archived_at = True, utcnow()
    db.flush()

    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (409, "source_archived")
    assert leg.transfer_pair_id is None


def test_counterpart_is_judged_for_the_uploader_not_the_committer(
    db, world, owned_source_factory
):
    """The uploader's own unshared card stays a valid counterpart whoever commits."""
    private = owned_source_factory(world.user, name="私房卡")
    batch = make_batch(db, world, source=world.checking)
    add_row(db, batch, kind="transfer", amount=Decimal("-40.0000"), category_l1=None,
            merchant=None, transfer_role="out", transfer_subtype="plain",
            counterpart_source_id=private.id)

    result = commit_batch(db, batch.id, world.member.id, "web")
    assert result.created_transfer_pairs == 1
    assert {tx.source_id for tx in imported(db, batch.id)} == {world.checking.id, private.id}


def test_archived_counterpart_account(db, world, source_factory):
    archived = source_factory(world.ledger, name="旧卡", archived=True)
    batch = make_batch(db, world, source=world.checking)
    add_row(db, batch, kind="transfer", amount=Decimal("-40.0000"), category_l1=None,
            merchant=None, transfer_role="out", transfer_subtype="plain",
            counterpart_source_id=archived.id)
    assert commit_error(db, batch, world.user.id).code == "not_found"


def test_counterpart_account_cannot_be_the_batch_target(db, world):
    batch = make_batch(db, world, source=world.checking)
    add_row(db, batch, kind="transfer", amount=Decimal("-40.0000"), category_l1=None,
            merchant=None, transfer_role="out", transfer_subtype="plain",
            counterpart_source_id=world.checking.id)
    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (400, "same_source")


def test_single_leg_repayment_needs_a_credit_account(db, world):
    batch = make_batch(db, world, source=world.checking)
    add_row(db, batch, kind="transfer", amount=Decimal("900.0000"), category_l1=None,
            merchant=None, transfer_role="in", transfer_subtype="repayment")
    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (400, "repayment_target_not_credit")


def test_new_pair_repayment_needs_a_credit_account(db, world):
    """03 §5.43: landing ② builds a pair, so A11 is enforced, not downgraded."""
    batch = make_batch(db, world, source=world.checking)
    add_row(db, batch, kind="transfer", amount=Decimal("900.0000"), category_l1=None,
            merchant=None, transfer_role="in", transfer_subtype="repayment",
            counterpart_source_id=world.cash.id)
    assert commit_error(db, batch, world.user.id).code == "repayment_target_not_credit"


def test_new_pair_repayment_onto_a_credit_card_is_fine(db, world):
    batch = make_batch(db, world)  # the credit card is the batch target
    add_row(db, batch, kind="transfer", amount=Decimal("900.0000"), category_l1=None,
            merchant=None, transfer_role="in", transfer_subtype="repayment",
            counterpart_source_id=world.checking.id)

    commit_batch(db, batch.id, world.user.id, None)
    assert {tx.transfer_subtype for tx in imported(db, batch.id)} == {"repayment"}


def test_archived_target_account(db, world):
    batch = make_batch(db, world)
    add_row(db, batch)
    world.credit.archived = True
    world.credit.archived_at = utcnow()
    db.flush()
    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (409, "source_archived")


def test_target_account_unshared_after_upload_is_not_found(db, world, source_factory):
    """Same error path as an archived or deleted counterpart (§14.62)."""
    theirs = source_factory(
        world.ledger, name="她的信用卡", type="credit", created_by=world.member.id
    )
    batch = make_batch(db, world, source=theirs)
    add_row(db, batch)
    unshare(db, world.ledger, theirs)

    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (404, "not_found")
    assert db.query(Transaction).filter_by(import_batch_id=batch.id).count() == 0


def test_unknown_batch_is_not_found(db, world):
    with pytest.raises(ApiError) as excinfo:
        commit_batch(db, uuid.uuid4(), world.user.id, None)
    assert (excinfo.value.status_code, excinfo.value.code) == (404, "not_found")


def test_one_bad_row_rolls_the_whole_batch_back(db, world, transaction_factory):
    """Two rows claim the same single leg: the second one only fails mid-commit."""
    leg = transaction_factory(
        world.ledger, world.checking, kind="transfer", amount=Decimal("-100.0000"),
        transfer_role="out", transfer_subtype="plain",
    )
    batch = make_batch(db, world)
    for _ in range(2):
        add_row(db, batch, kind="transfer", amount=Decimal("100.0000"),
                category_l1=None, merchant=None, transfer_role="in",
                transfer_subtype="plain", matched_transaction_id=leg.id)
    add_row(db, batch)  # a perfectly good expense that must not survive either
    db.commit()  # the endpoint's transaction starts here

    error = commit_error(db, batch, world.user.id)
    assert (error.status_code, error.code) == (400, "pair_invalid")
    assert error.rows == [2]

    db.rollback()  # what the endpoint does when the service raises
    assert imported(db, batch.id) == []
    assert db.query(TransactionEvent).count() == 0  # not one event either
    assert batch.status == "ready" and batch.committed_at is None
    assert leg.transfer_pair_id is None and leg.transfer_subtype == "plain"


# ---------------------------------------------------------------------------
# §4.8: discard, revert, dry_run
# ---------------------------------------------------------------------------


def test_discard_drops_the_drafts_only(db, world):
    batch = make_batch(db, world)
    add_row(db, batch)

    result = delete_batch(db, batch.id, world.user.id, "web")

    assert result.mode == "discard" and result.deleted is True
    assert result.transaction_count == 0
    assert db.get(ImportBatch, batch.id) is None
    assert db.query(ImportRow).count() == 0


def test_revert_deletes_the_transactions_their_events_and_the_batch(db, world):
    batch = make_batch(db, world)
    add_row(db, batch)
    add_row(db, batch, amount=Decimal("-25.0000"))
    commit_batch(db, batch.id, world.user.id, "web")
    batch_id = batch.id

    result = delete_batch(db, batch_id, world.member.id, "web")

    assert result.mode == "revert" and result.transaction_count == 2
    assert result.deleted is True
    assert db.query(Transaction).count() == 0
    assert db.query(TransactionEvent).count() == 0  # cascaded with the rows
    assert db.get(ImportBatch, batch_id) is None
    assert db.query(ImportRow).count() == 0


def test_revert_unpairs_the_surviving_leg(db, world, transaction_factory):
    leg = transaction_factory(
        world.ledger, world.checking, kind="transfer", amount=Decimal("-3000.0000"),
        transfer_role="out", transfer_subtype="plain", counterparty="招行信用卡",
    )
    batch = make_batch(db, world)
    add_row(db, batch, kind="transfer", amount=Decimal("3000.0000"), category_l1=None,
            merchant=None, transfer_role="in", transfer_subtype="repayment",
            matched_transaction_id=leg.id)
    commit_batch(db, batch.id, world.user.id, "web")

    delete_batch(db, batch.id, world.member.id, "cli")

    survivor = db.get(Transaction, leg.id)
    assert survivor is not None and survivor.transfer_pair_id is None
    assert survivor.counterparty is None  # the text is gone for good (§4.8)
    assert survivor.updated_by == world.member.id
    unpaired = db.query(TransactionEvent).filter_by(
        transaction_id=leg.id, event="unpaired").one()
    assert unpaired.changes["transfer_pair_id"]["after"] is None
    assert unpaired.client == "cli"
    # The fixture inserts the leg directly, so it has no ``created`` event.
    assert sorted(event_names(db, leg.id)) == ["paired", "unpaired", "updated"]


def test_revert_counts_both_refund_directions(db, world, transaction_factory):
    """One refund outside the batch, one inside it (decision §14.52 B24)."""
    outside_expense = transaction_factory(
        world.ledger, world.checking, amount=Decimal("-800.0000"), category_l1="food"
    )
    batch = make_batch(db, world)
    expense = add_row(db, batch, amount=Decimal("-1299.0000"), category_l1="shopping")
    add_row(db, batch, kind="refund", amount=Decimal("50.0000"), category_l1="food",
            matched_transaction_id=outside_expense.id)
    commit_batch(db, batch.id, world.user.id, None)
    outside_refund = transaction_factory(
        world.ledger, world.checking, kind="refund", amount=Decimal("99.0000"),
        category_l1="shopping", refund_of=expense.transaction_id,
    )

    dry = delete_batch(db, batch.id, world.user.id, None, dry_run=True)
    assert (dry.mode, dry.deleted) == ("revert", False)
    assert dry.transaction_count == 2
    assert (dry.orphaned_refunds, dry.refunds_in_batch) == (1, 1)
    assert db.query(Transaction).count() == 4  # dry_run wrote nothing
    assert db.get(ImportBatch, batch.id) is not None

    real = delete_batch(db, batch.id, world.user.id, None)
    assert (real.orphaned_refunds, real.refunds_in_batch) == (1, 1)
    survivor = db.get(Transaction, outside_refund.id)
    assert survivor is not None and survivor.refund_of is None


def test_dry_run_on_a_ready_batch(db, world):
    batch = make_batch(db, world)
    add_row(db, batch)

    result = delete_batch(db, batch.id, world.user.id, None, dry_run=True)

    assert result == type(result)("discard", 0, 0, 0, False)
    assert db.get(ImportBatch, batch.id) is not None
    assert db.query(ImportRow).count() == 1


def test_delete_of_an_unknown_batch(db, world):
    with pytest.raises(ApiError) as excinfo:
        delete_batch(db, uuid.uuid4(), world.user.id)
    assert (excinfo.value.status_code, excinfo.value.code) == (404, "not_found")
