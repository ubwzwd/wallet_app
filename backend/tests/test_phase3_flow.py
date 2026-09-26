"""End-to-end account/transaction flow, plus the phase-three OpenAPI inventory.

Mirrors ``test_phase2_flow.py``: every step goes through the real HTTP client
(no ``source_factory`` / ``transaction_factory`` shortcuts), so this reads as
the story a real user lives through across 03-backend-api.md §5.20-§5.36
rather than a check of any single endpoint in isolation.

Accounts belong to the person since decision §14.62: they are created and read
through the personal ``/sources*`` routes, booked on in the ledger without any
share (the owner may use their own accounts everywhere), and the ledger's
``counts.sources`` only counts the one the owner chose to share into it.

The ledger's base currency is CNY. The fake Frankfurter of ``conftest.py``
quotes 1 USD = 7.2 CNY and 1 USD = 1.35 SGD, so 1 SGD = 7.2/1.35 CNY, which
quantizes to a rate of ``5.33333333`` (8 dp) — every SGD amount in this file
is hand-converted with that one number, spelled out inline at each use so a
reviewer can check the arithmetic without re-deriving it.
"""
from __future__ import annotations

from typing import Any

# 1 SGD = 7.2 / 1.35 CNY, quantized to 8 dp (§4.5) — see the module docstring.
SGD_CNY_RATE = "5.33333333"


def _register(client, email: str, password: str = "correct horse battery") -> dict[str, str]:
    """Register a brand new account and return its bearer ``Authorization`` header."""
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "base_currency": "CNY"},
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _default_ledger_id(client, headers: dict[str, str]) -> str:
    """The one ledger a freshly registered user already owns (§5.1, §5.8)."""
    response = client.get("/api/v1/ledgers", headers=headers)
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["role"] == "owner"
    return items[0]["id"]


def test_accounts_and_transactions_end_to_end(client):
    headers = _register(client, "flow@example.com")
    headers["X-Client"] = "web"
    ledger_id = _default_ledger_id(client, headers)

    def url(suffix: str = "") -> str:
        return f"/api/v1/ledgers/{ledger_id}{suffix}"

    def mine(suffix: str = "") -> str:
        """The personal account routes (§5.20-§5.24b), outside any ledger."""
        return f"/api/v1/sources{suffix}"

    def post_mine(body: dict[str, Any]) -> Any:
        response = client.post(mine(), json=body, headers=headers)
        assert response.status_code == 201, response.text
        return response.json()

    def get_mine(suffix: str = "", **params) -> Any:
        response = client.get(mine(suffix), headers=headers, params=params)
        assert response.status_code == 200, response.text
        return response.json()

    def post(path: str, body: dict[str, Any], expect: int = 201) -> Any:
        """POST one step of the story; ``expect`` is spelled out at each call.

        Creating a resource answers 201 (§5.21, §5.26, §5.30) and an action on
        an existing one answers 200 (§5.33, §5.34) — accepting either would let
        a regression swap them unnoticed.
        """
        response = client.post(url(path), json=body, headers=headers)
        assert response.status_code == expect, response.text
        return response.json()

    def patch(path: str, body: dict[str, Any]) -> Any:
        response = client.patch(url(path), json=body, headers=headers)
        assert response.status_code == 200, response.text
        return response.json()

    def get(path: str, **params) -> Any:
        response = client.get(url(path), headers=headers, params=params)
        assert response.status_code == 200, response.text
        return response.json()

    def delete(path: str) -> None:
        response = client.delete(url(path), headers=headers)
        assert response.status_code == 204, response.text
        assert response.content == b""

    # -----------------------------------------------------------------
    # Three personal accounts (§5.21): a CNY checking account shared into
    # the ledger, a CNY credit card opening -2300 (a debt, decision §14.52
    # A13) and an SGD account — the last two shared nowhere, which does not
    # stop their owner booking on them (decision §14.62 b).
    # -----------------------------------------------------------------
    bank = post_mine(
        {"name": "招行储蓄卡", "type": "checking", "default_currency": "CNY",
         "opening_balance": "0", "share_to": [ledger_id]},
    )
    card = post_mine(
        {"name": "招行信用卡", "type": "credit", "default_currency": "CNY",
         "opening_balance": "-2300.00"},
    )
    sgd = post_mine(
        {"name": "新加坡账户", "type": "checking", "default_currency": "SGD",
         "opening_balance": "0"},
    )
    assert card["balance"] == "-2300.0000"
    assert card["opening_balance"] == "-2300.0000"
    assert (bank["shared_to"], card["shared_to"]) == ([ledger_id], [])

    # The ledger sees all three as the caller's own, usable accounts
    # (§5.24c), and counts only the one shared into it (§5.10).
    in_ledger = get("/sources")
    assert {row["id"] for row in in_ledger["items"]} == {bank["id"], card["id"], sgd["id"]}
    assert all(row["mine"] and row["usable"] for row in in_ledger["items"])
    assert get("")["counts"]["sources"] == 1

    # -----------------------------------------------------------------
    # Booking: an expense, a foreign-currency (SGD) expense, an income, and
    # a refund linked back to the first expense (§5.26).
    # -----------------------------------------------------------------
    e1 = post(
        "/transactions",
        {"source_id": bank["id"], "kind": "expense", "amount": "-100.00", "currency": "CNY",
         "occurred_at": "2026-09-01", "category_l1": "food", "category_l2": "lunch",
         "merchant": "老王饭馆", "note": "午饭"},
    )
    assert e1["amount"] == "-100.0000"
    assert e1["amount_base"] == "-100.0000"     # same currency as the ledger, rate 1
    assert e1["refunded_total"] == "0.0000"
    assert e1["refundable"] == "100.0000"

    e2_sgd = post(
        "/transactions",
        {"source_id": sgd["id"], "kind": "expense", "amount": "-20.00", "currency": "SGD",
         "occurred_at": "2026-09-02", "category_l1": "food", "category_l2": "dinner",
         "merchant": "Newton Food Centre", "note": "晚饭"},
    )
    # -20 SGD * 5.33333333 = -106.6666 6 -> rounds up to -106.6667 (ROUND_HALF_UP, §4.5)
    assert e2_sgd["rate_used"] == SGD_CNY_RATE
    assert e2_sgd["amount_base"] == "-106.6667"
    assert e2_sgd["rate_date"] == "2026-09-02"   # valued on its own occurred_at (§6.4)

    income = post(
        "/transactions",
        {"source_id": bank["id"], "kind": "income", "amount": "5000.00", "currency": "CNY",
         "occurred_at": "2026-09-03", "category_l1": "salary", "category_l2": "base_salary",
         "note": "九月工资"},
    )
    assert income["amount"] == "5000.0000"

    # No category given: it must be copied from e1 (decision §1.1).
    refund = post(
        "/transactions",
        {"source_id": bank["id"], "kind": "refund", "amount": "30.00", "currency": "CNY",
         "occurred_at": "2026-09-04", "merchant": "老王饭馆", "note": "退了一部分",
         "refund_of": e1["id"]},
    )
    assert refund["category_l1"] == "food"
    assert refund["category_l2"] == "lunch"

    e1_after_refund = get(f"/transactions/{e1['id']}")
    assert e1_after_refund["refunded_total"] == "30.0000"
    assert e1_after_refund["refundable"] == "70.0000"     # 100 - 30
    assert [row["id"] for row in e1_after_refund["refunds"]] == [refund["id"]]
    refund_detail = get(f"/transactions/{refund['id']}")
    assert refund_detail["refund_of_detail"]["id"] == e1["id"]
    assert refund_detail["refund_of_detail"]["refunded_total"] == "30.0000"
    assert refund_detail["refund_of_detail"]["refundable"] == "70.0000"
    assert refund_detail["refund_of_detail"]["other_refunds"] == []

    # -----------------------------------------------------------------
    # A two-leg transfer: paying the credit card down from the checking
    # account (§5.30). Same currency both sides, so amount_in defaults.
    # -----------------------------------------------------------------
    repayment = post(
        "/transactions/transfer",
        {"from_source_id": bank["id"], "to_source_id": card["id"], "amount_out": "200.00",
         "occurred_at": "2026-09-05", "subtype": "repayment", "note": "还信用卡"},
    )
    assert repayment["out"]["amount"] == "-200.0000"
    assert repayment["in"]["amount"] == "200.0000"
    pair_id_1 = repayment["pair_id"]

    # A single-leg transfer in: money arrived from someone not in the app
    # (§1.2/§5.26) — counterparty recorded, no category.
    single_in = post(
        "/transactions",
        {"source_id": bank["id"], "kind": "transfer", "amount": "500.00", "currency": "CNY",
         "occurred_at": "2026-09-06", "transfer_role": "in", "transfer_subtype": "plain",
         "counterparty": "老婆", "note": "生活费"},
    )
    assert single_in["counterparty"] == "老婆"
    assert single_in["transfer_pair_id"] is None

    # -----------------------------------------------------------------
    # List filters (§5.25). 7 rows exist at this point: e1, e2_sgd, income,
    # refund, the two repayment legs, and the single incoming leg.
    # -----------------------------------------------------------------
    by_account = get("/transactions", source_id=bank["id"])
    assert by_account["total"] == 5    # e1, income, refund, repayment-out, single-in
    assert {row["id"] for row in by_account["items"]} == {
        e1["id"], income["id"], refund["id"], repayment["out"]["id"], single_in["id"],
    }

    by_kind = get("/transactions", kind="expense")
    assert by_kind["total"] == 2
    assert {row["id"] for row in by_kind["items"]} == {e1["id"], e2_sgd["id"]}

    # Base-currency amount range (decision §14.49): only the two repayment
    # legs have |amount_base| in [150, 300] — both are exactly 200.
    by_amount = get("/transactions", min_amount="150", max_amount="300")
    assert by_amount["total"] == 2
    assert {row["id"] for row in by_amount["items"]} == {
        repayment["out"]["id"], repayment["in"]["id"],
    }

    whole_list = get("/transactions")
    assert whole_list["total"] == 7
    summary = whole_list["summary"]
    # expense = |-100| + |-106.6667| (transfers excluded, decision §14.52 A14)
    assert summary["expense"] == "206.6667"
    assert summary["income"] == "5000.0000"
    assert summary["net"] == "4823.3333"    # income - expense + refund
    assert summary["count"] == 7
    assert summary["rate_missing_count"] == 0

    # -----------------------------------------------------------------
    # Account balances and the owner's three personal totals (§5.20).
    #   bank = 0 - 100 + 5000 + 30 - 200 + 500 = 5230.0000
    #   card = -2300 + 200                     = -2100.0000
    #   sgd  = 0 - 20                           = -20.0000 SGD -> -106.6667 CNY
    #   assets      = 5230.0000 + (-106.6667)   = 5123.3333
    #   liabilities = -2100.0000
    #   net_worth   = 5123.3333 + (-2100.0000)  = 3023.3333
    # -----------------------------------------------------------------
    sources = get_mine()
    assert sources["total"] == 3
    by_id = {row["id"]: row for row in sources["items"]}
    assert by_id[bank["id"]]["balance"] == "5230.0000"
    assert by_id[bank["id"]]["balance_base"] == "5230.0000"
    assert by_id[card["id"]]["balance"] == "-2100.0000"
    assert by_id[card["id"]]["balance_base"] == "-2100.0000"
    assert by_id[sgd["id"]]["balance"] == "-20.0000"
    assert by_id[sgd["id"]]["balance_base"] == "-106.6667"
    assert by_id[sgd["id"]]["balance_rate"] == SGD_CNY_RATE
    assert sources["base_currency"] == "CNY"
    assert sources["assets"] == "5123.3333"
    assert sources["liabilities"] == "-2100.0000"
    assert sources["net_worth"] == "3023.3333"

    # -----------------------------------------------------------------
    # stats/summary for 2026-09 (§5.35). Transfers never count. The
    # September refund deducts from food's own bucket (decision §1.1):
    #   food: lunch 100 - 30 = 70 (count 2), dinner 106.6667 (count 1)
    #   food.amount = 70 + 106.6667 = 176.6667; expense_total = 176.6667
    #   income_total = 5000.0000; net = 5000 - 176.6667 = 4823.3333
    #   refund_total = 30.0000 (separate from expense_total's netting)
    # -----------------------------------------------------------------
    stats_summary = get("/stats/summary", month="2026-09")
    assert stats_summary["month"] == "2026-09"
    assert stats_summary["expense_total"] == "176.6667"
    assert stats_summary["income_total"] == "5000.0000"
    assert stats_summary["net"] == "4823.3333"
    assert stats_summary["refund_total"] == "30.0000"
    assert stats_summary["rate_missing_count"] == 0
    assert [row["code"] for row in stats_summary["expense"]] == ["food"]
    food = stats_summary["expense"][0]
    assert food["amount"] == "176.6667"
    assert food["share"] == 1.0
    assert food["count"] == 3
    children_by_code = {child["code"]: child for child in food["children"]}
    assert children_by_code["lunch"]["amount"] == "70.0000"
    assert children_by_code["lunch"]["count"] == 2       # e1 + the refund
    assert children_by_code["dinner"]["amount"] == "106.6667"
    assert children_by_code["dinner"]["count"] == 1
    assert [row["code"] for row in stats_summary["income"]] == ["salary"]
    assert stats_summary["income"][0]["amount"] == "5000.0000"

    trend = get("/stats/trend", months=12, end="2026-09")
    assert trend["base_currency"] == "CNY"
    assert [row["month"] for row in trend["months"]] == [
        "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
        "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
    ]
    by_month = {row["month"]: row["expense"] for row in trend["months"]}
    assert by_month["2026-09"] == "176.6667"    # matches summary's expense_total
    for month, expense in by_month.items():
        if month != "2026-09":
            assert expense == "0.0000"
    assert trend["rate_missing_count"] == 0

    # -----------------------------------------------------------------
    # Pairing (§5.33): a second, opposite single leg on a third account,
    # tied to the earlier single-leg-in.
    # -----------------------------------------------------------------
    single_out = post(
        "/transactions",
        {"source_id": sgd["id"], "kind": "transfer", "amount": "-50.00", "currency": "SGD",
         "occurred_at": "2026-09-07", "transfer_role": "out", "transfer_subtype": "plain"},
    )

    paired = post(
        f"/transactions/{single_in['id']}/pair",
        {"other_transaction_id": single_out["id"]},
        expect=200,
    )
    pair_id_2 = paired["pair_id"]
    assert {paired["out"]["id"], paired["in"]["id"]} == {single_in["id"], single_out["id"]}

    detail_paired = get(f"/transactions/{single_in['id']}")
    assert detail_paired["pair"]["pair_id"] == pair_id_2
    assert {detail_paired["pair"]["out"]["transaction_id"],
            detail_paired["pair"]["in"]["transaction_id"]} == {
        single_in["id"], single_out["id"],
    }
    # counterparty is cleared by pairing (§5.33)
    assert detail_paired["counterparty"] is None
    events_by_name = [row["event"] for row in detail_paired["events"]]
    assert events_by_name == ["paired", "created"]       # at DESC (§7)
    assert detail_paired["events"][1]["client"] == "web"

    unpaired = post(f"/transactions/transfer/{pair_id_2}/unpair", {}, expect=200)
    assert unpaired["pair_id"] == pair_id_2
    assert {leg["transfer_pair_id"] for leg in unpaired["unpaired"]} == {None}

    detail_unpaired = get(f"/transactions/{single_in['id']}")
    assert detail_unpaired["pair"] is None
    assert detail_unpaired["transfer_pair_id"] is None
    assert [row["event"] for row in detail_unpaired["events"]] == [
        "unpaired", "paired", "created",
    ]

    # -----------------------------------------------------------------
    # Deleting an account with transactions is 409, and archiving it does
    # not change that (decision §3): the sgd account still has e2_sgd and
    # the once-paired single_out leg on it.
    # -----------------------------------------------------------------
    still_used = client.delete(mine(f"/{sgd['id']}"), headers=headers)
    assert still_used.status_code == 409
    assert still_used.json()["code"] == "source_has_transactions"

    archiving = client.patch(
        mine(f"/{sgd['id']}"),
        json={"archived": True, "updated_at": sgd["updated_at"]},
        headers=headers,
    )
    assert archiving.status_code == 200, archiving.text
    assert archiving.json()["archived"] is True

    still_blocked = client.delete(mine(f"/{sgd['id']}"), headers=headers)
    assert still_blocked.status_code == 409
    assert still_blocked.json()["code"] == "source_has_transactions"

    # -----------------------------------------------------------------
    # Unwind everything: delete every transaction and the transfer pair,
    # then the balances must be back to each account's opening balance.
    # -----------------------------------------------------------------
    delete(f"/transactions/{single_out['id']}")
    delete(f"/transactions/{e2_sgd['id']}")
    delete(f"/transactions/{single_in['id']}")
    delete(f"/transactions/transfer/{pair_id_1}")
    delete(f"/transactions/{refund['id']}")
    delete(f"/transactions/{income['id']}")
    delete(f"/transactions/{e1['id']}")

    after = get_mine(include_archived=True)
    by_id_after = {row["id"]: row for row in after["items"]}
    assert by_id_after[bank["id"]]["balance"] == "0.0000"
    assert by_id_after[card["id"]]["balance"] == "-2300.0000"
    assert by_id_after[sgd["id"]]["balance"] == "0.0000"

    empty_list = get("/transactions")
    assert empty_list["total"] == 0

    # Now that it holds no transactions, the archived account can finally
    # be deleted for real (decision §3 only blocks accounts with history).
    gone = client.delete(mine(f"/{sgd['id']}"), headers=headers)
    assert gone.status_code == 204, gone.text
    assert client.get(mine(f"/{sgd['id']}"), headers=headers).status_code == 404


# ---------------------------------------------------------------------------
# OpenAPI route inventory: phase two's surface plus this phase's 21 routes
# (8 accounts + 11 transactions + 2 stats).
# ---------------------------------------------------------------------------

PHASE_TWO_OPERATIONS = {
    ("GET", "/"),
    ("GET", "/health"),
    ("POST", "/api/v1/auth/register"),
    ("POST", "/api/v1/auth/login"),
    ("GET", "/api/v1/me"),
    ("PATCH", "/api/v1/me"),
    ("GET", "/api/v1/categories"),
    ("GET", "/api/v1/config"),
    ("GET", "/api/v1/rates/latest"),
    ("GET", "/api/v1/rates/currencies"),
    ("POST", "/api/v1/rates/convert"),
    ("GET", "/api/v1/ledgers"),
    ("POST", "/api/v1/ledgers"),
    ("POST", "/api/v1/ledgers/join"),
    ("GET", "/api/v1/ledgers/{id}"),
    ("PATCH", "/api/v1/ledgers/{id}"),
    ("DELETE", "/api/v1/ledgers/{id}"),
    ("GET", "/api/v1/ledgers/{id}/members"),
    ("DELETE", "/api/v1/ledgers/{id}/members/{user_id}"),
    ("POST", "/api/v1/ledgers/{id}/leave"),
    ("POST", "/api/v1/ledgers/{id}/transfer-ownership"),
    ("POST", "/api/v1/ledgers/{id}/invites"),
    ("DELETE", "/api/v1/ledgers/{id}/invites/{code}"),
}

# 8 account endpoints (decision §14.62): 5 personal (§5.20-§5.24), sharing
# and unsharing (§5.24a/b), and the ledger's own account list (§5.24c). The
# four ledger-scoped create/read/update/delete routes are gone (§14.42).
NEW_SOURCE_OPERATIONS = {
    ("GET", "/api/v1/sources"),
    ("POST", "/api/v1/sources"),
    ("GET", "/api/v1/sources/{sid}"),
    ("PATCH", "/api/v1/sources/{sid}"),
    ("DELETE", "/api/v1/sources/{sid}"),
    ("PUT", "/api/v1/sources/{sid}/ledgers/{lid}"),
    ("DELETE", "/api/v1/sources/{sid}/ledgers/{lid}"),
    ("GET", "/api/v1/ledgers/{id}/sources"),
}

# 10 transaction/transfer/pairing endpoints (§5.25-§5.34).
NEW_TRANSACTION_OPERATIONS = {
    ("GET", "/api/v1/ledgers/{id}/transactions"),
    ("POST", "/api/v1/ledgers/{id}/transactions"),
    ("GET", "/api/v1/ledgers/{id}/transactions/{tid}"),
    ("PATCH", "/api/v1/ledgers/{id}/transactions/{tid}"),
    ("DELETE", "/api/v1/ledgers/{id}/transactions/{tid}"),
    ("POST", "/api/v1/ledgers/{id}/transactions/transfer"),
    ("GET", "/api/v1/ledgers/{id}/transactions/transfer/{pair_id}"),
    ("PATCH", "/api/v1/ledgers/{id}/transactions/transfer/{pair_id}"),
    ("DELETE", "/api/v1/ledgers/{id}/transactions/transfer/{pair_id}"),
    ("POST", "/api/v1/ledgers/{id}/transactions/transfer/{pair_id}/unpair"),
    ("POST", "/api/v1/ledgers/{id}/transactions/{tid}/pair"),
}

# 2 statistics endpoints (§5.35-§5.36).
NEW_STATS_OPERATIONS = {
    ("GET", "/api/v1/ledgers/{id}/stats/summary"),
    ("GET", "/api/v1/ledgers/{id}/stats/trend"),
}

# The routes the v3.0 import phase has added since. ``/import-format`` (§5.7)
# is public, has no request body and no ledger prefix; the other eight are the
# batch and draft-row endpoints of §5.37-§5.44 — see test_import_format_api.py,
# test_imports_api.py and test_import_rows_api.py for their actual behaviour.
NEW_IMPORT_FORMAT_OPERATIONS = {
    ("GET", "/api/v1/import-format"),
}

NEW_IMPORT_OPERATIONS = {
    ("POST", "/api/v1/ledgers/{id}/imports"),
    ("GET", "/api/v1/ledgers/{id}/imports"),
    ("GET", "/api/v1/ledgers/{id}/imports/{bid}"),
    ("DELETE", "/api/v1/ledgers/{id}/imports/{bid}"),
    ("GET", "/api/v1/ledgers/{id}/imports/{bid}/rows"),
    ("PATCH", "/api/v1/ledgers/{id}/imports/{bid}/rows"),
    ("PATCH", "/api/v1/ledgers/{id}/imports/{bid}/rows/{rid}"),
    ("POST", "/api/v1/ledgers/{id}/imports/{bid}/commit"),
}

EXPECTED_OPERATIONS = (
    PHASE_TWO_OPERATIONS
    | NEW_SOURCE_OPERATIONS
    | NEW_TRANSACTION_OPERATIONS
    | NEW_STATS_OPERATIONS
    | NEW_IMPORT_FORMAT_OPERATIONS
    | NEW_IMPORT_OPERATIONS
)


def test_openapi_route_inventory_is_exactly_phase_three(client):
    """Phase two's 23 routes, this phase's 21, plus what the import phase added.

    The import phase contributes §5.7's public ``/import-format`` and the eight
    batch / draft-row routes of §5.37-§5.44; nothing else may appear.
    """
    response = client.get("/openapi.json")
    assert response.status_code == 200
    paths = response.json()["paths"]

    actual_operations = {
        (method.upper(), path) for path, operations in paths.items() for method in operations
    }

    assert len(PHASE_TWO_OPERATIONS) == 23
    # +1: GET transfer/{pair_id} (03 §5.30a); +1: GET /import-format (§5.7);
    # +8: the import batch and draft-row routes (§5.37-§5.44), both phase six.
    assert len(EXPECTED_OPERATIONS) == 23 + 21 + 1 + 8
    assert actual_operations == EXPECTED_OPERATIONS

    all_paths = set(paths)
    assert "/api/v1/import-format" in all_paths
    assert "/api/v1/ledgers/{id}/imports" in all_paths
