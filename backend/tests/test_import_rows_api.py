"""Draft row endpoints (03-backend-api.md §5.40-§5.42, 05 §4.1-§4.2).

The rows under test are always produced by a real upload, so what a PATCH is
judged against is a row the validator really wrote — not a hand-built one.
"""
import datetime as dt
import uuid
from decimal import Decimal

import pytest

from app.core.categories import CATEGORY_VERSION
from app.core.clock import utcnow
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


@pytest.mark.parametrize(
    "field", ["matched_transaction_id", "counterpart_source_id", "counterparty"]
)
def test_bulk_refuses_the_three_per_row_link_fields(setup, client, db, field):
    """05 §4.1: a link points at one counterpart of one row, so §5.42 does not
    take these three (03 §5.42's blanket "same fields as §5.41" loses to that
    specific rule). Pasting one ``matched_transaction_id`` over a selection would
    only produce ``pair_invalid`` at commit from the second row on.
    """
    _user, headers, ledger, card, bank = setup
    bid, rows = imported(client, headers, ledger, card)
    value = "老婆" if field == "counterparty" else str(bank.id)

    response = patch_many(
        client, headers, ledger, bid, [row["id"] for row in rows[:2]], {field: value}
    )

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"
    untouched = db.get(ImportRow, uuid.UUID(rows[0]["id"]))
    assert untouched.status == "pending"  # nothing was applied
    # ... while §5.41's per-row endpoint still knows the field: whatever it
    # answers about the *value* (this one points at an account, not a
    # transaction), it is never "unknown field".
    single = patch_row(client, headers, ledger, bid, rows[5]["id"], {field: value})
    assert single.status_code != 422, single.text


def test_bulk_still_takes_every_other_editable_field(setup, client):
    """The narrowing is exactly three fields wide: §5.41's other eleven still
    apply to a whole selection in one call."""
    _user, headers, ledger, card, _bank = setup
    bid, rows = imported(client, headers, ledger, card)

    response = patch_many(
        client,
        headers,
        ledger,
        bid,
        [rows[0]["id"], rows[1]["id"]],
        {
            "status": "skipped",
            "date": "2026-08-30",
            "amount": "-9.5",
            "currency": "cny",
            "kind": "expense",
            "merchant": "便利店",
            "note": "批量改的",
            "category_l1": "food",
            "category_l2": "lunch",
            "transfer_role": None,
            "transfer_subtype": None,
        },
    )

    assert response.status_code == 200, response.text
    for row in response.json()["rows"]:
        assert row["status"] == "skipped"
        assert row["date"] == "2026-08-30"
        assert row["amount"] == "-9.5000"
        assert row["currency"] == "CNY"
        assert (row["category_l1"], row["category_l2"]) == ("food", "lunch")
        assert row["merchant"] == "便利店"


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


# ---------------------------------------------------------------------------
# 05 §1.3 / §2.8: what the importer itself stored stays patchable
# ---------------------------------------------------------------------------

#: Two rows the validator deliberately leaves loose — §2.8 rules 9/10 store an
#: unreadable amount as ``0`` and never take a merchant off a transfer line —
#: plus one ordinary expense, so the batch has something left to commit.
LOOSE = (
    f"# version: {CATEGORY_VERSION}\n"
    "date,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,"
    "category_l1,category_l2,source_ref\n"
    "2026-08-10,n/a,CNY,income,,,,工资,salary,base_salary,p1:l2\n"
    "2026-08-20,3000.00,CNY,transfer,in,repayment,招商银行,AUTOPAY,,,p1:l30\n"
    "2026-08-21,-128.00,CNY,expense,,,盒马,,groceries,fresh_food,p1:l31\n"
)


@pytest.fixture()
def loose(setup, client):
    """The three rows above, imported through the real paste route."""
    _user, headers, ledger, card, _bank = setup
    body = paste(client, headers, ledger, card, LOOSE).json()
    rows = body["rows"]
    assert (rows[0]["amount"], rows[0]["kind"]) == ("0.0000", "income")
    assert "needs_review" in rows[0]["flags"]
    assert rows[1]["merchant"] == "招商银行"  # §2.4 ⑧ never clears it (05 §2.8)
    return headers, ledger, body["batch"]["id"], rows


def test_a_loose_row_can_still_be_skipped(loose, client, db):
    """§5.41's ``pending -> skipped`` must stay reachable for every draft row.

    Neither row below can be "fixed" the way a validation error implies: the
    file simply had no amount, and a repayment line really does carry the bank's
    name. Judging them on a PATCH that only sets ``status`` would leave the user
    with a batch that can be neither skipped nor committed.
    """
    headers, ledger, bid, rows = loose

    for row in rows[:2]:
        response = patch_row(client, headers, ledger, bid, row["id"], {"status": "skipped"})
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "skipped"
    assert db.get(ImportRow, uuid.UUID(rows[0]["id"])).amount == Decimal("0.0000")


def test_a_loose_row_does_not_block_the_bulk_skip_or_the_commit(loose, client):
    headers, ledger, bid, rows = loose

    bulk = patch_many(client, headers, ledger, bid, [rows[0]["id"]], {"status": "skipped"})
    assert bulk.status_code == 200, bulk.text
    assert bulk.json()["updated"] == 1

    commit = client.post(f"/api/v1/ledgers/{ledger.id}/imports/{bid}/commit", headers=headers)
    assert commit.status_code == 200, commit.text
    assert commit.json()["skipped_rows"] == 1
    assert commit.json()["created_transactions"] == 2


def test_the_whole_loose_batch_can_be_bulk_skipped(loose, client):
    headers, ledger, bid, rows = loose

    body = patch_many(
        client, headers, ledger, bid, [row["id"] for row in rows], {"status": "skipped"}
    )

    assert body.status_code == 200, body.text
    assert body.json()["updated"] == 3
    assert all(row["status"] == "skipped" for row in body.json()["rows"])


def test_a_request_that_sets_a_bad_sign_is_still_refused(loose, client, db):
    """The leniency above is about leftovers only — §5.41's error table stands."""
    headers, ledger, bid, rows = loose

    single = patch_row(client, headers, ledger, bid, rows[0]["id"], {"amount": "-5.00"})
    bulk = patch_many(client, headers, ledger, bid, [rows[0]["id"]], {"amount": "-5.00"})

    assert single.status_code == bulk.status_code == 400
    assert single.json()["code"] == "validation_error"
    assert single.json()["detail"] == "an income amount must be positive"
    # §5.42: the bulk detail names the row even when only one id was sent.
    assert bulk.json()["detail"] == "row 1: an income amount must be positive"
    assert db.get(ImportRow, uuid.UUID(rows[0]["id"])).amount == Decimal("0.0000")


def test_a_request_that_puts_a_merchant_on_a_transfer_is_still_refused(loose, client, db):
    headers, ledger, bid, rows = loose

    # Turning a merchant-bearing expense into a transfer is the same mistake.
    becomes_transfer = patch_row(
        client,
        headers,
        ledger,
        bid,
        rows[2]["id"],
        {"kind": "transfer", "transfer_role": "out", "transfer_subtype": "plain"},
    )
    sets_merchant = patch_row(client, headers, ledger, bid, rows[1]["id"], {"merchant": "招行"})

    assert becomes_transfer.status_code == sets_merchant.status_code == 400
    assert becomes_transfer.json()["detail"] == "a transfer row must not carry a merchant"
    stored = db.get(ImportRow, uuid.UUID(rows[2]["id"]))
    assert (stored.kind, stored.status) == ("expense", "pending")


def test_hint_is_rewritten_after_an_edit(loose, client):
    """05 §4.1: a note about a value the user has since corrected disappears."""
    headers, ledger, bid, rows = loose
    assert "n/a" in rows[0]["hint"]

    skipped = patch_row(client, headers, ledger, bid, rows[0]["id"], {"status": "skipped"})
    fixed = patch_row(client, headers, ledger, bid, rows[0]["id"], {"amount": "5000.00"})

    assert skipped.json()["hint"] == rows[0]["hint"]  # a status-only patch says nothing new
    assert fixed.json()["hint"] is None


def test_changing_kind_looks_the_candidates_up_again(setup, client, transaction_factory):
    """05 §4.1: §3.2 / §3.3 run again under the new ``kind``."""
    _user, headers, ledger, card, bank = setup
    leg = transaction_factory(
        ledger,
        bank,
        kind="transfer",
        amount=Decimal("-500.0000"),
        occurred_at=dt.date(2026, 8, 22),
        transfer_role="out",
        transfer_subtype="plain",
    )
    text = (
        f"# version: {CATEGORY_VERSION}\n"
        "date,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,"
        "category_l1,category_l2,source_ref\n"
        "2026-08-22,500.00,CNY,income,,,,,social_income,transfer_in,p1:l40\n"
    )
    created = paste(client, headers, ledger, card, text).json()
    row = created["rows"][0]
    assert row["matched_transaction_id"] is None  # nothing to find for an income row

    body = patch_row(
        client,
        headers,
        ledger,
        created["batch"]["id"],
        row["id"],
        {"kind": "transfer", "transfer_role": "in", "transfer_subtype": "plain"},
    ).json()

    assert body["matched_transaction_id"] == str(leg.id)
    assert body["counterpart_source_id"] == str(bank.id)
    assert "transfer_candidate" in body["flags"]


def test_a_duplicate_flagged_expense_row_stays_patchable(setup, client, transaction_factory):
    """05 §4.1: §3.1 pre-fills ``matched_transaction_id`` on *any* kind of row.

    ``flag_duplicates`` links an expense row to the twin it found, and its whole
    point is that the user then skips the row — so skipping it, skipping it in
    bulk, and re-categorising it all have to work without the user first being
    asked to clear a link 04 §4.10 gives them no control over.
    """
    _user, headers, ledger, card, _bank = setup
    twin = transaction_factory(
        ledger,
        card,
        amount=Decimal("-128.0000"),
        occurred_at=dt.date(2026, 8, 3),
        category_l1="groceries",
        category_l2="fresh_food",
    )
    bid, rows = imported(client, headers, ledger, card)
    assert "duplicate" in rows[0]["flags"]
    assert rows[0]["matched_transaction_id"] == str(twin.id)

    recategorized = patch_row(
        client, headers, ledger, bid, rows[0]["id"],
        {"category_l1": "food", "category_l2": "lunch"},
    )
    skipped = patch_row(client, headers, ledger, bid, rows[0]["id"], {"status": "skipped"})
    bulk = patch_many(
        client, headers, ledger, bid, [row["id"] for row in rows], {"status": "skipped"}
    )

    assert recategorized.status_code == 200
    assert skipped.status_code == 200
    assert skipped.json()["matched_transaction_id"] == str(twin.id)  # the link survives
    assert bulk.status_code == 200
    assert [row["status"] for row in bulk.json()["rows"]] == ["skipped"] * 6


def test_a_transfer_row_stays_patchable_after_its_counterpart_is_archived(
    setup, client, db, transaction_factory
):
    """05 §4.1: §3.3's pre-filled ``counterpart_source_id`` is not re-judged here.

    The world can invalidate it after the upload; commit is where 03 §5.43's
    error table puts that failure, and until then the row has to stay skippable.
    """
    _user, headers, ledger, card, bank = setup
    transaction_factory(
        ledger,
        bank,
        kind="transfer",
        amount=Decimal("-3000.0000"),
        occurred_at=dt.date(2026, 8, 20),
        transfer_role="out",
        transfer_subtype="plain",
    )
    bid, rows = imported(client, headers, ledger, card)
    assert "transfer_candidate" in rows[5]["flags"]
    assert rows[5]["counterpart_source_id"] == str(bank.id)

    bank.archived = True
    bank.archived_at = utcnow()  # the CHECK of 02 §1.4 wants both
    db.flush()

    body = patch_row(client, headers, ledger, bid, rows[5]["id"], {"status": "skipped"})

    assert body.status_code == 200
    assert body.json()["status"] == "skipped"
