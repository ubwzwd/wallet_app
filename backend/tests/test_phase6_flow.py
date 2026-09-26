"""End-to-end import flow: upload, flag, review, commit, revert (05 §7.4).

Every step goes through the real HTTP routes of 03 §5.37-§5.44 with the real
fixture files of 05 §7.1, and the assertions are on **side effects** — the
transactions a commit created, the ``transfer_pair_id`` it tied, the
``counterparty`` it cleared, the ``refund_of`` it linked, the events of §4.6 and
the account balances a revert has to put back — not on status codes alone.

Only the three rows a batch cannot find for itself are seeded by hand: the
already-booked expense a refund row has to match, the expense that makes one row
a duplicate, and the single-leg transfer the repayment row pairs with. §3 looks
for candidates among **committed** transactions only (decision §14.7), so drafts
of the same batch could never play those parts.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

FIXTURES = Path(__file__).parent / "fixtures" / "import"


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def by_row_no(rows: list[dict[str, Any]], row_no: int) -> dict[str, Any]:
    return next(row for row in rows if row["row_no"] == row_no)


class Flow:
    """The one ledger this file's stories happen in, plus request shorthands."""

    def __init__(self, client, headers: dict[str, str], ledger) -> None:
        self.client = client
        self.headers = headers
        self.ledger = ledger
        self.base = f"/api/v1/ledgers/{ledger.id}"

    # -- requests ----------------------------------------------------------
    def upload(self, source, name: str) -> Any:
        return self.client.post(
            f"{self.base}/imports",
            headers=self.headers,
            files={"file": (name, fixture_bytes(name), "text/csv")},
            data={"source_id": str(source.id)},
        )

    def paste(self, source, text: str) -> Any:
        return self.client.post(
            f"{self.base}/imports",
            headers=self.headers,
            json={"source_id": str(source.id), "text": text},
        )

    def patch_row(self, bid: str, rid: str, body: dict[str, Any]) -> dict[str, Any]:
        response = self.client.patch(
            f"{self.base}/imports/{bid}/rows/{rid}", json=body, headers=self.headers
        )
        assert response.status_code == 200, response.text
        return response.json()

    def commit(self, bid: str, expect: int = 200) -> dict[str, Any]:
        response = self.client.post(f"{self.base}/imports/{bid}/commit", headers=self.headers)
        assert response.status_code == expect, response.text
        return response.json()

    def revert(self, bid: str, *, dry_run: bool = False) -> dict[str, Any]:
        response = self.client.delete(
            f"{self.base}/imports/{bid}",
            params={"dry_run": "true"} if dry_run else None,
            headers=self.headers,
        )
        assert response.status_code == 200, response.text
        return response.json()

    # -- reads -------------------------------------------------------------
    def transaction(self, tid) -> dict[str, Any]:
        response = self.client.get(f"{self.base}/transactions/{tid}", headers=self.headers)
        assert response.status_code == 200, response.text
        return response.json()

    def batch_transactions(self, bid: str) -> list[dict[str, Any]]:
        response = self.client.get(
            f"{self.base}/transactions",
            params={"import_batch_id": bid, "limit": 100},
            headers=self.headers,
        )
        assert response.status_code == 200, response.text
        return response.json()["items"]

    def balance(self, source) -> str:
        response = self.client.get(f"/api/v1/sources/{source.id}", headers=self.headers)
        assert response.status_code == 200, response.text
        return response.json()["balance"]

    def event_names(self, tid) -> list[str]:
        return [event["event"] for event in self.transaction(tid)["events"]]


@pytest.fixture()
def flow(db, user_factory, auth_headers, ledger_factory, client) -> Flow:
    user = user_factory(base_currency="CNY")
    ledger = ledger_factory(user, base_currency="CNY")
    db.flush()
    headers = {**auth_headers(user), "X-Client": "web"}
    return Flow(client, headers, ledger)


# ---------------------------------------------------------------------------
# 05 §7.4: the whole story on a credit-card statement
# ---------------------------------------------------------------------------


def test_upload_flag_review_commit_and_revert_a_credit_card_statement(
    db, flow, source_factory, transaction_factory
):
    credit = source_factory(flow.ledger, name="招行信用卡", type="credit", currency="CNY")
    checking = source_factory(flow.ledger, name="招行储蓄卡", type="checking", currency="CNY")

    # Already booked on the card: the 盒马 expense the statement repeats (§3.1) and
    # the 京东 purchase the statement's refund row gives money back for (§3.2).
    duplicate_of = transaction_factory(
        flow.ledger, credit, amount=Decimal("-128.0000"),
        occurred_at=dt.date(2026, 8, 3), merchant="盒马鲜生",
        category_l1="groceries", category_l2="fresh_food",
    )
    original = transaction_factory(
        flow.ledger, credit, amount=Decimal("-1299.0000"),
        occurred_at=dt.date(2026, 8, 7), merchant="京东",
        category_l1="shopping", category_l2="electronics",
    )
    # Last month's checking-account statement left this repayment as a single leg;
    # its subtype differs from the card's on purpose (decision §14.53a).
    leg = transaction_factory(
        flow.ledger, checking, kind="transfer", amount=Decimal("-3000.0000"),
        occurred_at=dt.date(2026, 8, 20), transfer_role="out", transfer_subtype="plain",
        counterparty="招行信用卡",
    )
    db.flush()

    credit_before, checking_before = flow.balance(credit), flow.balance(checking)
    assert (credit_before, checking_before) == ("-1427.0000", "-3000.0000")

    # -- 1. upload: one synchronous 201 carrying the batch and every draft row ---
    response = flow.upload(credit, "ok_credit_cny.csv")
    assert response.status_code == 201, response.text
    body = response.json()
    batch, rows = body["batch"], body["rows"]
    bid = batch["id"]
    assert batch["status"] == "ready"
    assert batch["source"] == "csv" and batch["filename"] == "ok_credit_cny.csv"
    assert batch["row_count"] == 6 == len(rows)
    assert "progress" not in batch

    # -- 2. the flags (§3), each on the row it belongs to ------------------------
    dup_row = by_row_no(rows, 1)
    assert dup_row["flags"] == ["duplicate"]
    assert dup_row["matched_transaction_id"] == str(duplicate_of.id)

    refund_row = by_row_no(rows, 4)
    assert "refund_candidate" in refund_row["flags"]
    assert refund_row["matched_transaction_id"] == str(original.id)
    # The file leaves both category columns blank; the pre-fill inherits the
    # original expense's (decision §1.1).
    assert (refund_row["category_l1"], refund_row["category_l2"]) == (
        "shopping", "electronics",
    )

    transfer_row = by_row_no(rows, 6)
    assert "transfer_candidate" in transfer_row["flags"]
    assert transfer_row["matched_transaction_id"] == str(leg.id)
    assert transfer_row["counterpart_source_id"] == str(checking.id)
    assert transfer_row["transfer_subtype"] == "repayment"

    # 淘宝 arrives without a category — a filter, not a flag (§3.4).
    taobao_row = by_row_no(rows, 5)
    assert taobao_row["flags"] == [] and taobao_row["category_l1"] is None
    assert batch["uncategorized_count"] == 1

    # Three of §3's four flags hit exactly once. ``needs_review`` cannot join them
    # *here*: §3.4 raises it either when validation had to correct a field — this
    # file is clean — or when a refund / transfer candidate is ambiguous, which is
    # the opposite of the two pre-fills asserted above. The next case covers it.
    assert batch["flags_summary"] == {
        "duplicate": 1, "refund_candidate": 1, "transfer_candidate": 1, "needs_review": 0,
    }

    # -- 3. an uncategorized row stops the commit (03 §5.43, 3) -----------------
    refused = flow.commit(bid, expect=409)
    assert refused["code"] == "rows_uncategorized"
    assert refused["rows"] == [5]
    assert flow.batch_transactions(bid) == []

    # -- 4. review: fill the blank category in, skip the duplicate --------------
    patched = flow.patch_row(
        bid, taobao_row["id"], {"category_l1": "shopping", "category_l2": "other_goods"}
    )
    assert (patched["category_l1"], patched["status"]) == ("shopping", "edited")
    assert flow.patch_row(bid, dup_row["id"], {"status": "skipped"})["status"] == "skipped"

    # -- 5. commit ---------------------------------------------------------------
    result = flow.commit(bid)
    assert result["status"] == "committed"
    assert result["created_transactions"] == 5   # six rows, one skipped
    assert result["skipped_rows"] == 1
    assert result["paired_existing_transfers"] == 1
    assert result["created_transfer_pairs"] == 0  # no counterpart account was chosen
    assert result["linked_refunds"] == 1

    created = flow.batch_transactions(bid)
    assert len(created) == 5
    assert {tx["import_batch_id"] for tx in created} == {bid}
    # §4.6: every imported transaction carries exactly one `imported` event.
    for tx in created:
        detail = flow.transaction(tx["id"])
        assert [event["event"] for event in detail["events"]] == ["imported"]
        assert detail["events"][0]["import_batch_id"] == bid
        assert detail["events"][0]["client"] == "web"
    # -45 -68 +299 -238 +3000 = 2948 (the skipped -128 row booked nothing).
    assert Decimal(flow.balance(credit)) == Decimal(credit_before) + Decimal("2948.0000")

    # The refund row became a refund pointing at the 京东 purchase (§4.4).
    refund_tx = next(tx for tx in created if tx["kind"] == "refund")
    assert refund_tx["refund_of"] == str(original.id)
    assert flow.transaction(original.id)["refunded_total"] == "299.0000"

    # The repayment row paired with the leg that was already in the ledger (§4.5 ①):
    # one pair id on both, the counterparty text gone, the subtype unified.
    near = next(tx for tx in created if tx["kind"] == "transfer")
    paired_leg = flow.transaction(leg.id)
    assert near["transfer_pair_id"] is not None
    assert paired_leg["transfer_pair_id"] == near["transfer_pair_id"]
    assert paired_leg["counterparty"] is None and near["counterparty"] is None
    assert paired_leg["transfer_subtype"] == near["transfer_subtype"] == "repayment"
    # Each leg keeps its own date (decision §14.53a).
    assert paired_leg["occurred_at"] == "2026-08-20"
    leg_events = {event["event"] for event in paired_leg["events"]}
    assert {"paired", "updated"} <= leg_events
    # The pairing itself dropped the counterparty text (decision §14.34) …
    tied = next(e for e in paired_leg["events"] if e["event"] == "paired")["changes"]
    assert tied["counterparty"] == {"before": "招行信用卡", "after": None}
    assert tied["transfer_pair_id"]["after"] == near["transfer_pair_id"]
    # … and rewriting the subtype is an edit of its own (§4.6).
    changed = next(e for e in paired_leg["events"] if e["event"] == "updated")["changes"]
    assert changed["transfer_subtype"] == {"before": "plain", "after": "repayment"}
    # The pairing moved no money: the checking account is where it was.
    assert flow.balance(checking) == checking_before

    # -- 6. undo: the dry run counts first (03 §5.44, decision §14.52 B24) -------
    dry = flow.revert(bid, dry_run=True)
    assert dry["mode"] == "revert" and dry["deleted"] is False
    assert dry["would_delete_transactions"] == 5
    assert "deleted_transactions" not in dry
    assert dry["orphaned_refunds"] == 0   # nothing outside the batch refunds it
    assert dry["refunds_in_batch"] == 1   # the 京东 refund gives its room back
    assert len(flow.batch_transactions(bid)) == 5  # a dry run changes nothing

    deleted = flow.revert(bid)
    assert deleted["deleted"] is True and deleted["deleted_transactions"] == 5
    assert "would_delete_transactions" not in deleted

    # -- 7. after the undo: batch gone, transactions gone, the survivor untied ---
    assert (
        flow.client.get(f"{flow.base}/imports/{bid}", headers=flow.headers).status_code == 404
    )
    for tx in created:
        gone = flow.client.get(f"{flow.base}/transactions/{tx['id']}", headers=flow.headers)
        assert gone.status_code == 404
    survivor = flow.transaction(leg.id)
    assert survivor["transfer_pair_id"] is None
    assert "unpaired" in flow.event_names(leg.id)
    assert flow.transaction(original.id)["refunded_total"] == "0.0000"
    # Both balances are back where they started (§4.8).
    assert flow.balance(credit) == credit_before
    assert flow.balance(checking) == checking_before


# ---------------------------------------------------------------------------
# The second half of review: an ambiguous pairing, and one the user unticks
# ---------------------------------------------------------------------------


def test_review_can_clear_a_prefilled_pairing_before_committing(
    db, flow, source_factory, transaction_factory
):
    """The checking-account statement of §7.1, against a ledger that already
    holds the other side of two of its three transfers.

    Row 6 (-560) has two possible counterpart legs, so the server pre-fills
    nothing and flags ``needs_review`` (decision §14.53b); row 7 (-500) has
    exactly one, so it arrives ticked — and this case unticks it, which is what
    the checkbox of 04 §4.11 sends. Row 8 (-800) has none at all.
    """
    account = source_factory(flow.ledger, name="星展储蓄", type="checking", currency="SGD")
    partner = source_factory(flow.ledger, name="老婆的账户", type="checking", currency="SGD")
    spare = source_factory(flow.ledger, name="备用账户", type="checking", currency="SGD")

    # Two legs fit row 6 (-560.00 SGD on 2026-08-20, ±3 days) …
    for source, day in ((partner, dt.date(2026, 8, 20)), (spare, dt.date(2026, 8, 21))):
        transaction_factory(
            flow.ledger, source, kind="transfer", amount=Decimal("560.0000"),
            currency="SGD", occurred_at=day, transfer_role="in", transfer_subtype="plain",
        )
    # … exactly one fits row 7 (-500.00 SGD on 2026-08-22).
    single = transaction_factory(
        flow.ledger, partner, kind="transfer", amount=Decimal("500.0000"),
        currency="SGD", occurred_at=dt.date(2026, 8, 22), transfer_role="in",
        transfer_subtype="plain", counterparty="星展储蓄",
    )
    db.flush()

    response = flow.upload(account, "ok_checking_sgd.csv")
    assert response.status_code == 201, response.text
    batch, rows = response.json()["batch"], response.json()["rows"]
    bid = batch["id"]
    assert batch["row_count"] == 8
    assert batch["flags_summary"] == {
        "duplicate": 0, "refund_candidate": 0, "transfer_candidate": 2, "needs_review": 1,
    }

    ambiguous = by_row_no(rows, 6)
    assert set(ambiguous["flags"]) == {"transfer_candidate", "needs_review"}
    assert ambiguous["matched_transaction_id"] is None
    assert ambiguous["counterpart_source_id"] is None

    ticked = by_row_no(rows, 7)
    assert ticked["flags"] == ["transfer_candidate"]
    assert ticked["matched_transaction_id"] == str(single.id)
    assert ticked["counterpart_source_id"] == str(partner.id)

    lonely = by_row_no(rows, 8)
    assert lonely["flags"] == [] and lonely["matched_transaction_id"] is None

    # Untick row 7 and give the lonely leg the counterparty text it deserves.
    cleared = flow.patch_row(
        bid, ticked["id"], {"matched_transaction_id": None, "counterpart_source_id": None}
    )
    assert cleared["matched_transaction_id"] is None
    assert cleared["counterpart_source_id"] is None
    flow.patch_row(bid, lonely["id"], {"counterparty": "老婆"})

    result = flow.commit(bid)
    assert result["created_transactions"] == 8
    assert result["paired_existing_transfers"] == 0  # the only tick was cleared
    assert result["created_transfer_pairs"] == 0

    created = flow.batch_transactions(bid)
    legs = {tx["amount"]: tx for tx in created if tx["kind"] == "transfer"}
    assert legs["-500.0000"]["transfer_pair_id"] is None
    assert legs["-800.0000"]["counterparty"] == "老婆"
    # The leg the user unticked was left completely alone (§4.5 ③).
    untouched = flow.transaction(single.id)
    assert untouched["transfer_pair_id"] is None
    assert untouched["counterparty"] == "星展储蓄"
    assert flow.event_names(single.id) == []


# ---------------------------------------------------------------------------
# The paste entry point runs the same pipeline (decision §5)
# ---------------------------------------------------------------------------


def test_pasted_text_walks_the_same_upload_review_commit_path(flow, source_factory):
    card = source_factory(flow.ledger, name="支付宝绑卡", type="credit", currency="CNY")
    text = fixture_bytes("ok_paste_alipay.txt").decode("utf-8")

    response = flow.paste(card, text)
    assert response.status_code == 201, response.text
    batch, rows = response.json()["batch"], response.json()["rows"]
    bid = batch["id"]
    assert batch["source"] == "paste"
    assert batch["filename"] is None
    assert batch["size_bytes"] == len(text.encode("utf-8"))
    assert batch["row_count"] == 6 == len(rows)

    # The Shopee purchase this text also contains is a *draft*, so the refund row
    # of the same batch finds no original to link to (decision §14.7).
    refund_row = by_row_no(rows, 5)
    assert refund_row["kind"] == "refund" and refund_row["flags"] == []
    assert refund_row["matched_transaction_id"] is None

    for row_no in (4, 5):  # both Shopee rows arrive without a category
        row = by_row_no(rows, row_no)
        assert row["category_l1"] is None
        flow.patch_row(bid, row["id"], {"category_l1": "shopping", "category_l2": "other_goods"})

    result = flow.commit(bid)
    assert result["created_transactions"] == 6 and result["linked_refunds"] == 0

    created = flow.batch_transactions(bid)
    assert len(created) == 6
    assert {tx["import_batch_id"] for tx in created} == {bid}
    assert all(flow.event_names(tx["id"]) == ["imported"] for tx in created)
