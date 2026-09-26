"""Sharing accounts into ledgers and the per-ledger account list (decision §14.62).

``PUT`` / ``DELETE /api/v1/sources/{sid}/ledgers/{lid}`` (03-backend-api.md
§5.24a / §5.24b) and ``GET /api/v1/ledgers/{id}/sources`` (§5.24c). Ownership
itself and the personal CRUD live in ``test_sources_api.py``.

The cast: Alice owns the ledger, Bob is a member of it, Carol is a stranger.
"""
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.core.clock import utcnow
from app.models.import_batch import ImportBatch
from app.models.ledger_source import LedgerSource
from app.models.transaction import Transaction
from app.models.transaction_event import TransactionEvent

MONEY_FIELDS = (
    "opening_balance",
    "balance",
    "balance_base",
    "balance_rate",
    "balance_rate_date",
    "shared_to",
)


@pytest.fixture()
def world(user_factory, ledger_factory, auth_headers):
    class World:
        pass

    world = World()
    world.alice = user_factory(base_currency="CNY")
    world.bob = user_factory(base_currency="CNY")
    world.carol = user_factory()
    world.ledger = ledger_factory(world.alice, base_currency="CNY", members=[world.bob])
    world.alice_h = auth_headers(world.alice)
    world.bob_h = auth_headers(world.bob)
    world.carol_h = auth_headers(world.carol)
    world.list_url = f"/api/v1/ledgers/{world.ledger.id}/sources"
    return world


def share_url(source_id, ledger_id) -> str:
    return f"/api/v1/sources/{source_id}/ledgers/{ledger_id}"


def shares(db) -> set[tuple[uuid.UUID, uuid.UUID]]:
    db.expire_all()
    return {
        (row.ledger_id, row.source_id)
        for row in db.execute(select(LedgerSource)).scalars()
    }


def listed(client, url, headers, **params) -> dict[str, dict]:
    response = client.get(url, headers=headers, params=params)
    assert response.status_code == 200, response.text
    return {item["name"]: item for item in response.json()["items"]}


# ---------------------------------------------------------------------------
# §5.24a PUT /sources/{sid}/ledgers/{lid}
# ---------------------------------------------------------------------------


def test_share_is_204_and_lets_the_other_members_use_it(
    client, world, db, owned_source_factory
):
    card = owned_source_factory(world.alice, name="Alice 储蓄卡")
    assert "Alice 储蓄卡" not in listed(client, world.list_url, world.bob_h)

    response = client.put(share_url(card.id, world.ledger.id), headers=world.alice_h)

    assert response.status_code == 204
    assert response.content == b""
    row = db.get(LedgerSource, (world.ledger.id, card.id))
    assert row is not None and row.shared_by == world.alice.id
    seen = listed(client, world.list_url, world.bob_h)["Alice 储蓄卡"]
    assert (seen["mine"], seen["usable"]) == (False, True)


def test_share_is_idempotent_and_keeps_the_first_stamp(
    client, world, db, owned_source_factory
):
    card = owned_source_factory(world.alice)
    assert client.put(share_url(card.id, world.ledger.id), headers=world.alice_h).status_code == 204
    first = db.get(LedgerSource, (world.ledger.id, card.id)).shared_at

    again = client.put(share_url(card.id, world.ledger.id), headers=world.alice_h)

    assert again.status_code == 204
    assert shares(db) == {(world.ledger.id, card.id)}
    assert db.get(LedgerSource, (world.ledger.id, card.id)).shared_at == first


def test_a_member_can_share_their_own_card_and_an_archived_one_too(
    client, world, db, owned_source_factory
):
    """Any member may share into the ledger; archival is judged at use (§5.24a)."""
    card = owned_source_factory(world.bob, name="Bob 旧卡", archived=True)

    response = client.put(share_url(card.id, world.ledger.id), headers=world.bob_h)

    assert response.status_code == 204
    assert shares(db) == {(world.ledger.id, card.id)}
    seen = listed(client, world.list_url, world.alice_h, include_archived="true")
    assert (seen["Bob 旧卡"]["mine"], seen["Bob 旧卡"]["usable"]) == (False, False)


@pytest.mark.parametrize("method", ["put", "delete"])
@pytest.mark.parametrize(
    "case",
    ["not_the_owner", "stranger", "owner_not_in_ledger", "no_such_ledger", "no_such_account"],
)
def test_share_and_unshare_are_404_unless_owner_and_member(
    client, world, db, user_factory, ledger_factory, owned_source_factory, share_source,
    method, case,
):
    """Both endpoints: owner of ``sid`` and member of ``lid``, else 404 (§3.3)."""
    card = owned_source_factory(world.alice)
    elsewhere = ledger_factory(user_factory(), name="别人的账本")
    share_source(world.ledger, card)    # so a wrongful DELETE would have something to drop
    before = shares(db)

    sid, lid, headers = card.id, world.ledger.id, world.alice_h
    if case == "not_the_owner":
        headers = world.bob_h           # a member of the ledger, not the card's owner
    elif case == "stranger":
        headers = world.carol_h
    elif case == "owner_not_in_ledger":
        lid = elsewhere.id
    elif case == "no_such_ledger":
        lid = uuid.uuid4()
    elif case == "no_such_account":
        sid = uuid.uuid4()

    response = getattr(client, method)(share_url(sid, lid), headers=headers)

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    assert shares(db) == before


def test_sharing_needs_a_token(client, world, owned_source_factory):
    card = owned_source_factory(world.alice)
    assert client.put(share_url(card.id, world.ledger.id)).status_code == 401
    assert client.delete(share_url(card.id, world.ledger.id)).status_code == 401


# ---------------------------------------------------------------------------
# §5.24b DELETE /sources/{sid}/ledgers/{lid}
# ---------------------------------------------------------------------------


def test_unshare_is_204_and_idempotent(client, world, db, owned_source_factory, share_source):
    card = owned_source_factory(world.alice)
    share_source(world.ledger, card)

    first = client.delete(share_url(card.id, world.ledger.id), headers=world.alice_h)
    second = client.delete(share_url(card.id, world.ledger.id), headers=world.alice_h)

    assert first.status_code == 204 and first.content == b""
    assert second.status_code == 204
    assert shares(db) == set()


def test_unshare_touches_only_that_ledger(
    client, world, db, ledger_factory, owned_source_factory, share_source
):
    trip = ledger_factory(world.alice, name="旅行账本")
    card = owned_source_factory(world.alice)
    share_source(world.ledger, card)
    share_source(trip, card)

    client.delete(share_url(card.id, world.ledger.id), headers=world.alice_h)

    assert shares(db) == {(trip.id, card.id)}
    mine = client.get(f"/api/v1/sources/{card.id}", headers=world.alice_h).json()
    assert mine["shared_to"] == [str(trip.id)]


def test_unshare_keeps_the_transactions_and_writes_no_events(
    client, world, db, owned_source_factory, share_source, transaction_factory
):
    """§5.24b: the history stays, the account turns ``usable: false`` for Bob."""
    card = owned_source_factory(world.alice, name="Alice 储蓄卡")
    share_source(world.ledger, card)
    recorded = transaction_factory(
        world.ledger, card, amount=Decimal("-30.0000"), created_by=world.bob.id
    )

    response = client.delete(share_url(card.id, world.ledger.id), headers=world.alice_h)

    assert response.status_code == 204
    db.expire_all()
    kept = db.get(Transaction, recorded.id)
    assert kept is not None and kept.source_id == card.id
    assert db.execute(select(TransactionEvent)).scalars().all() == []

    row = listed(client, world.list_url, world.bob_h)["Alice 储蓄卡"]
    assert (row["mine"], row["usable"]) == (False, False)
    # Alice herself can still use it here: an owner never needs a share.
    own = listed(client, world.list_url, world.alice_h)["Alice 储蓄卡"]
    assert (own["mine"], own["usable"]) == (True, True)


# ---------------------------------------------------------------------------
# §5.24c GET /ledgers/{id}/sources
# ---------------------------------------------------------------------------


def test_the_list_is_mine_plus_shared_plus_referenced(
    client, world, owned_source_factory, share_source, transaction_factory,
    user_factory, ledger_factory,
):
    """The three groups of §5.24c and their flags, seen by Alice."""
    alice_unshared = owned_source_factory(world.alice, name="Alice 没共享的卡")
    alice_shared = owned_source_factory(world.alice, name="Alice 共享的卡")
    share_source(world.ledger, alice_shared)
    bob_shared = owned_source_factory(world.bob, name="Bob 工资卡")
    share_source(world.ledger, bob_shared)
    bob_private = owned_source_factory(world.bob, name="Bob 信用卡", type="credit")
    transaction_factory(world.ledger, bob_private, created_by=world.bob.id)
    owned_source_factory(world.bob, name="Bob 与本账本无关的卡")
    stranger_card = owned_source_factory(world.carol, name="Carol 的卡")
    share_source(ledger_factory(world.carol, name="Carol 的账本"), stranger_card)

    response = client.get(world.list_url, headers=world.alice_h)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload) == {"items", "total"}      # no totals on a ledger
    items = {item["name"]: item for item in payload["items"]}
    assert set(items) == {"Alice 没共享的卡", "Alice 共享的卡", "Bob 工资卡", "Bob 信用卡"}
    assert payload["total"] == 4
    flags = {name: (item["mine"], item["usable"]) for name, item in items.items()}
    assert flags == {
        "Alice 没共享的卡": (True, True),
        "Alice 共享的卡": (True, True),
        "Bob 工资卡": (False, True),
        "Bob 信用卡": (False, False),
    }
    assert items["Bob 工资卡"]["owner_id"] == str(world.bob.id)
    assert items["Alice 没共享的卡"]["id"] == str(alice_unshared.id)


def test_other_members_accounts_carry_no_money(
    client, world, owned_source_factory, share_source, transaction_factory
):
    """§14.62 c: identity fields yes, balances and shares no."""
    card = owned_source_factory(
        world.bob, name="Bob 工资卡", currency="EUR", opening_balance=Decimal("500")
    )
    share_source(world.ledger, card)
    transaction_factory(world.ledger, card, amount=Decimal("-50.0000"), currency="EUR")

    row = listed(client, world.list_url, world.alice_h)["Bob 工资卡"]

    for field in MONEY_FIELDS:
        assert row[field] is None, field
    assert row["rate_missing_count"] == 0
    assert row["default_currency"] == "EUR"
    assert row["type"] == "checking"
    assert row["archived"] is False
    assert row["created_by"] == str(world.bob.id)
    for field in ("created_at", "updated_at", "updated_by"):
        assert row[field] is not None


def test_my_rows_match_the_personal_list_field_for_field(
    client, world, ledger_factory, owned_source_factory, share_source, transaction_factory
):
    """§5.24c: ``mine`` rows are the §5.20 rows — balance across ledgers included."""
    trip = ledger_factory(world.alice, name="旅行账本")
    card = owned_source_factory(world.alice, name="Alice 储蓄卡", opening_balance=Decimal("100"))
    share_source(world.ledger, card)
    transaction_factory(world.ledger, card, amount=Decimal("-10.0000"))
    transaction_factory(trip, card, amount=Decimal("-15.0000"))

    in_ledger = listed(client, world.list_url, world.alice_h)["Alice 储蓄卡"]
    personal = client.get(f"/api/v1/sources/{card.id}", headers=world.alice_h).json()

    assert in_ledger.pop("mine") is True
    assert in_ledger.pop("usable") is True
    assert in_ledger == personal
    assert personal["balance"] == "75.0000"
    assert personal["shared_to"] == [str(world.ledger.id)]


def test_the_order_is_type_order_then_name(client, world, owned_source_factory, share_source):
    owned_source_factory(world.alice, name="B 其他", type="other")
    owned_source_factory(world.alice, name="A 现金", type="cash")
    owned_source_factory(world.alice, name="Z 储蓄", type="checking")
    owned_source_factory(world.alice, name="C 信用", type="credit")
    bob_card = owned_source_factory(world.bob, name="A 储蓄", type="checking")
    share_source(world.ledger, bob_card)

    items = client.get(world.list_url, headers=world.alice_h).json()["items"]

    assert [item["name"] for item in items] == [
        "A 储蓄",
        "Z 储蓄",
        "C 信用",
        "A 现金",
        "B 其他",
    ]


def test_include_archived_covers_mine_and_shared_but_referenced_are_always_listed(
    client, world, owned_source_factory, share_source, transaction_factory
):
    owned_source_factory(world.alice, name="Alice 旧卡", archived=True)
    old_shared = owned_source_factory(world.bob, name="Bob 旧卡", archived=True)
    share_source(world.ledger, old_shared)
    # Archived, never shared, but used in this ledger: group ③ ignores the flag.
    old_used = owned_source_factory(world.bob, name="Bob 用过的旧卡", archived=True)
    transaction_factory(world.ledger, old_used, created_by=world.bob.id)

    default = listed(client, world.list_url, world.alice_h)
    assert set(default) == {"Bob 用过的旧卡"}
    assert default["Bob 用过的旧卡"]["usable"] is False

    everything = listed(client, world.list_url, world.alice_h, include_archived="true")
    assert set(everything) == {"Alice 旧卡", "Bob 旧卡", "Bob 用过的旧卡"}
    assert all(item["usable"] is False for item in everything.values())
    assert everything["Alice 旧卡"]["mine"] is True
    assert everything["Alice 旧卡"]["balance"] == "0.0000"


def test_an_import_batch_reference_lists_the_account(
    client, world, db, owned_source_factory
):
    """Group ③ covers ``import_batches.source_id`` as well as transactions."""
    card = owned_source_factory(world.bob, name="Bob 导入过的卡")
    now = utcnow()
    db.add(
        ImportBatch(
            ledger_id=world.ledger.id,
            source_id=card.id,
            created_by=world.bob.id,
            source="csv",
            filename="cmb.csv",
            size_bytes=1024,
            skill_version="2026-09-10",
            status="ready",
            row_count=0,
            created_at=now,
            updated_at=now,
        )
    )
    db.flush()

    row = listed(client, world.list_url, world.alice_h)["Bob 导入过的卡"]
    assert (row["mine"], row["usable"]) == (False, False)


def test_references_in_another_ledger_do_not_leak_in(
    client, world, ledger_factory, owned_source_factory, transaction_factory
):
    elsewhere = ledger_factory(world.bob, name="Bob 自己的账本")
    card = owned_source_factory(world.bob, name="Bob 私卡")
    transaction_factory(elsewhere, card, created_by=world.bob.id)

    assert "Bob 私卡" not in listed(client, world.list_url, world.alice_h)


def test_the_ledger_list_is_members_only(client, world):
    response = client.get(world.list_url, headers=world.carol_h)
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    assert client.get(world.list_url).status_code == 401


def test_the_old_ledger_scoped_write_routes_are_gone(
    client, world, owned_source_factory
):
    """Decision §14.42: no compatibility aliases for §5.21-§5.24 under a ledger."""
    card = owned_source_factory(world.alice)
    one = f"{world.list_url}/{card.id}"

    created = client.post(
        world.list_url,
        json={"name": "现金", "type": "cash", "default_currency": "CNY"},
        headers=world.alice_h,
    )
    assert created.status_code == 405
    assert client.get(one, headers=world.alice_h).status_code == 404
    assert client.patch(one, json={}, headers=world.alice_h).status_code == 404
    assert client.delete(one, headers=world.alice_h).status_code == 404
