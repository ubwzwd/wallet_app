"""Import batch endpoints (03-backend-api.md §5.37-§5.39, §5.43, §5.44).

Uploads run the real fixture files of 05 §7.1 through the real endpoint, so the
order of §2.1 is exercised end to end: a file that trips any whole-file rule
leaves no batch behind, and one that only trips row-level rules always does.
"""
import uuid
from decimal import Decimal
from pathlib import Path

import pytest

from app.core.categories import CATEGORY_VERSION
from app.models.import_batch import ImportBatch, ImportRow
from app.models.transaction import Transaction

FIXTURES = Path(__file__).parent / "fixtures" / "import"


def read_fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def upload(client, headers, ledger, source, name="ok_credit_cny.csv", data=None):
    """POST the multipart half of §5.37 with one of the standard fixtures."""
    return client.post(
        f"/api/v1/ledgers/{ledger.id}/imports",
        headers=headers,
        files={"file": (name, read_fixture(name) if data is None else data, "text/csv")},
        data={"source_id": str(source.id)},
    )


def paste(client, headers, ledger, source, text):
    return client.post(
        f"/api/v1/ledgers/{ledger.id}/imports",
        headers=headers,
        json={"source_id": str(source.id), "text": text},
    )


@pytest.fixture()
def ledger_setup(db, user_factory, auth_headers, ledger_factory, source_factory):
    """An owner, a ledger and one credit-card account to import into."""
    user = user_factory()
    ledger = ledger_factory(user)
    source = source_factory(ledger, name="招商 信用卡", type="credit")
    db.flush()
    return user, auth_headers(user), ledger, source


# ---------------------------------------------------------------------------
# §5.37 upload
# ---------------------------------------------------------------------------


def test_upload_csv_creates_ready_batch_with_all_rows(ledger_setup, client, db):
    user, headers, ledger, source = ledger_setup

    response = upload(client, headers, ledger, source)

    assert response.status_code == 201, response.text
    body = response.json()
    batch, rows = body["batch"], body["rows"]
    assert batch["source"] == "csv"
    assert batch["filename"] == "ok_credit_cny.csv"
    assert batch["size_bytes"] == len(read_fixture("ok_credit_cny.csv"))
    assert batch["skill_version"] == CATEGORY_VERSION
    assert batch["status"] == "ready"
    assert batch["committed_at"] is None
    assert batch["created_by"] == str(user.id)
    assert batch["source_id"] == str(source.id)
    assert batch["source_name"] == "招商 信用卡"
    assert batch["base_currency"] == "CNY"
    assert batch["warnings"] == []
    # §4.9: transfers stay out of the net amount; -128 -45 -68 +299 -238.
    assert batch["net_amount"] == "-180.0000"
    assert batch["row_count"] == 6 == len(rows)
    assert batch["row_status_summary"] == {"pending": 6, "edited": 0, "skipped": 0}
    assert set(batch["flags_summary"]) == {
        "duplicate",
        "refund_candidate",
        "transfer_candidate",
        "needs_review",
    }
    # The refund row and the 淘宝 expense arrive without a category.
    assert batch["uncategorized_count"] == 2

    assert [row["row_no"] for row in rows] == [1, 2, 3, 4, 5, 6]
    assert rows[0]["date"] == "2026-08-03"
    assert rows[0]["amount"] == "-128.0000"
    assert rows[0]["status"] == "pending"
    assert rows[0]["transaction_id"] is None
    assert rows[5]["kind"] == "transfer"
    assert rows[5]["transfer_role"] == "in"
    assert rows[5]["transfer_subtype"] == "repayment"

    stored = db.query(ImportRow).filter(ImportRow.batch_id == uuid.UUID(batch["id"])).all()
    assert len(stored) == 6


def test_paste_creates_batch_without_filename(ledger_setup, client):
    _user, headers, ledger, source = ledger_setup
    text = read_fixture("ok_paste_alipay.txt").decode("utf-8")

    response = paste(client, headers, ledger, source, text)

    assert response.status_code == 201, response.text
    batch = response.json()["batch"]
    assert batch["source"] == "paste"
    assert batch["filename"] is None
    assert batch["size_bytes"] == len(text.encode("utf-8"))
    assert batch["row_count"] == 6
    # 154.20 = -19.90 -19.90 -6.00 -899.00 +899.00 +200.00
    assert batch["net_amount"] == "154.2000"
    assert len(response.json()["rows"]) == 6


def test_net_amount_is_converted_to_the_ledger_base_currency(
    ledger_setup, client, source_factory
):
    """§4.9: a foreign-currency statement still reports its net in the base."""
    _user, headers, ledger, _card = ledger_setup
    sgd = source_factory(ledger, name="DBS Multiplier", type="checking", currency="SGD")

    batch = upload(client, headers, ledger, sgd, "ok_checking_sgd.csv").json()["batch"]

    assert batch["base_currency"] == "CNY"
    # -1850.00 -62.40 -31.90 -184.20 +6200.00 SGD, transfers left out.
    expected = Decimal("4071.50") * Decimal("7.2") / Decimal("1.35")
    assert abs(Decimal(batch["net_amount"]) - expected) < Decimal("0.05")


def test_upload_with_bom_and_crlf_is_accepted(ledger_setup, client):
    _user, headers, ledger, source = ledger_setup
    assert upload(client, headers, ledger, source, "ok_bom.csv").status_code == 201
    assert upload(client, headers, ledger, source, "ok_crlf.csv").status_code == 201


def test_missing_version_line_is_a_structure_error(ledger_setup, client, db):
    _user, headers, ledger, source = ledger_setup

    response = upload(client, headers, ledger, source, "bad_no_version.csv")

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "import_format_invalid"
    assert body["errors"][0]["line"] == 1
    assert db.query(ImportBatch).count() == 0  # nothing is written


def test_outdated_version_is_skill_outdated(ledger_setup, client, db):
    _user, headers, ledger, source = ledger_setup

    response = upload(client, headers, ledger, source, "stale_version.csv")

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "skill_outdated"
    assert body["file_version"] == "2026-08-20"
    assert body["current_version"] == CATEGORY_VERSION
    # 04 §4.10: the frontend pushes this path as it stands, so it has to be the
    # app's real, ledger-scoped guide route — not a template, not a bare path.
    assert body["guide_url"] == f"/l/{ledger.id}/imports/guide"
    assert "{" not in body["guide_url"]
    assert db.query(ImportBatch).count() == 0


def test_undecodable_file_is_rejected_before_the_version_check(ledger_setup, client):
    _user, headers, ledger, source = ledger_setup

    response = upload(client, headers, ledger, source, "bad_gbk.csv")

    assert response.status_code == 400
    assert response.json()["code"] == "import_format_invalid"


def test_wrong_header_lists_line_two(ledger_setup, client):
    _user, headers, ledger, source = ledger_setup

    response = upload(client, headers, ledger, source, "bad_header_extra_col.csv")

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "import_format_invalid"
    # The header is one column too wide, so every record is the wrong width too.
    assert body["errors"][0]["line"] == 2
    assert "counterparty" in body["errors"][0]["message"]


def test_ragged_rows_are_listed_by_line(ledger_setup, client):
    _user, headers, ledger, source = ledger_setup

    response = upload(client, headers, ledger, source, "bad_ragged.csv")

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "import_format_invalid"
    assert len(body["errors"]) >= 1
    assert all(error["line"] > 2 for error in body["errors"])


def test_row_count_over_the_limit_is_refused(ledger_setup, client, db):
    _user, headers, ledger, source = ledger_setup

    response = upload(client, headers, ledger, source, "bad_2001_rows.csv")

    assert response.status_code == 400
    assert response.json()["code"] == "rows_exceed_limit"
    assert db.query(ImportBatch).count() == 0


def test_two_thousand_rows_is_still_accepted(ledger_setup, client):
    _user, headers, ledger, source = ledger_setup

    response = upload(client, headers, ledger, source, "ok_2000_rows.csv")

    assert response.status_code == 201
    assert response.json()["batch"]["row_count"] == 2000


def test_file_over_two_megabytes_is_413(ledger_setup, client):
    _user, headers, ledger, source = ledger_setup
    oversized = b"# version: " + CATEGORY_VERSION.encode() + b"\n" + b"a" * (2 * 1024 * 1024)

    response = upload(client, headers, ledger, source, "big.csv", data=oversized)

    assert response.status_code == 413
    assert response.json()["code"] == "file_too_large"


def test_body_far_over_the_limit_is_cut_while_reading(ledger_setup, client):
    _user, headers, ledger, source = ledger_setup

    response = paste(client, headers, ledger, source, "x" * (3 * 1024 * 1024))

    assert response.status_code == 413
    assert response.json()["code"] == "file_too_large"


def test_archived_target_account_is_409(ledger_setup, client, source_factory):
    _user, headers, ledger, _source = ledger_setup
    archived = source_factory(ledger, name="旧卡", archived=True)

    response = upload(client, headers, ledger, archived)

    assert response.status_code == 409
    assert response.json()["code"] == "source_archived"


def test_source_of_another_ledger_is_404(ledger_setup, client, ledger_factory, source_factory):
    user, headers, ledger, _source = ledger_setup
    other = source_factory(ledger_factory(user, name="别的账本"))

    response = upload(client, headers, ledger, other)

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_non_member_cannot_upload(ledger_setup, client, user_factory, auth_headers):
    _user, _headers, ledger, source = ledger_setup
    stranger = auth_headers(user_factory())

    assert upload(client, stranger, ledger, source).status_code == 404


def test_eleventh_upload_in_an_hour_is_rate_limited(ledger_setup, client):
    _user, headers, ledger, source = ledger_setup

    for _ in range(10):
        assert upload(client, headers, ledger, source, "ok_bom.csv").status_code == 201

    response = upload(client, headers, ledger, source, "ok_bom.csv")

    assert response.status_code == 429
    assert response.json()["code"] == "import_rate_limited"
    assert int(response.headers["Retry-After"]) >= 1


def test_multipart_without_a_file_part_is_422(ledger_setup, client):
    _user, headers, ledger, source = ledger_setup

    response = client.post(
        f"/api/v1/ledgers/{ledger.id}/imports",
        headers=headers,
        files={"other": ("x.csv", b"a", "text/csv")},
        data={"source_id": str(source.id)},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_paste_body_without_text_is_422(ledger_setup, client):
    _user, headers, ledger, source = ledger_setup

    response = client.post(
        f"/api/v1/ledgers/{ledger.id}/imports",
        headers=headers,
        json={"source_id": str(source.id)},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


# ---------------------------------------------------------------------------
# §5.38 / §5.39 list and detail
# ---------------------------------------------------------------------------


def test_list_batches_filters_by_status_and_pages(ledger_setup, client):
    _user, headers, ledger, source = ledger_setup
    first = upload(client, headers, ledger, source, "ok_bom.csv").json()["batch"]["id"]
    second = upload(client, headers, ledger, source, "ok_crlf.csv").json()["batch"]["id"]

    listing = client.get(f"/api/v1/ledgers/{ledger.id}/imports", headers=headers).json()
    assert listing["total"] == 2
    assert {item["id"] for item in listing["items"]} == {first, second}
    assert all(item["source_name"] == "招商 信用卡" for item in listing["items"])

    ready = client.get(
        f"/api/v1/ledgers/{ledger.id}/imports?status=ready", headers=headers
    ).json()
    assert ready["total"] == 2
    committed = client.get(
        f"/api/v1/ledgers/{ledger.id}/imports?status=committed", headers=headers
    ).json()
    assert committed == {"items": [], "total": 0}

    page = client.get(
        f"/api/v1/ledgers/{ledger.id}/imports?limit=1&offset=1", headers=headers
    ).json()
    assert page["total"] == 2 and len(page["items"]) == 1


def test_list_rejects_an_unknown_status(ledger_setup, client):
    _user, headers, ledger, _source = ledger_setup

    response = client.get(
        f"/api/v1/ledgers/{ledger.id}/imports?status=reverted", headers=headers
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_detail_recomputes_the_summaries_after_an_edit(ledger_setup, client):
    _user, headers, ledger, source = ledger_setup
    created = upload(client, headers, ledger, source).json()
    bid = created["batch"]["id"]
    rows = created["rows"]

    client.patch(
        f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows/{rows[3]['id']}",
        headers=headers,
        json={"category_l1": "shopping", "category_l2": "electronics"},
    )
    client.patch(
        f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows/{rows[0]['id']}",
        headers=headers,
        json={"status": "skipped"},
    )

    body = client.get(f"/api/v1/ledgers/{ledger.id}/imports/{bid}", headers=headers).json()
    assert body["row_status_summary"] == {"pending": 4, "edited": 1, "skipped": 1}
    assert body["uncategorized_count"] == 1  # the refund row now has a category
    assert body["net_amount"] == "-52.0000"  # the skipped -128 row drops out
    assert body["row_count"] == 6  # the column still counts every stored row

    # 05 §4.9 counts what commit would still refuse, so skipping the one row
    # that is left without a category empties the count — 03 §5.37's field table
    # names only "rows without a category", and this is where the two are read
    # together. The 淘宝 row (rows[4]) is the uncategorized one.
    client.patch(
        f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows/{rows[4]['id']}",
        headers=headers,
        json={"status": "skipped"},
    )

    body = client.get(f"/api/v1/ledgers/{ledger.id}/imports/{bid}", headers=headers).json()
    assert body["row_status_summary"] == {"pending": 3, "edited": 1, "skipped": 2}
    assert body["uncategorized_count"] == 0
    assert body["net_amount"] == "186.0000"  # the skipped -238 row drops out too


def test_batch_of_another_ledger_is_404(ledger_setup, client, ledger_factory, source_factory):
    user, headers, ledger, source = ledger_setup
    bid = upload(client, headers, ledger, source, "ok_bom.csv").json()["batch"]["id"]
    other = ledger_factory(user, name="别的账本")

    for url in (
        f"/api/v1/ledgers/{other.id}/imports/{bid}",
        f"/api/v1/ledgers/{other.id}/imports/{bid}/rows",
    ):
        assert client.get(url, headers=headers).status_code == 404
    assert (
        client.post(f"/api/v1/ledgers/{other.id}/imports/{bid}/commit", headers=headers).status_code
        == 404
    )
    assert (
        client.delete(f"/api/v1/ledgers/{other.id}/imports/{bid}", headers=headers).status_code
        == 404
    )


# ---------------------------------------------------------------------------
# §5.43 commit
# ---------------------------------------------------------------------------


def categorize(client, headers, ledger, bid, rows):
    """Fill the two rows ok_credit_cny.csv leaves without a category."""
    for row in rows:
        if row["kind"] != "transfer" and row["category_l1"] is None:
            response = client.patch(
                f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows/{row['id']}",
                headers=headers,
                json={"category_l1": "shopping", "category_l2": "electronics"},
            )
            assert response.status_code == 200, response.text


def test_commit_refuses_a_batch_with_uncategorized_rows(ledger_setup, client, db):
    _user, headers, ledger, source = ledger_setup
    bid = upload(client, headers, ledger, source).json()["batch"]["id"]

    response = client.post(f"/api/v1/ledgers/{ledger.id}/imports/{bid}/commit", headers=headers)

    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "rows_uncategorized"
    assert body["rows"] == [4, 5]
    assert db.query(Transaction).count() == 0
    detail = client.get(f"/api/v1/ledgers/{ledger.id}/imports/{bid}", headers=headers).json()
    assert detail["status"] == "ready"


def test_commit_books_every_row_and_is_idempotent(ledger_setup, client, db):
    _user, headers, ledger, source = ledger_setup
    created = upload(client, headers, ledger, source).json()
    bid = created["batch"]["id"]
    categorize(client, headers, ledger, bid, created["rows"])

    response = client.post(
        f"/api/v1/ledgers/{ledger.id}/imports/{bid}/commit",
        headers={**headers, "X-Client": "web"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["batch_id"] == bid
    assert body["status"] == "committed"
    assert body["created_transactions"] == 6
    assert body["created_transfer_pairs"] == 0
    assert body["paired_existing_transfers"] == 0
    assert body["linked_refunds"] == 0
    assert body["skipped_rows"] == 0
    assert body["committed_at"] is not None

    booked = db.query(Transaction).filter(Transaction.import_batch_id == uuid.UUID(bid)).all()
    assert len(booked) == 6
    assert sum(tx.amount for tx in booked) == Decimal("2820.0000")

    rows = client.get(f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows", headers=headers).json()
    assert all(row["transaction_id"] is not None for row in rows["items"])

    again = client.post(f"/api/v1/ledgers/{ledger.id}/imports/{bid}/commit", headers=headers)
    assert again.status_code == 409
    assert again.json()["code"] == "batch_already_committed"
    assert db.query(Transaction).count() == 6


def test_commit_refuses_a_batch_whose_rows_are_all_skipped(ledger_setup, client):
    _user, headers, ledger, source = ledger_setup
    created = upload(client, headers, ledger, source, "ok_bom.csv").json()
    bid = created["batch"]["id"]
    client.patch(
        f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows",
        headers=headers,
        json={"row_ids": [row["id"] for row in created["rows"]], "patch": {"status": "skipped"}},
    )

    response = client.post(f"/api/v1/ledgers/{ledger.id}/imports/{bid}/commit", headers=headers)

    assert response.status_code == 409
    assert response.json()["code"] == "rows_all_skipped"


def test_commit_refuses_an_archived_target_account(ledger_setup, client, db):
    _user, headers, ledger, source = ledger_setup
    created = upload(client, headers, ledger, source).json()
    bid = created["batch"]["id"]
    categorize(client, headers, ledger, bid, created["rows"])
    source.archived = True
    source.archived_at = source.updated_at
    db.commit()

    response = client.post(f"/api/v1/ledgers/{ledger.id}/imports/{bid}/commit", headers=headers)

    assert response.status_code == 409
    assert response.json()["code"] == "source_archived"


# ---------------------------------------------------------------------------
# §5.44 discard / revert
# ---------------------------------------------------------------------------


def test_discarding_a_ready_batch_removes_the_drafts(ledger_setup, client, db):
    _user, headers, ledger, source = ledger_setup
    bid = upload(client, headers, ledger, source).json()["batch"]["id"]

    dry = client.delete(
        f"/api/v1/ledgers/{ledger.id}/imports/{bid}?dry_run=true", headers=headers
    ).json()
    assert dry["mode"] == "discard"
    assert dry["would_delete_transactions"] == 0
    assert "deleted_transactions" not in dry
    assert dry["deleted"] is False

    response = client.delete(f"/api/v1/ledgers/{ledger.id}/imports/{bid}", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "discard"
    assert body["deleted_transactions"] == 0
    assert "would_delete_transactions" not in body
    assert body["deleted"] is True
    assert db.query(ImportBatch).count() == 0
    assert db.query(ImportRow).count() == 0
    assert (
        client.get(f"/api/v1/ledgers/{ledger.id}/imports/{bid}", headers=headers).status_code == 404
    )


def test_reverting_a_committed_batch_deletes_its_transactions(ledger_setup, client, db):
    _user, headers, ledger, source = ledger_setup
    created = upload(client, headers, ledger, source).json()
    bid = created["batch"]["id"]
    categorize(client, headers, ledger, bid, created["rows"])
    client.post(f"/api/v1/ledgers/{ledger.id}/imports/{bid}/commit", headers=headers)

    dry = client.delete(
        f"/api/v1/ledgers/{ledger.id}/imports/{bid}?dry_run=1", headers=headers
    ).json()
    assert dry["mode"] == "revert"
    assert dry["would_delete_transactions"] == 6
    assert dry["orphaned_refunds"] == 0
    assert dry["refunds_in_batch"] == 0
    assert dry["deleted"] is False
    assert db.query(Transaction).count() == 6  # a dry run writes nothing

    response = client.delete(f"/api/v1/ledgers/{ledger.id}/imports/{bid}", headers=headers)

    assert response.status_code == 200
    assert response.json()["deleted_transactions"] == 6
    assert db.query(Transaction).count() == 0
    assert db.query(ImportBatch).count() == 0
    # Deleting twice is a 404, not a second revert.
    assert (
        client.delete(f"/api/v1/ledgers/{ledger.id}/imports/{bid}", headers=headers).status_code
        == 404
    )


def test_a_member_may_revert_someone_elses_import(
    ledger_setup, client, db, user_factory, auth_headers
):
    """Decision §14.52 B9: reverting is not owner-only."""
    _user, headers, ledger, source = ledger_setup
    created = upload(client, headers, ledger, source).json()
    bid = created["batch"]["id"]
    categorize(client, headers, ledger, bid, created["rows"])
    client.post(f"/api/v1/ledgers/{ledger.id}/imports/{bid}/commit", headers=headers)

    from app.models.ledger import LedgerMember

    mate = user_factory()
    db.add(
        LedgerMember(
            ledger_id=ledger.id, user_id=mate.id, role="member", joined_at=source.created_at
        )
    )
    db.commit()

    response = client.delete(
        f"/api/v1/ledgers/{ledger.id}/imports/{bid}", headers=auth_headers(mate)
    )

    assert response.status_code == 200
    assert response.json()["deleted_transactions"] == 6
