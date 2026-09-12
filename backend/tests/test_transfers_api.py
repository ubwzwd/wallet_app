"""Two-leg transfer, pairing and unpairing endpoints (§5.30-§5.34, §10.2).

The ledger is CNY and the fake upstream quotes one EUR at 7.82608696 CNY, so a
cross-currency pair has two legs whose ``amount_base`` values are genuinely
different numbers rather than the same one twice.
"""
import datetime as dt
import uuid
from dataclasses import dataclass
from decimal import Decimal

import pytest

from app.models.transaction import Transaction
from app.models.transaction_event import TransactionEvent
from app.services import transaction_service

SEP5 = dt.date(2026, 9, 5)
SEP6 = dt.date(2026, 9, 6)

# The 16 fields of one leg (§5.33, decision §14.53f).
LEG_FIELDS = {
    "id",
    "source_id",
    "kind",
    "occurred_at",
    "transfer_role",
    "transfer_subtype",
    "amount",
    "currency",
    "counterparty",
    "amount_base",
    "rate_used",
    "rate_date",
    "transfer_pair_id",
    "note",
    "created_at",
    "updated_at",
}


@dataclass
class Env:
    client: object
    headers: dict
    user: object
    ledger: object
    bank: object
    cash: object
    card: object
    euro: object

    def url(self, suffix: str = "") -> str:
        return f"/api/v1/ledgers/{self.ledger.id}/transactions{suffix}"

    def post(self, suffix: str, body: dict | None = None, client: str | None = "web"):
        headers = dict(self.headers)
        if client is not None:
            headers["X-Client"] = client
        return self.client.post(self.url(suffix), json=body, headers=headers)

    def patch(self, suffix: str, body: dict, client: str | None = "web"):
        headers = dict(self.headers)
        if client is not None:
            headers["X-Client"] = client
        return self.client.patch(self.url(suffix), json=body, headers=headers)

    def delete(self, suffix: str):
        return self.client.delete(self.url(suffix), headers=self.headers)

    def get(self, suffix: str = "", **params):
        return self.client.get(self.url(suffix), headers=self.headers, params=params)


@pytest.fixture()
def env(client, user_factory, ledger_factory, source_factory, auth_headers) -> Env:
    owner = user_factory()
    ledger = ledger_factory(owner, base_currency="CNY")
    return Env(
        client=client,
        headers=auth_headers(owner),
        user=owner,
        ledger=ledger,
        bank=source_factory(ledger, name="招行储蓄卡", type="checking", currency="CNY"),
        cash=source_factory(ledger, name="现金", type="cash", currency="CNY"),
        card=source_factory(ledger, name="招行信用卡", type="credit", currency="CNY"),
        euro=source_factory(ledger, name="欧元账户", type="checking", currency="EUR"),
    )


def transfer_body(env: Env, **overrides) -> dict:
    body = {
        "from_source_id": str(env.bank.id),
        "to_source_id": str(env.cash.id),
        "amount_out": "100.00",
        "occurred_at": SEP6.isoformat(),
        "subtype": "plain",
        "note": "取现",
    }
    body.update(overrides)
    return body


def events_of(db, transaction_id) -> list[TransactionEvent]:
    return (
        db.query(TransactionEvent)
        .filter(TransactionEvent.transaction_id == transaction_id)
        .order_by(TransactionEvent.at.asc())
        .all()
    )


def single_leg(env: Env, source, *, role: str, amount: str, **overrides) -> dict:
    """Book one single-leg transfer through §5.26 and return its body."""
    body = {
        "source_id": str(source.id),
        "kind": "transfer",
        "amount": amount,
        "currency": source.default_currency,
        "occurred_at": SEP6.isoformat(),
        "transfer_role": role,
        "transfer_subtype": "plain",
        "counterparty": "老婆",
    }
    body.update(overrides)
    response = env.post("", body)
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------------
# POST /transactions/transfer (§5.30)
# ---------------------------------------------------------------------------


def test_create_transfer_writes_two_legs_in_one_go(env, db):
    response = env.post(
        "/transfer",
        transfer_body(
            env,
            to_source_id=str(env.euro.id),
            amount_out="100.00",
            currency_out="USD",
            amount_in="720.00",
            currency_in="eur",
            note="换汇",
        ),
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert set(body) == {
        "pair_id",
        "occurred_at",
        "subtype",
        "note",
        "out",
        "in",
        "updated_at",
    }
    assert set(body["out"]) == LEG_FIELDS
    assert body["out"]["amount"] == "-100.0000"
    assert body["out"]["currency"] == "USD"
    assert body["in"]["amount"] == "720.0000"           # not equal on purpose
    assert body["in"]["currency"] == "EUR"
    assert body["out"]["transfer_pair_id"] == body["pair_id"]
    assert body["in"]["transfer_pair_id"] == body["pair_id"]
    assert body["out"]["counterparty"] is None
    assert body["in"]["amount_base"] == "5634.7826"     # 720 EUR in CNY
    assert body["occurred_at"] == SEP6.isoformat()
    assert body["note"] == "换汇"

    legs = (
        db.query(Transaction)
        .filter(Transaction.transfer_pair_id == uuid.UUID(body["pair_id"]))
        .all()
    )
    assert {leg.transfer_role for leg in legs} == {"out", "in"}
    for leg in legs:
        assert leg.category_l1 is None and leg.merchant is None
        (event,) = events_of(db, leg.id)
        assert (event.event, event.client) == ("created", "web")


def test_create_transfer_defaults_the_incoming_amount_when_currencies_match(env):
    body = env.post("/transfer", transfer_body(env)).json()

    assert body["out"]["amount"] == "-100.0000"
    assert body["in"]["amount"] == "100.0000"
    assert body["out"]["currency"] == body["in"]["currency"] == "CNY"


def test_create_transfer_requires_the_incoming_amount_across_currencies(env):
    response = env.post(
        "/transfer", transfer_body(env, to_source_id=str(env.euro.id))
    )

    assert response.status_code == 400
    assert response.json()["code"] == "validation_error"


def test_create_repayment_must_land_on_a_credit_account(env):
    rejected = env.post("/transfer", transfer_body(env, subtype="repayment"))
    assert rejected.status_code == 400
    assert rejected.json()["code"] == "repayment_target_not_credit"

    accepted = env.post(
        "/transfer",
        transfer_body(env, to_source_id=str(env.card.id), subtype="repayment"),
    )
    assert accepted.status_code == 201, accepted.text
    assert accepted.json()["subtype"] == "repayment"


def test_create_transfer_rejects_one_account(env):
    response = env.post(
        "/transfer", transfer_body(env, to_source_id=str(env.bank.id))
    )

    assert response.status_code == 400
    assert response.json()["code"] == "same_source"


def test_create_transfer_onto_an_archived_account_conflicts(env, source_factory):
    archived = source_factory(env.ledger, name="旧卡", archived=True)

    response = env.post(
        "/transfer", transfer_body(env, to_source_id=str(archived.id))
    )

    assert response.status_code == 409
    assert response.json()["code"] == "source_archived"


def test_create_transfer_with_a_foreign_account_is_not_found(
    env, user_factory, ledger_factory, source_factory
):
    foreign = source_factory(ledger_factory(user_factory()), name="别人的卡")

    response = env.post(
        "/transfer", transfer_body(env, to_source_id=str(foreign.id))
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_create_transfer_leaves_nothing_behind_when_a_write_fails(
    env, db, monkeypatch
):
    """Both legs or neither (§5.30).

    The failure is injected at the event write, which is the last step of the
    same transaction; the endpoint never commits, so closing the session (what
    ``get_db`` does in production, ``rollback`` here) has to leave the table
    exactly as it was — a first leg committed on its own would survive.
    """

    def boom(*_args, **_kwargs):
        raise RuntimeError("upstream exploded")

    monkeypatch.setattr(transaction_service.events, "record", boom)

    with pytest.raises(RuntimeError):
        env.post("/transfer", transfer_body(env))

    db.rollback()
    assert db.query(Transaction).count() == 0


# ---------------------------------------------------------------------------
# PATCH / DELETE /transactions/transfer/{pair_id} (§5.31, §5.32)
# ---------------------------------------------------------------------------


def test_patch_transfer_edits_both_legs_as_one_object(env, db):
    created = env.post(
        "/transfer",
        transfer_body(
            env,
            to_source_id=str(env.euro.id),
            amount_in="12.00",
            currency_in="EUR",
        ),
    ).json()

    response = env.patch(
        f"/transfer/{created['pair_id']}",
        {
            "amount_in": "11.50",
            "occurred_at": SEP5.isoformat(),
            "note": "换汇（按实际到账改）",
            "updated_at": created["updated_at"],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["in"]["amount"] == "11.5000"
    assert body["out"]["amount"] == "-100.0000"          # untouched leg
    # occurred_at and note are written to both legs (decision §14.53a)
    assert body["out"]["occurred_at"] == body["in"]["occurred_at"] == SEP5.isoformat()
    assert body["out"]["note"] == body["in"]["note"] == "换汇（按实际到账改）"
    assert body["updated_at"] != created["updated_at"]

    for leg_key in ("out", "in"):
        names = [
            event.event for event in events_of(db, uuid.UUID(body[leg_key]["id"]))
        ]
        assert names == ["created", "updated"]


def test_patch_transfer_with_a_stale_version_conflicts(env):
    created = env.post("/transfer", transfer_body(env)).json()

    response = env.patch(
        f"/transfer/{created['pair_id']}",
        {"note": "x", "updated_at": "2020-01-01T00:00:00.000000Z"},
    )

    assert response.status_code == 409
    assert response.json()["code"] == "stale_update"


def test_patch_transfer_rejects_collapsing_both_legs_onto_one_account(env):
    created = env.post("/transfer", transfer_body(env)).json()

    response = env.patch(
        f"/transfer/{created['pair_id']}",
        {"to_source_id": str(env.bank.id), "updated_at": created["updated_at"]},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "same_source"


def test_patch_transfer_to_repayment_needs_a_credit_target(env):
    created = env.post("/transfer", transfer_body(env)).json()

    response = env.patch(
        f"/transfer/{created['pair_id']}",
        {"subtype": "repayment", "updated_at": created["updated_at"]},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "repayment_target_not_credit"


def test_patch_and_delete_of_an_unknown_pair_are_not_found(env):
    unknown = uuid.uuid4()

    patched = env.patch(
        f"/transfer/{unknown}",
        {"note": "x", "updated_at": "2026-09-06T12:00:00.000000Z"},
    )
    assert patched.status_code == 404
    assert patched.json()["code"] == "not_found"
    assert env.delete(f"/transfer/{unknown}").status_code == 404


def test_delete_transfer_removes_both_legs_and_their_events(env, db):
    created = env.post("/transfer", transfer_body(env)).json()
    bystander = env.post(
        "",
        {
            "source_id": str(env.bank.id),
            "kind": "expense",
            "amount": "-9.00",
            "currency": "CNY",
            "occurred_at": SEP6.isoformat(),
            "category_l1": "food",
        },
    ).json()

    assert env.delete(f"/transfer/{created['pair_id']}").status_code == 204

    db.expire_all()
    assert db.get(Transaction, uuid.UUID(created["out"]["id"])) is None
    assert db.get(Transaction, uuid.UUID(created["in"]["id"])) is None
    assert events_of(db, uuid.UUID(created["out"]["id"])) == []
    assert db.get(Transaction, uuid.UUID(bystander["id"])) is not None
    # Deleting twice is a 404, like every other delete (§5.32)
    assert env.delete(f"/transfer/{created['pair_id']}").status_code == 404


def test_half_a_pair_cannot_be_patched_but_can_be_deleted(env, db, pair_factory):
    out_leg, in_leg = pair_factory(
        env.ledger, env.bank, env.cash, amount_out=Decimal("-100.0000"), occurred_at=SEP6
    )
    pair_id = out_leg.transfer_pair_id
    db.delete(in_leg)
    db.flush()

    patched = env.patch(
        f"/transfer/{pair_id}",
        {"note": "x", "updated_at": "2026-09-06T12:00:00.000000Z"},
    )
    assert patched.status_code == 409
    assert patched.json()["code"] == "transfer_pair_incomplete"

    assert env.delete(f"/transfer/{pair_id}").status_code == 204
    db.expire_all()
    assert db.get(Transaction, out_leg.id) is None


# ---------------------------------------------------------------------------
# POST /transactions/{tid}/pair (§5.33)
# ---------------------------------------------------------------------------


def test_pair_ties_two_single_legs_together(env, db):
    out_leg = single_leg(env, env.bank, role="out", amount="-100.00")
    in_leg = single_leg(env, env.cash, role="in", amount="100.00")

    response = env.post(
        f"/{in_leg['id']}/pair", {"other_transaction_id": out_leg["id"]}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body["in"]) == LEG_FIELDS
    assert body["out"]["id"] == out_leg["id"]
    assert body["in"]["id"] == in_leg["id"]
    assert body["pair_id"] not in (None, out_leg["transfer_pair_id"])
    assert body["out"]["transfer_pair_id"] == body["pair_id"]
    assert body["in"]["transfer_pair_id"] == body["pair_id"]
    # A paired leg never keeps its counterparty text (decision §1.2)
    assert body["out"]["counterparty"] is None and body["in"]["counterparty"] is None

    for leg_key in ("out", "in"):
        events = events_of(db, uuid.UUID(body[leg_key]["id"]))
        assert [event.event for event in events] == ["created", "paired"]
        assert events[-1].client == "web"
        assert events[-1].changes["counterparty"] == {"before": "老婆", "after": None}


def test_pair_allows_different_currencies_amounts_and_dates(env):
    out_leg = single_leg(env, env.bank, role="out", amount="-100.00")
    in_leg = single_leg(
        env,
        env.euro,
        role="in",
        amount="11.00",
        occurred_at=SEP5.isoformat(),
        note="EUR 到账",
    )

    body = env.post(
        f"/{out_leg['id']}/pair", {"other_transaction_id": in_leg["id"]}
    ).json()

    assert body["out"]["occurred_at"] == SEP6.isoformat()
    assert body["in"]["occurred_at"] == SEP5.isoformat()
    # The top level is the outgoing leg's view, whichever leg was addressed
    assert body["occurred_at"] == SEP6.isoformat()
    assert body["note"] == body["out"]["note"]
    assert body["in"]["currency"] == "EUR"
    assert body["in"]["amount_base"] == "86.0870"


def test_pair_unifies_the_subtype_onto_a_credit_card(env, db):
    """Decision §14.53a: one ``repayment`` leg plus a credit target wins."""
    out_leg = single_leg(env, env.bank, role="out", amount="-3000.00")
    in_leg = single_leg(
        env, env.card, role="in", amount="3000.00", transfer_subtype="repayment"
    )

    body = env.post(
        f"/{out_leg['id']}/pair", {"other_transaction_id": in_leg["id"]}
    ).json()

    assert body["subtype"] == "repayment"
    assert body["out"]["transfer_subtype"] == "repayment"
    assert body["in"]["transfer_subtype"] == "repayment"

    # Only the leg that really moved gets the extra ``updated`` event. It and
    # the ``paired`` event come out of one operation, so they share its stamp
    # (02-database.md §1.9) and their relative order carries no meaning.
    out_events = events_of(db, uuid.UUID(out_leg["id"]))
    assert out_events[0].event == "created"
    assert {event.event for event in out_events[1:]} == {"paired", "updated"}
    assert out_events[1].at == out_events[2].at
    subtype_event = next(event for event in out_events if event.event == "updated")
    assert subtype_event.changes == {
        "transfer_subtype": {"before": "plain", "after": "repayment"}
    }
    assert [event.event for event in events_of(db, uuid.UUID(in_leg["id"]))] == [
        "created",
        "paired",
    ]


def test_pair_falls_back_to_plain_when_the_target_is_not_a_credit_card(env, db):
    """The unified subtype is computed, never a reason to refuse the pairing."""
    out_leg = single_leg(
        env, env.bank, role="out", amount="-3000.00", transfer_subtype="repayment"
    )
    in_leg = single_leg(env, env.cash, role="in", amount="3000.00")

    body = env.post(
        f"/{out_leg['id']}/pair", {"other_transaction_id": in_leg["id"]}
    ).json()

    assert body["subtype"] == "plain"
    assert body["out"]["transfer_subtype"] == body["in"]["transfer_subtype"] == "plain"
    out_events = events_of(db, uuid.UUID(out_leg["id"]))
    assert out_events[0].event == "created"
    # Same instant, so ``paired`` and ``updated`` come back in either order.
    assert {event.event for event in out_events[1:]} == {"paired", "updated"}


def test_pair_refuses_a_leg_that_is_already_paired(env):
    created = env.post("/transfer", transfer_body(env)).json()
    lonely = single_leg(env, env.euro, role="in", amount="11.00")

    response = env.post(
        f"/{lonely['id']}/pair", {"other_transaction_id": created["out"]["id"]}
    )

    assert response.status_code == 400
    assert response.json()["code"] == "pair_invalid"


def test_pair_refuses_same_direction_same_account_itself_and_non_transfers(env):
    out_leg = single_leg(env, env.bank, role="out", amount="-100.00")
    other_out = single_leg(env, env.cash, role="out", amount="-100.00")
    same_account_in = single_leg(env, env.bank, role="in", amount="100.00")
    expense = env.post(
        "",
        {
            "source_id": str(env.cash.id),
            "kind": "expense",
            "amount": "-100.00",
            "currency": "CNY",
            "occurred_at": SEP6.isoformat(),
            "category_l1": "food",
        },
    ).json()

    for other in (other_out["id"], same_account_in["id"], out_leg["id"], expense["id"]):
        response = env.post(f"/{out_leg['id']}/pair", {"other_transaction_id": other})
        assert response.status_code == 400, (other, response.text)
        assert response.json()["code"] == "pair_invalid"


def test_pair_across_ledgers_is_not_found(
    env, user_factory, ledger_factory, source_factory, transaction_factory
):
    out_leg = single_leg(env, env.bank, role="out", amount="-100.00")
    other_user = user_factory()
    other_ledger = ledger_factory(other_user)
    foreign = transaction_factory(
        other_ledger,
        source_factory(other_ledger, name="别人的卡"),
        kind="transfer",
        amount=Decimal("100.0000"),
        occurred_at=SEP6,
    )

    response = env.post(
        f"/{out_leg['id']}/pair", {"other_transaction_id": str(foreign.id)}
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


# ---------------------------------------------------------------------------
# POST /transactions/transfer/{pair_id}/unpair (§5.34)
# ---------------------------------------------------------------------------


def test_unpair_turns_a_pair_back_into_two_single_legs(env, db):
    created = env.post(
        "/transfer",
        transfer_body(
            env, to_source_id=str(env.euro.id), amount_in="12.00", currency_in="EUR"
        ),
    ).json()

    response = env.post(f"/transfer/{created['pair_id']}/unpair")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["pair_id"] == created["pair_id"]
    assert {leg["id"] for leg in body["unpaired"]} == {
        created["out"]["id"],
        created["in"]["id"],
    }
    assert all(leg["transfer_pair_id"] is None for leg in body["unpaired"])
    assert all(leg["counterparty"] is None for leg in body["unpaired"])
    # Amounts and currencies are left exactly as they were (§5.34)
    amounts = {leg["amount"] for leg in body["unpaired"]}
    assert amounts == {"-100.0000", "12.0000"}

    db.expire_all()
    for leg_key in ("out", "in"):
        leg_id = uuid.UUID(created[leg_key]["id"])
        stored = db.get(Transaction, leg_id)
        assert stored is not None and stored.transfer_pair_id is None
        assert [event.event for event in events_of(db, leg_id)] == [
            "created",
            "unpaired",
        ]


def test_unpaired_legs_can_be_edited_and_deleted_on_their_own(env):
    created = env.post("/transfer", transfer_body(env)).json()
    env.post(f"/transfer/{created['pair_id']}/unpair")

    out_leg = env.get(f"/{created['out']['id']}").json()
    patched = env.patch(
        f"/{out_leg['id']}",
        {"note": "其实是给自己转的", "updated_at": out_leg["updated_at"]},
    )
    assert patched.status_code == 200, patched.text
    assert env.delete(f"/{created['in']['id']}").status_code == 204


def test_unpair_refuses_a_half_broken_pair(env, db, pair_factory):
    out_leg, in_leg = pair_factory(
        env.ledger, env.bank, env.cash, amount_out=Decimal("-100.0000"), occurred_at=SEP6
    )
    pair_id = out_leg.transfer_pair_id
    db.delete(in_leg)
    db.flush()

    response = env.post(f"/transfer/{pair_id}/unpair")

    assert response.status_code == 409
    assert response.json()["code"] == "unpair_invalid"


def test_unpair_of_an_unknown_pair_is_not_found(env):
    response = env.post(f"/transfer/{uuid.uuid4()}/unpair")

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


# ---------------------------------------------------------------------------
# Authorization (§3.2, §3.3)
# ---------------------------------------------------------------------------


def test_transfer_endpoints_hide_the_ledger_from_a_non_member(
    env, user_factory, auth_headers
):
    outsider = user_factory()

    response = env.client.post(
        env.url("/transfer"), json=transfer_body(env), headers=auth_headers(outsider)
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_transfer_endpoints_require_a_token(env):
    response = env.client.post(env.url("/transfer"), json=transfer_body(env))

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"
