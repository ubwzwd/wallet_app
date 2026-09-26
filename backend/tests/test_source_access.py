"""Who may use which account in which ledger (services/source_access, §14.62)."""
import uuid

import pytest
from sqlalchemy import func, select

from app.core.clock import utcnow
from app.core.errors import ApiError, ErrorCode
from app.models.finance_source import FinanceSource
from app.models.import_batch import ImportBatch
from app.models.ledger_source import LedgerSource
from app.models.transaction import Transaction
from app.services import source_access


@pytest.fixture()
def world(db, user_factory, ledger_factory):
    """``me`` and ``mate`` share ``home``; ``mate`` also has ``trip`` alone.

    ``stranger`` belongs to none of them.
    """

    class World:
        me = user_factory()
        mate = user_factory()
        stranger = user_factory()
        home = ledger_factory(me, name="home", members=[mate])
        trip = ledger_factory(mate, name="trip")

    return World


def _batch(db, ledger, source, created_by):
    now = utcnow()
    batch = ImportBatch(
        ledger_id=ledger.id,
        source_id=source.id,
        created_by=created_by.id,
        source="paste",
        filename=None,
        size_bytes=10,
        skill_version="1",
        created_at=now,
        updated_at=now,
    )
    db.add(batch)
    db.flush()
    return batch


def _shares(db, ledger_id) -> set[uuid.UUID]:
    return set(
        db.execute(
            select(LedgerSource.source_id).where(LedgerSource.ledger_id == ledger_id)
        ).scalars()
    )


# ---------------------------------------------------------------------------
# usable_source_ids / is_usable
# ---------------------------------------------------------------------------


def test_own_accounts_are_usable_in_every_ledger_without_a_share(
    db, world, owned_source_factory, ledger_factory
):
    mine = owned_source_factory(world.me)
    other_ledger = ledger_factory(world.me, name="side")

    assert source_access.usable_source_ids(db, world.me.id, world.home.id) == {mine.id}
    assert source_access.usable_source_ids(db, world.me.id, other_ledger.id) == {mine.id}
    assert source_access.is_usable(db, world.me.id, world.home.id, mine)


def test_shared_accounts_are_usable_only_in_the_ledger_they_are_shared_into(
    db, world, owned_source_factory, share_source
):
    mates_card = owned_source_factory(world.mate, name="mate card")
    share_source(world.home, mates_card)
    mates_trip_card = owned_source_factory(world.mate, name="trip card")
    share_source(world.trip, mates_trip_card)

    assert source_access.usable_source_ids(db, world.me.id, world.home.id) == {mates_card.id}
    assert source_access.is_usable(db, world.me.id, world.home.id, mates_card)
    # shared into trip, which is not home
    assert not source_access.is_usable(db, world.me.id, world.home.id, mates_trip_card)
    # the owner still has both everywhere
    assert source_access.usable_source_ids(db, world.mate.id, world.home.id) == {
        mates_card.id,
        mates_trip_card.id,
    }


def test_unshared_accounts_of_others_are_not_usable(db, world, owned_source_factory):
    mates_card = owned_source_factory(world.mate)

    assert source_access.usable_source_ids(db, world.me.id, world.home.id) == set()
    assert not source_access.is_usable(db, world.me.id, world.home.id, mates_card)
    assert not source_access.is_usable(db, world.stranger.id, world.home.id, mates_card)


def test_archived_accounts_are_not_usable_but_is_usable_ignores_archival(
    db, world, owned_source_factory, share_source
):
    my_old = owned_source_factory(world.me, archived=True)
    mates_old = owned_source_factory(world.mate, archived=True)
    share_source(world.home, mates_old)

    assert source_access.usable_source_ids(db, world.me.id, world.home.id) == set()
    # archival is the caller's 409, not this check's business
    assert source_access.is_usable(db, world.me.id, world.home.id, my_old)
    assert source_access.is_usable(db, world.me.id, world.home.id, mates_old)


# ---------------------------------------------------------------------------
# load_usable_source
# ---------------------------------------------------------------------------


def test_load_usable_source_returns_own_shared_and_archived_accounts(
    db, world, owned_source_factory, share_source
):
    mine = owned_source_factory(world.me, archived=True)
    mates = owned_source_factory(world.mate)
    share_source(world.home, mates)

    assert source_access.load_usable_source(db, world.me.id, world.home, mine.id) is mine
    assert source_access.load_usable_source(db, world.me.id, world.home, mates.id) is mates


@pytest.mark.parametrize("which", ["unshared", "missing", "none", "elsewhere"])
def test_load_usable_source_is_404_for_anything_not_usable(
    db, world, owned_source_factory, share_source, which
):
    mates = owned_source_factory(world.mate)
    if which == "elsewhere":
        share_source(world.trip, mates)
    source_id = {
        "unshared": mates.id,
        "elsewhere": mates.id,
        "missing": uuid.uuid4(),
        "none": None,
    }[which]

    with pytest.raises(ApiError) as excinfo:
        source_access.load_usable_source(db, world.me.id, world.home, source_id)

    assert excinfo.value.status_code == 404
    assert excinfo.value.code == ErrorCode.NOT_FOUND


# ---------------------------------------------------------------------------
# visible_source_ids
# ---------------------------------------------------------------------------


def test_visible_source_ids_lists_the_three_groups(
    db, world, owned_source_factory, share_source, transaction_factory
):
    # group 1: mine, one shared into home, one not, one archived
    mine = owned_source_factory(world.me, name="mine")
    mine_shared = owned_source_factory(world.me, name="mine shared")
    share_source(world.home, mine_shared)
    mine_archived = owned_source_factory(world.me, name="mine old", archived=True)
    # group 2: mate's, shared into home, live and archived
    mates_shared = owned_source_factory(world.mate, name="mate shared")
    share_source(world.home, mates_shared)
    mates_shared_archived = owned_source_factory(world.mate, name="mate old", archived=True)
    share_source(world.home, mates_shared_archived)
    # group 3: mate's, unshared, but home's records point at them
    mates_in_tx = owned_source_factory(world.mate, name="mate tx")
    transaction_factory(world.home, mates_in_tx, created_by=world.mate.id)
    mates_in_batch = owned_source_factory(world.mate, name="mate batch")
    _batch(db, world.home, mates_in_batch, world.mate)
    # never listed: mate's unshared card, used only in trip
    mates_elsewhere = owned_source_factory(world.mate, name="mate trip")
    transaction_factory(world.trip, mates_elsewhere, created_by=world.mate.id)

    live = source_access.visible_source_ids(db, world.me.id, world.home.id, False)

    assert live == {
        mine.id: (True, False),
        mine_shared.id: (True, True),
        mates_shared.id: (False, True),
        mates_in_tx.id: (False, False),
        mates_in_batch.id: (False, False),
    }

    everything = source_access.visible_source_ids(db, world.me.id, world.home.id, True)

    assert everything == {
        **live,
        mine_archived.id: (True, False),
        mates_shared_archived.id: (False, True),
    }
    assert mates_elsewhere.id not in everything


def test_visible_source_ids_always_lists_referenced_archived_accounts(
    db, world, owned_source_factory, share_source, transaction_factory
):
    """Group 3 ignores include_archived; the flags stay true facts."""
    mine_old = owned_source_factory(world.me, archived=True)
    mates_old = owned_source_factory(world.mate, archived=True)
    share_source(world.home, mates_old)
    # the rows were recorded before the accounts were archived
    transaction_factory(world.home, mine_old)
    transaction_factory(world.home, mates_old, created_by=world.mate.id)

    assert source_access.visible_source_ids(db, world.me.id, world.home.id, False) == {
        mine_old.id: (True, False),
        mates_old.id: (False, True),
    }


def test_visible_source_ids_for_a_ledger_with_nothing_in_it(db, world):
    assert source_access.visible_source_ids(db, world.me.id, world.home.id, True) == {}


# ---------------------------------------------------------------------------
# unshare_all_of_member / count_owned
# ---------------------------------------------------------------------------


def test_unshare_all_of_member_withdraws_only_that_members_shares_in_that_ledger(
    db, world, owned_source_factory, share_source, transaction_factory
):
    mates_a = owned_source_factory(world.mate, name="a")
    mates_b = owned_source_factory(world.mate, name="b")
    mine = owned_source_factory(world.me, name="c")
    share_source(world.home, mates_a)
    share_source(world.home, mates_b)
    share_source(world.trip, mates_a)
    share_source(world.home, mine)
    tx = transaction_factory(world.home, mates_a, created_by=world.mate.id)

    removed = source_access.unshare_all_of_member(db, world.home.id, world.mate.id)

    assert removed == 2
    assert _shares(db, world.home.id) == {mine.id}
    # other ledgers keep their shares
    assert _shares(db, world.trip.id) == {mates_a.id}
    # the accounts and what was recorded on them stay
    assert db.get(FinanceSource, mates_a.id) is not None
    assert db.get(FinanceSource, mates_b.id) is not None
    assert db.get(Transaction, tx.id) is not None
    # and home's members can no longer use them
    assert source_access.usable_source_ids(db, world.me.id, world.home.id) == {mine.id}


def test_unshare_all_of_member_with_nothing_shared_is_a_no_op(
    db, world, owned_source_factory
):
    owned_source_factory(world.mate)

    assert source_access.unshare_all_of_member(db, world.home.id, world.mate.id) == 0


def test_count_owned_counts_archived_and_ignores_sharing(
    db, world, owned_source_factory, share_source, source_factory
):
    assert source_access.count_owned(db, world.me.id) == 0

    owned_source_factory(world.me)
    owned_source_factory(world.me, archived=True)
    mates = owned_source_factory(world.mate)
    share_source(world.home, mates)
    # the legacy-shaped factory counts too: it is owned by the ledger's creator
    source_factory(world.home)

    assert source_access.count_owned(db, world.me.id) == 3
    assert source_access.count_owned(db, world.mate.id) == 1
    assert source_access.count_owned(db, world.stranger.id) == 0


def test_owned_source_factory_shares_nothing(db, world, owned_source_factory):
    source = owned_source_factory(world.me)

    assert source.owner_id == world.me.id
    assert source.created_by == world.me.id
    assert db.scalar(select(func.count()).select_from(LedgerSource)) == 0
