"""Draft row endpoints (03-backend-api.md §5.40-§5.42, 05 §4.1-§4.2).

The rows under test are always produced by a real upload, so what a PATCH is
judged against is a row the validator really wrote — not a hand-built one.
"""
import datetime as dt
import uuid
from decimal import Decimal

import pytest

from app.models.import_batch import ImportRow
from tests.test_imports_api import paste, read_fixture, upload


@pytest.fixture()
def setup(db, user_factory, auth_headers, ledger_factory, source_factory):
    """Owner, ledger, the credit card being imported and a second account."""
    user = user_factory()
    ledger = ledger_factory(user)
    card = source_factory(ledger, name="招商 信用卡", type="credit")
    bank = source_factory(ledger, name="招商 储蓄卡", type="checking")
    db.flush()
    return user, auth_headers(user), ledger, card, bank


def imported(client, headers, ledger, source, name="ok_credit_cny.csv"):
    """Upload one fixture and hand back ``(batch_id, rows)``."""
    body = upload(client, headers, ledger, source, name).json()
    return body["batch"]["id"], body["rows"]


def patch_row(client, headers, ledger, bid, rid, payload):
    return client.patch(
        f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows/{rid}",
        headers=headers,
        json=payload,
    )


def patch_many(client, headers, ledger, bid, row_ids, payload):
    return client.patch(
        f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows",
        headers=headers,
        json={"row_ids": row_ids, "patch": payload},
    )


# ---------------------------------------------------------------------------
# §5.40 listing and filtering
# ---------------------------------------------------------------------------


def test_rows_are_listed_in_file_order_and_paged(setup, client):
    _user, headers, ledger, card, _bank = setup
    bid, rows = imported(client, headers, ledger, card)

    body = client.get(f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows", headers=headers).json()
    assert body["total"] == 6
    assert [row["row_no"] for row in body["items"]] == [1, 2, 3, 4, 5, 6]
    assert body["items"][0]["id"] == rows[0]["id"]

    page = client.get(
        f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows?limit=2&offset=4", headers=headers
    ).json()
    assert page["total"] == 6
    assert [row["row_no"] for row in page["items"]] == [5, 6]


def test_limit_over_five_hundred_is_422(setup, client):
    _user, headers, ledger, card, _bank = setup
    bid, _rows = imported(client, headers, ledger, card)

    refused = client.get(
        f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows?limit=501", headers=headers
    )
    accepted = client.get(
        f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows?limit=500", headers=headers
    )

    assert refused.status_code == 422
    assert refused.json()["code"] == "validation_error"
    assert accepted.status_code == 200


def test_the_three_review_filters(setup, client, transaction_factory):
    _user, headers, ledger, card, _bank = setup
    # A transaction the first row of the file duplicates (§3.1).
    transaction_factory(
        ledger,
        card,
        amount=Decimal("-128.0000"),
        occurred_at=dt.date(2026, 8, 3),
        category_l1="groceries",
        category_l2="fresh_food",
    )
    bid, rows = imported(client, headers, ledger, card)

    base = f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows"
    flagged = client.get(f"{base}?flagged=true", headers=headers).json()
    assert [row["row_no"] for row in flagged["items"]] == [1]
    assert "duplicate" in flagged["items"][0]["flags"]

    by_flag = client.get(f"{base}?flag=duplicate&flag=needs_review", headers=headers).json()
    assert by_flag["total"] == 1

    uncategorized = client.get(f"{base}?uncategorized=true", headers=headers).json()
    assert [row["row_no"] for row in uncategorized["items"]] == [4, 5]

    patch_row(client, headers, ledger, bid, rows[3]["id"], {"status": "skipped"})
    after = client.get(f"{base}?uncategorized=true", headers=headers).json()
    assert [row["row_no"] for row in after["items"]] == [5]  # a skipped row is not pending work

    by_status = client.get(f"{base}?status=skipped", headers=headers).json()
    assert [row["row_no"] for row in by_status["items"]] == [4]


def test_unknown_filter_values_are_422(setup, client):
    _user, headers, ledger, card, _bank = setup
    bid, _rows = imported(client, headers, ledger, card)

    base = f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows"
    assert client.get(f"{base}?status=confirmed", headers=headers).status_code == 422
    assert client.get(f"{base}?flag=merged", headers=headers).status_code == 422


# ---------------------------------------------------------------------------
# §5.41 editing one row
# ---------------------------------------------------------------------------


def test_editing_a_row_sets_it_to_edited(setup, client, db):
    _user, headers, ledger, card, _bank = setup
    bid, rows = imported(client, headers, ledger, card)

    response = patch_row(
        client,
        headers,
        ledger,
        bid,
        rows[3]["id"],
        {"category_l1": "shopping", "category_l2": "electronics", "note": "京东退款"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "edited"
    assert body["category_l1"] == "shopping"
    assert body["category_l2"] == "electronics"
    assert body["note"] == "京东退款"
    assert body["row_no"] == 4  # read-only fields are untouched
    stored = db.get(ImportRow, uuid.UUID(rows[3]["id"]))
    assert stored.category_l2 == "electronics"


def test_marking_a_row_skipped_leaves_its_values_alone(setup, client):
    _user, headers, ledger, card, _bank = setup
    bid, rows = imported(client, headers, ledger, card)

    body = patch_row(client, headers, ledger, bid, rows[0]["id"], {"status": "skipped"}).json()

    assert body["status"] == "skipped"
    assert body["amount"] == rows[0]["amount"]
    assert body["merchant"] == rows[0]["merchant"]


def test_explicit_null_clears_a_field(setup, client):
    _user, headers, ledger, card, _bank = setup
    bid, rows = imported(client, headers, ledger, card)

    body = patch_row(client, headers, ledger, bid, rows[0]["id"], {"category_l2": None}).json()

    assert body["category_l1"] == "groceries"
    assert body["category_l2"] is None


def test_read_only_fields_are_rejected(setup, client):
    _user, headers, ledger, card, _bank = setup
    bid, rows = imported(client, headers, ledger, card)

    for payload in ({"row_no": 9}, {"flags": []}, {"hint": "x"}, {"source_id": str(card.id)}):
        response = patch_row(client, headers, ledger, bid, rows[0]["id"], payload)
        assert response.status_code == 422, payload
        assert response.json()["code"] == "validation_error"


def test_invalid_categories_are_refused(setup, client, db):
    _user, headers, ledger, card, _bank = setup
    bid, rows = imported(client, headers, ledger, card)

    unknown = patch_row(client, headers, ledger, bid, rows[0]["id"], {"category_l1": "nope"})
    assert unknown.status_code == 400
    assert unknown.json()["code"] == "category_invalid"

    wrong_side = patch_row(
        client, headers, ledger, bid, rows[0]["id"], {"category_l1": "salary"}
    )
    assert wrong_side.status_code == 400
    assert wrong_side.json()["code"] == "category_kind_mismatch"

    stored = db.get(ImportRow, uuid.UUID(rows[0]["id"]))
    assert stored.category_l1 == "groceries"
    assert stored.status == "pending"  # a refused patch is not an edit


def test_sign_must_match_kind(setup, client):
    _user, headers, ledger, card, _bank = setup
    bid, rows = imported(client, headers, ledger, card)

    response = patch_row(client, headers, ledger, bid, rows[0]["id"], {"amount": "12.00"})

    assert response.status_code == 400
    assert response.json()["code"] == "validation_error"


def test_changing_kind_clears_the_category_and_the_links(setup, client, transaction_factory):
    _user, headers, ledger, card, bank = setup
    leg = transaction_factory(
        ledger,
        bank,
        kind="transfer",
        amount=Decimal("-3000.0000"),
        occurred_at=dt.date(2026, 8, 20),
        transfer_role="out",
        transfer_subtype="plain",
    )
    bid, rows = imported(client, headers, ledger, card)
    transfer = rows[5]
    assert transfer["matched_transaction_id"] == str(leg.id)  # §3.3 pre-filled it

    body = patch_row(
        client,
        headers,
        ledger,
        bid,
        transfer["id"],
        {"kind": "expense", "amount": "-3000.00"},
    ).json()

    assert body["kind"] == "expense"
    assert body["matched_transaction_id"] is None
    assert body["counterpart_source_id"] is None
    assert body["transfer_role"] is None
    assert body["transfer_subtype"] is None
    assert "transfer_candidate" not in body["flags"]


def test_changing_kind_clears_a_category_from_the_other_side(setup, client):
    """§4.1: the expense-side category left behind by a kind change is repaired."""
    _user, headers, ledger, card, _bank = setup
    bid, rows = imported(client, headers, ledger, card)

    body = patch_row(
        client, headers, ledger, bid, rows[0]["id"], {"kind": "income", "amount": "128.00"}
    ).json()

    assert body["kind"] == "income"
    assert body["category_l1"] is None
    assert body["category_l2"] is None
    assert body["hint"] and "groceries" in body["hint"]


def test_a_transfer_row_may_not_carry_a_merchant(setup, client):
    _user, headers, ledger, card, _bank = setup
    bid, rows = imported(client, headers, ledger, card)

    response = patch_row(client, headers, ledger, bid, rows[5]["id"], {"merchant": "招行"})

    assert response.status_code == 400
    assert response.json()["code"] == "validation_error"


def test_counterpart_account_rules(setup, client, ledger_factory, source_factory, db):
    _user, headers, ledger, card, bank = setup
    bid, rows = imported(client, headers, ledger, card)
    transfer, expense = rows[5], rows[0]

    ok = patch_row(
        client, headers, ledger, bid, transfer["id"], {"counterpart_source_id": str(bank.id)}
    )
    assert ok.status_code == 200
    assert ok.json()["counterpart_source_id"] == str(bank.id)

    same = patch_row(
        client, headers, ledger, bid, transfer["id"], {"counterpart_source_id": str(card.id)}
    )
    assert same.status_code == 400
    assert same.json()["code"] == "same_source"

    elsewhere = source_factory(ledger_factory(_user, name="别的账本"))
    foreign = patch_row(
        client, headers, ledger, bid, transfer["id"], {"counterpart_source_id": str(elsewhere.id)}
    )
    assert foreign.status_code == 404
    assert foreign.json()["code"] == "not_found"

    archived = source_factory(ledger, name="旧卡", archived=True)
    gone = patch_row(
        client, headers, ledger, bid, transfer["id"], {"counterpart_source_id": str(archived.id)}
    )
    assert gone.status_code == 404

    on_expense = patch_row(
        client, headers, ledger, bid, expense["id"], {"counterpart_source_id": str(bank.id)}
    )
    assert on_expense.status_code == 400
    assert on_expense.json()["code"] == "validation_error"

    # None of the refusals stuck; the one accepted value did.
    stored = db.get(ImportRow, uuid.UUID(transfer["id"]))
    assert stored.counterpart_source_id == bank.id


def test_refund_target_must_be_an_expense_of_this_ledger(setup, client, transaction_factory):
    _user, headers, ledger, card, bank = setup
    bid, rows = imported(client, headers, ledger, card)
    refund = rows[3]

    income = transaction_factory(
        ledger, bank, kind="income", amount=Decimal("100.0000"), category_l1="salary"
    )
    bad = patch_row(
        client, headers, ledger, bid, refund["id"], {"matched_transaction_id": str(income.id)}
    )
    assert bad.status_code == 400
    assert bad.json()["code"] == "refund_target_invalid"

    expense = transaction_factory(
        ledger, card, amount=Decimal("-299.0000"), category_l1="shopping"
    )
    good = patch_row(
        client, headers, ledger, bid, refund["id"], {"matched_transaction_id": str(expense.id)}
    )
    assert good.status_code == 200
    assert good.json()["matched_transaction_id"] == str(expense.id)

    cleared = patch_row(
        client, headers, ledger, bid, refund["id"], {"matched_transaction_id": None}
    )
    assert cleared.json()["matched_transaction_id"] is None


def test_pairing_a_transfer_row_follows_the_pair_rules(setup, client, transaction_factory, db):
    _user, headers, ledger, card, bank = setup
    bid, rows = imported(client, headers, ledger, card)
    transfer = rows[5]

    same_account = transaction_factory(
        ledger,
        card,
        kind="transfer",
        amount=Decimal("-3000.0000"),
        transfer_role="out",
        transfer_subtype="plain",
    )
    refused = patch_row(
        client,
        headers,
        ledger,
        bid,
        transfer["id"],
        {"matched_transaction_id": str(same_account.id)},
    )
    assert refused.status_code == 400
    assert refused.json()["code"] == "pair_invalid"

    same_direction = transaction_factory(
        ledger,
        bank,
        kind="transfer",
        amount=Decimal("3000.0000"),
        transfer_role="in",
        transfer_subtype="plain",
    )
    wrong_way = patch_row(
        client,
        headers,
        ledger,
        bid,
        transfer["id"],
        {"matched_transaction_id": str(same_direction.id)},
    )
    assert wrong_way.status_code == 400
    assert wrong_way.json()["code"] == "pair_invalid"

    leg = transaction_factory(
        ledger,
        bank,
        kind="transfer",
        amount=Decimal("-3000.0000"),
        transfer_role="out",
        transfer_subtype="plain",
    )
    ok = patch_row(
        client, headers, ledger, bid, transfer["id"], {"matched_transaction_id": str(leg.id)}
    )
    assert ok.status_code == 200
    assert db.get(ImportRow, uuid.UUID(transfer["id"])).matched_transaction_id == leg.id


def test_a_row_of_another_batch_is_404(setup, client):
    _user, headers, ledger, card, _bank = setup
    first, rows = imported(client, headers, ledger, card)
    second, _other_rows = imported(client, headers, ledger, card, "ok_bom.csv")

    response = patch_row(client, headers, ledger, second, rows[0]["id"], {"note": "x"})

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_a_committed_batch_can_no_longer_be_edited(setup, client):
    _user, headers, ledger, card, _bank = setup
    bid, rows = imported(client, headers, ledger, card, "ok_bom.csv")
    commit = client.post(f"/api/v1/ledgers/{ledger.id}/imports/{bid}/commit", headers=headers)
    assert commit.status_code == 200, commit.text

    single = patch_row(client, headers, ledger, bid, rows[0]["id"], {"note": "x"})
    bulk = patch_many(client, headers, ledger, bid, [rows[0]["id"]], {"status": "skipped"})

    assert single.status_code == bulk.status_code == 409
    assert single.json()["code"] == "batch_not_ready"
    assert bulk.json()["code"] == "batch_not_ready"


# ---------------------------------------------------------------------------
# §5.42 bulk edits
# ---------------------------------------------------------------------------


def test_bulk_sets_the_same_category_on_every_row(setup, client, db):
    _user, headers, ledger, card, _bank = setup
    bid, rows = imported(client, headers, ledger, card)
    targets = [rows[0]["id"], rows[1]["id"], rows[4]["id"]]

    response = patch_many(
        client,
        headers,
        ledger,
        bid,
        targets,
        {"category_l1": "food", "category_l2": "lunch"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["updated"] == 3
    assert [row["row_no"] for row in body["rows"]] == [1, 2, 5]
    assert all(row["category_l1"] == "food" for row in body["rows"])
    assert all(row["status"] == "edited" for row in body["rows"])
    untouched = db.get(ImportRow, uuid.UUID(rows[2]["id"]))
    assert (untouched.status, untouched.category_l2) == ("pending", "snacks_drinks")


def test_bulk_skip(setup, client):
    _user, headers, ledger, card, _bank = setup
    bid, rows = imported(client, headers, ledger, card)

    body = patch_many(
        client, headers, ledger, bid, [row["id"] for row in rows[:2]], {"status": "skipped"}
    ).json()

    assert body["updated"] == 2
    assert all(row["status"] == "skipped" for row in body["rows"])


def test_bulk_is_all_or_nothing(setup, client, db):
    """Three expenses and one income row, set to an expense-side category."""
    _user, headers, ledger, card, _bank = setup
    text = read_fixture("ok_paste_alipay.txt").decode("utf-8")
    created = paste(client, headers, ledger, card, text).json()
    bid, rows = created["batch"]["id"], created["rows"]
    income = rows[5]
    assert income["kind"] == "income"
    before = {row["id"]: (row["category_l1"], row["category_l2"], row["status"]) for row in rows}

    response = patch_many(
        client,
        headers,
        ledger,
        bid,
        [rows[0]["id"], rows[1]["id"], income["id"]],
        {"category_l1": "food", "category_l2": "lunch"},
    )

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "category_kind_mismatch"
    assert "row 6" in body["detail"]  # §5.42: the detail names the offending row

    after = client.get(
        f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows", headers=headers
    ).json()["items"]
    for row in after:
        assert (row["category_l1"], row["category_l2"], row["status"]) == before[row["id"]]
    assert all(
        stored.status == "pending"
        for stored in db.query(ImportRow).filter(ImportRow.batch_id == uuid.UUID(bid))
    )


def test_bulk_refuses_a_row_of_another_batch(setup, client, db):
    _user, headers, ledger, card, _bank = setup
    bid, rows = imported(client, headers, ledger, card)
    _other, other_rows = imported(client, headers, ledger, card, "ok_bom.csv")

    response = patch_many(
        client, headers, ledger, bid, [rows[0]["id"], other_rows[0]["id"]], {"status": "skipped"}
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    assert db.get(ImportRow, uuid.UUID(rows[0]["id"])).status == "pending"


def test_bulk_row_ids_must_be_one_to_five_hundred(setup, client):
    _user, headers, ledger, card, _bank = setup
    bid, rows = imported(client, headers, ledger, card)

    empty = patch_many(client, headers, ledger, bid, [], {"status": "skipped"})
    too_many = patch_many(
        client, headers, ledger, bid, [str(uuid.uuid4()) for _ in range(501)], {"status": "skipped"}
    )

    assert empty.status_code == 422
    assert empty.json()["code"] == "validation_error"
    assert too_many.status_code == 422
