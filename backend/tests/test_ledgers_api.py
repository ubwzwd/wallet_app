"""Ledger endpoints (03-backend-api.md §5.8-§5.12, test plan §10.2).

Everything runs against the in-memory SQLite session of ``conftest.py``: the
``client`` fixture hands the app the very same session the case reads from, so
an assertion right after a request sees exactly what the endpoint committed.
"""
import datetime as dt
import uuid
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import func, select, update

from app.core.config import settings
from app.models.finance_source import FinanceSource
from app.models.import_batch import ImportBatch
from app.models.ledger import Ledger, LedgerMember
from app.models.transaction import Transaction
from app.models.transaction_event import TransactionEvent


def _naive_utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# helpers: rows the ledger endpoints only ever count or cascade-delete
# ---------------------------------------------------------------------------


def make_source(db, ledger, user, name: str = "招行储蓄卡") -> FinanceSource:
    now = _naive_utcnow()
    source = FinanceSource(
        ledger_id=ledger.id,
        name=name,
        type="checking",
        default_currency=ledger.base_currency,
        opening_balance=Decimal("0"),
        archived=False,
        created_by=user.id,
        updated_by=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(source)
    db.flush()
    return source


def make_transaction(db, ledger, source, user, amount: str = "-42.0000") -> Transaction:
    now = _naive_utcnow()
    transaction = Transaction(
        ledger_id=ledger.id,
        source_id=source.id,
        amount=Decimal(amount),
        currency=source.default_currency,
        occurred_at=now.date(),
        kind="expense",
        category_l1="food",
        created_by=user.id,
        updated_by=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(transaction)
    db.flush()
    return transaction


def make_event(db, ledger, transaction, user) -> TransactionEvent:
    event = TransactionEvent(
        ledger_id=ledger.id,
        transaction_id=transaction.id,
        actor_id=user.id,
        at=_naive_utcnow(),
        event="created",
    )
    db.add(event)
    db.flush()
    return event


def make_batch(db, ledger, source, user) -> ImportBatch:
    now = _naive_utcnow()
    batch = ImportBatch(
        ledger_id=ledger.id,
        source_id=source.id,
        created_by=user.id,
        source="csv",
        filename="bill.csv",
        size_bytes=128,
        skill_version="2026-09-01",
        status="ready",
        row_count=1,
        created_at=now,
        updated_at=now,
    )
    db.add(batch)
    db.flush()
    return batch


# ---------------------------------------------------------------------------
# fixture: Frankfurter unreachable, so the supported currency list is unknowable
# ---------------------------------------------------------------------------


@pytest.fixture()
def fx_down(monkeypatch):
    """Replace ``fake_frankfurter``'s upstream with one that only answers 503.

    ``supported_currencies`` then raises ``fx_unavailable`` and the currency
    check of §5.9/§5.11 has nothing to validate against — the branch the two
    cases below pin down. Retries are turned off so a case does not pay the
    real backoff.
    """
    from app.services import fx

    monkeypatch.setattr(fx, "HTTP_RETRY_ATTEMPTS", 1)
    client = httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(503)),
        base_url="https://frankfurter.test/v1",
    )
    fx.reset_state()
    monkeypatch.setattr(fx, "client_factory", lambda: client)
    try:
        yield
    finally:
        client.close()
        fx.reset_state()


# ---------------------------------------------------------------------------
# §5.8 GET /ledgers
# ---------------------------------------------------------------------------


def test_list_returns_only_my_ledgers_oldest_first(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    bob = user_factory()
    carol = user_factory()
    mine_first = ledger_factory(alice, name="我的账本")
    shared = ledger_factory(bob, name="家庭账本", members=[alice, carol])
    ledger_factory(bob, name="鲍勃自己的")  # alice is not a member
    db.commit()

    response = client.get("/api/v1/ledgers", headers=auth_headers(alice))

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert [item["name"] for item in body["items"]] == ["我的账本", "家庭账本"]
    assert [item["id"] for item in body["items"]] == [str(mine_first.id), str(shared.id)]
    assert [item["role"] for item in body["items"]] == ["owner", "member"]
    assert [item["member_count"] for item in body["items"]] == [1, 3]
    assert body["items"][0]["created_by"] == str(alice.id)


def test_list_carries_no_counts_and_no_net_worth(
    client, db, user_factory, auth_headers, ledger_factory
):
    """§14.52 A16: the cards show member count and currency, nothing else."""
    alice = user_factory()
    ledger = ledger_factory(alice)
    source = make_source(db, ledger, alice)
    make_transaction(db, ledger, source, alice)
    db.commit()

    item = client.get("/api/v1/ledgers", headers=auth_headers(alice)).json()["items"][0]

    assert "counts" not in item
    assert "net_worth" not in item
    assert set(item) == {
        "id",
        "name",
        "base_currency",
        "role",
        "member_count",
        "created_by",
        "created_at",
        "updated_at",
    }


def test_list_requires_a_token(client):
    assert client.get("/api/v1/ledgers").status_code == 401
    assert client.get("/api/v1/ledgers").json()["code"] == "unauthorized"


# ---------------------------------------------------------------------------
# §5.9 POST /ledgers
# ---------------------------------------------------------------------------


def test_create_ledger_makes_the_caller_owner(client, db, user_factory, auth_headers):
    alice = user_factory(base_currency="CNY")
    db.commit()

    response = client.post(
        "/api/v1/ledgers",
        json={"name": "  家庭账本  ", "base_currency": "usd"},
        headers=auth_headers(alice),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "家庭账本"
    assert body["base_currency"] == "USD"
    assert body["role"] == "owner"
    assert body["member_count"] == 1
    assert "counts" not in body

    ledger = db.get(Ledger, uuid.UUID(body["id"]))
    assert ledger is not None and ledger.base_currency == "USD"
    member = db.execute(
        select(LedgerMember).where(LedgerMember.ledger_id == ledger.id)
    ).scalar_one()
    assert (member.user_id, member.role) == (alice.id, "owner")


def test_create_ledger_defaults_to_the_users_currency(client, db, user_factory, auth_headers):
    alice = user_factory(base_currency="JPY")
    db.commit()

    response = client.post(
        "/api/v1/ledgers", json={"name": "旅行"}, headers=auth_headers(alice)
    )

    assert response.status_code == 201
    assert response.json()["base_currency"] == "JPY"


def test_create_ledger_rejects_an_unsupported_currency(client, db, user_factory, auth_headers):
    alice = user_factory()
    db.commit()

    response = client.post(
        "/api/v1/ledgers",
        json={"name": "旅行", "base_currency": "XYZ"},
        headers=auth_headers(alice),
    )

    assert response.status_code == 400
    assert response.json()["code"] == "validation_error"
    assert db.execute(select(func.count()).select_from(Ledger)).scalar_one() == 0


def test_create_ledger_rejects_a_blank_name(client, db, user_factory, auth_headers):
    alice = user_factory()
    db.commit()

    response = client.post(
        "/api/v1/ledgers", json={"name": "   "}, headers=auth_headers(alice)
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_eleventh_ledger_is_refused(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    for index in range(settings.MAX_LEDGERS_PER_USER):
        ledger_factory(alice, name=f"账本 {index}")
    db.commit()

    response = client.post(
        "/api/v1/ledgers", json={"name": "第 11 本"}, headers=auth_headers(alice)
    )

    assert response.status_code == 409
    assert response.json()["code"] == "ledger_limit_reached"
    assert (
        db.execute(select(func.count()).select_from(Ledger)).scalar_one()
        == settings.MAX_LEDGERS_PER_USER
    )



def test_create_ledger_still_works_with_ones_own_currency_while_fx_is_down(
    client, db, user_factory, auth_headers, fx_down
):
    """The currency already in effect needs no list to be validated (§5.9)."""
    alice = user_factory(base_currency="CNY")
    db.commit()

    response = client.post(
        "/api/v1/ledgers", json={"name": "家庭账本"}, headers=auth_headers(alice)
    )

    assert response.status_code == 201
    assert response.json()["base_currency"] == "CNY"


def test_create_ledger_refuses_an_unverifiable_currency_while_fx_is_down(
    client, db, user_factory, auth_headers, fx_down
):
    """An upstream blip must never write a base currency nobody checked (§5.9)."""
    alice = user_factory(base_currency="CNY")
    db.commit()

    response = client.post(
        "/api/v1/ledgers",
        json={"name": "家庭账本", "base_currency": "ZZZ"},
        headers=auth_headers(alice),
    )

    assert response.status_code == 503
    assert response.json()["code"] == "fx_unavailable"
    assert db.execute(select(func.count()).select_from(Ledger)).scalar_one() == 0


# ---------------------------------------------------------------------------
# §5.10 GET /ledgers/{id}
# ---------------------------------------------------------------------------


def test_get_ledger_reports_the_three_counts(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    ledger = ledger_factory(alice)
    source = make_source(db, ledger, alice)
    make_source(db, ledger, alice, name="现金")
    make_transaction(db, ledger, source, alice)
    make_transaction(db, ledger, source, alice, amount="-7.5000")
    make_batch(db, ledger, source, alice)

    other_owner = user_factory()
    other = ledger_factory(other_owner, name="别人的")
    other_source = make_source(db, other, other_owner)
    make_transaction(db, other, other_source, other_owner)
    db.commit()

    response = client.get(f"/api/v1/ledgers/{ledger.id}", headers=auth_headers(alice))

    assert response.status_code == 200
    body = response.json()
    assert body["counts"] == {"transactions": 2, "sources": 2, "import_batches": 1}
    assert body["role"] == "owner"
    assert body["member_count"] == 1


def test_get_ledger_as_member(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    bob = user_factory()
    ledger = ledger_factory(alice, members=[bob])
    db.commit()

    body = client.get(f"/api/v1/ledgers/{ledger.id}", headers=auth_headers(bob)).json()

    assert body["role"] == "member"
    assert body["member_count"] == 2
    assert body["counts"] == {"transactions": 0, "sources": 0, "import_batches": 0}


# ---------------------------------------------------------------------------
# §5.11 PATCH /ledgers/{id}
# ---------------------------------------------------------------------------


def test_patch_renames_and_restamps(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    ledger = ledger_factory(alice, name="我的账本")
    db.commit()
    before = client.get(f"/api/v1/ledgers/{ledger.id}", headers=auth_headers(alice)).json()

    response = client.patch(
        f"/api/v1/ledgers/{ledger.id}",
        json={"name": "家用", "updated_at": before["updated_at"]},
        headers=auth_headers(alice),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "家用"
    assert body["updated_at"] != before["updated_at"]
    assert body["created_at"] == before["created_at"]
    assert "counts" not in body
    db.expire_all()
    assert db.get(Ledger, ledger.id).name == "家用"


def test_patch_base_currency_shows_up_and_leaves_transactions_alone(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    ledger = ledger_factory(alice, base_currency="CNY")
    source = make_source(db, ledger, alice)
    transaction = make_transaction(db, ledger, source, alice, amount="-42.0000")
    db.commit()
    transaction_id = transaction.id
    stamp = client.get(f"/api/v1/ledgers/{ledger.id}", headers=auth_headers(alice)).json()

    response = client.patch(
        f"/api/v1/ledgers/{ledger.id}",
        json={"base_currency": "usd", "updated_at": stamp["updated_at"]},
        headers=auth_headers(alice),
    )

    assert response.status_code == 200
    assert response.json()["base_currency"] == "USD"
    after = client.get(f"/api/v1/ledgers/{ledger.id}", headers=auth_headers(alice)).json()
    assert after["base_currency"] == "USD"

    db.expire_all()
    kept = db.get(Transaction, transaction_id)
    assert kept.currency == "CNY"
    assert kept.amount == Decimal("-42.0000")


def test_patch_by_a_plain_member_is_403(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    bob = user_factory()
    ledger = ledger_factory(alice, members=[bob])
    db.commit()
    stamp = client.get(f"/api/v1/ledgers/{ledger.id}", headers=auth_headers(bob)).json()

    response = client.patch(
        f"/api/v1/ledgers/{ledger.id}",
        json={"name": "偷偷改名", "updated_at": stamp["updated_at"]},
        headers=auth_headers(bob),
    )

    assert response.status_code == 403
    assert response.json()["code"] == "not_owner"
    db.expire_all()
    assert db.get(Ledger, ledger.id).name == "我的账本"


def test_patch_with_a_stale_stamp_is_409(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    ledger = ledger_factory(alice)
    db.commit()
    stale = client.get(f"/api/v1/ledgers/{ledger.id}", headers=auth_headers(alice)).json()

    first = client.patch(
        f"/api/v1/ledgers/{ledger.id}",
        json={"name": "第一次", "updated_at": stale["updated_at"]},
        headers=auth_headers(alice),
    )
    assert first.status_code == 200

    second = client.patch(
        f"/api/v1/ledgers/{ledger.id}",
        json={"name": "第二次", "updated_at": stale["updated_at"]},
        headers=auth_headers(alice),
    )

    assert second.status_code == 409
    assert second.json()["code"] == "stale_update"
    db.expire_all()
    assert db.get(Ledger, ledger.id).name == "第一次"


def test_patch_without_updated_at_is_422(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    ledger = ledger_factory(alice)
    db.commit()

    response = client.patch(
        f"/api/v1/ledgers/{ledger.id}", json={"name": "改名"}, headers=auth_headers(alice)
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_patch_to_an_unsupported_currency_is_400(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    ledger = ledger_factory(alice, base_currency="CNY")
    db.commit()
    stamp = client.get(f"/api/v1/ledgers/{ledger.id}", headers=auth_headers(alice)).json()

    response = client.patch(
        f"/api/v1/ledgers/{ledger.id}",
        json={"base_currency": "XYZ", "updated_at": stamp["updated_at"]},
        headers=auth_headers(alice),
    )

    assert response.status_code == 400
    assert response.json()["code"] == "validation_error"
    db.expire_all()
    assert db.get(Ledger, ledger.id).base_currency == "CNY"



def test_patch_compares_the_stamp_against_the_row_it_locked(
    client, db, user_factory, auth_headers, ledger_factory
):
    """§4.4 is a compare-and-set: the locked row decides, not an earlier read.

    ``get_ledger_member`` loads the ledger before the ``FOR UPDATE`` select, so
    unless that select refreshes the object the comparison would run against the
    version this Session read first — and a concurrent writer's change would be
    overwritten with a 200. Here the row moves on behind the Session's back
    (``synchronize_session=False`` leaves the loaded object untouched, exactly
    like another connection's commit would), then the old stamp is replayed.
    """
    alice = user_factory()
    ledger = ledger_factory(alice, name="A")
    db.commit()
    stale = client.get(f"/api/v1/ledgers/{ledger.id}", headers=auth_headers(alice)).json()

    db.execute(
        update(Ledger)
        .where(Ledger.id == ledger.id)
        .values(name="B", updated_at=dt.datetime(2026, 9, 2, 9, 0, 0, 654321))
        .execution_options(synchronize_session=False)
    )

    response = client.patch(
        f"/api/v1/ledgers/{ledger.id}",
        json={"name": "C", "updated_at": stale["updated_at"]},
        headers=auth_headers(alice),
    )

    assert response.status_code == 409
    assert response.json()["code"] == "stale_update"
    assert (
        db.execute(select(Ledger.name).where(Ledger.id == ledger.id)).scalar_one() == "B"
    )


def test_patch_refuses_an_unverifiable_currency_while_fx_is_down(
    client, db, user_factory, auth_headers, ledger_factory, fx_down
):
    """Same rule as §5.9: only the ledger's current currency passes unchecked."""
    alice = user_factory()
    ledger = ledger_factory(alice, base_currency="CNY")
    db.commit()
    stamp = client.get(f"/api/v1/ledgers/{ledger.id}", headers=auth_headers(alice)).json()

    response = client.patch(
        f"/api/v1/ledgers/{ledger.id}",
        json={"base_currency": "ZZZ", "updated_at": stamp["updated_at"]},
        headers=auth_headers(alice),
    )

    assert response.status_code == 503
    assert response.json()["code"] == "fx_unavailable"
    db.expire_all()
    assert db.get(Ledger, ledger.id).base_currency == "CNY"

    renamed = client.patch(
        f"/api/v1/ledgers/{ledger.id}",
        json={"name": "家用", "base_currency": "cny", "updated_at": stamp["updated_at"]},
        headers=auth_headers(alice),
    )
    assert renamed.status_code == 200
    assert renamed.json()["base_currency"] == "CNY"


# ---------------------------------------------------------------------------
# §5.12 DELETE /ledgers/{id}
# ---------------------------------------------------------------------------


def test_delete_needs_the_exact_name(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    ledger = ledger_factory(alice, name="家用")
    db.commit()

    wrong = client.delete(
        f"/api/v1/ledgers/{ledger.id}?confirm_name=家用 ", headers=auth_headers(alice)
    )
    missing = client.delete(f"/api/v1/ledgers/{ledger.id}", headers=auth_headers(alice))

    assert wrong.status_code == 400
    assert wrong.json()["code"] == "validation_error"
    assert missing.status_code == 400
    assert missing.json()["code"] == "validation_error"
    assert db.get(Ledger, ledger.id) is not None


def test_delete_cascades_to_everything_in_the_ledger(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    bob = user_factory()
    ledger = ledger_factory(alice, name="家用", members=[bob])
    source = make_source(db, ledger, alice)
    transaction = make_transaction(db, ledger, source, alice)
    make_event(db, ledger, transaction, alice)
    make_batch(db, ledger, source, alice)

    keeper = user_factory()
    other = ledger_factory(keeper, name="别人的")
    other_source = make_source(db, other, keeper)
    make_transaction(db, other, other_source, keeper)
    db.commit()
    ledger_id = ledger.id

    response = client.delete(
        f"/api/v1/ledgers/{ledger_id}?confirm_name=家用", headers=auth_headers(alice)
    )

    assert response.status_code == 204
    assert response.content == b""
    db.expire_all()
    assert db.get(Ledger, ledger_id) is None
    for model in (FinanceSource, Transaction, ImportBatch, TransactionEvent):
        remaining = db.execute(
            select(func.count()).select_from(model).where(model.ledger_id == ledger_id)
        ).scalar_one()
        assert remaining == 0, model.__name__
    assert (
        db.execute(
            select(func.count())
            .select_from(LedgerMember)
            .where(LedgerMember.ledger_id == ledger_id)
        ).scalar_one()
        == 0
    )
    # The other ledger is untouched.
    assert db.get(Ledger, other.id) is not None
    assert (
        db.execute(
            select(func.count()).select_from(Transaction).where(
                Transaction.ledger_id == other.id
            )
        ).scalar_one()
        == 1
    )


def test_delete_by_a_plain_member_is_403(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    bob = user_factory()
    ledger = ledger_factory(alice, name="家用", members=[bob])
    db.commit()

    response = client.delete(
        f"/api/v1/ledgers/{ledger.id}?confirm_name=家用", headers=auth_headers(bob)
    )

    assert response.status_code == 403
    assert response.json()["code"] == "not_owner"
    assert db.get(Ledger, ledger.id) is not None


# ---------------------------------------------------------------------------
# §3.3 visibility: every ledger endpoint answers a stranger with 404
# ---------------------------------------------------------------------------


def _every_ledger_request(client, ledger_id, member_id, headers):
    """One call per ledger-scoped endpoint, with a body where one is required."""
    return {
        "get": client.get(f"/api/v1/ledgers/{ledger_id}", headers=headers),
        "patch": client.patch(
            f"/api/v1/ledgers/{ledger_id}",
            json={"name": "x", "updated_at": "2026-09-01T00:00:00.000000Z"},
            headers=headers,
        ),
        "delete": client.delete(
            f"/api/v1/ledgers/{ledger_id}?confirm_name=x", headers=headers
        ),
        "members": client.get(f"/api/v1/ledgers/{ledger_id}/members", headers=headers),
        "remove_member": client.delete(
            f"/api/v1/ledgers/{ledger_id}/members/{member_id}", headers=headers
        ),
        "leave": client.post(f"/api/v1/ledgers/{ledger_id}/leave", headers=headers),
        "transfer": client.post(
            f"/api/v1/ledgers/{ledger_id}/transfer-ownership",
            json={"to_user_id": str(member_id)},
            headers=headers,
        ),
        "invite": client.post(f"/api/v1/ledgers/{ledger_id}/invites", headers=headers),
        "revoke": client.delete(
            f"/api/v1/ledgers/{ledger_id}/invites/123456", headers=headers
        ),
    }


def test_a_non_member_gets_404_from_every_ledger_endpoint(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    stranger = user_factory()
    ledger = ledger_factory(alice)
    db.commit()

    responses = _every_ledger_request(client, ledger.id, alice.id, auth_headers(stranger))

    for name, response in responses.items():
        assert response.status_code == 404, (name, response.text)
        assert response.json()["code"] == "not_found", name
    assert db.get(Ledger, ledger.id) is not None


def test_an_unknown_ledger_id_is_404_too(client, db, user_factory, auth_headers):
    alice = user_factory()
    db.commit()

    responses = _every_ledger_request(
        client, uuid.uuid4(), alice.id, auth_headers(alice)
    )

    for name, response in responses.items():
        assert response.status_code == 404, (name, response.text)


def test_every_ledger_endpoint_needs_a_token(client, db, user_factory, ledger_factory):
    alice = user_factory()
    ledger = ledger_factory(alice)
    db.commit()

    responses = _every_ledger_request(client, ledger.id, alice.id, {})
    responses["list"] = client.get("/api/v1/ledgers")
    responses["create"] = client.post("/api/v1/ledgers", json={"name": "x"})
    responses["join"] = client.post("/api/v1/ledgers/join", json={"code": "123456"})

    for name, response in responses.items():
        assert response.status_code == 401, (name, response.text)
        assert response.json()["code"] == "unauthorized", name


@pytest.mark.parametrize("bad_id", ["join-me", "not-a-uuid"])
def test_a_malformed_ledger_id_is_422(client, db, user_factory, auth_headers, bad_id):
    alice = user_factory()
    db.commit()

    response = client.get(f"/api/v1/ledgers/{bad_id}", headers=auth_headers(alice))

    assert response.status_code == 422
