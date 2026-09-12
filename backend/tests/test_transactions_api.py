"""Transaction endpoint tests (03-backend-api.md §5.25-§5.29, §10.2).

Rates come from the ``fake_frankfurter`` of ``conftest``: one USD buys 7.2 CNY,
0.92 EUR and 150 JPY, so on a CNY ledger one EUR is 7.82608696 CNY and one JPY
is 0.048 CNY. That is what makes the base-currency amount range of decision
§14.49 observable — 1000 JPY is 48 CNY while 20 EUR is 156.52 CNY.

Dates are fixed (September 2026) rather than relative to today: the only clock
rule §5.26 has is "not later than tomorrow", and the one case that exercises it
builds its date from ``utcnow()`` on purpose.
"""
import datetime as dt
import uuid
from dataclasses import dataclass
from decimal import Decimal

import pytest

from app.core.clock import utcnow
from app.models.import_batch import ImportBatch
from app.models.transaction import Transaction
from app.models.transaction_event import TransactionEvent

SEP1 = dt.date(2026, 9, 1)
SEP4 = dt.date(2026, 9, 4)
SEP6 = dt.date(2026, 9, 6)
SEP12 = dt.date(2026, 9, 12)

# 20 EUR and 1000 JPY in CNY, as the fake upstream quotes them (§4.5, 4 dp).
EUR20_IN_CNY = Decimal("156.5217")
JPY1000_IN_CNY = Decimal("48.0000")


@dataclass
class Env:
    """One ledger with four accounts, plus the two things every call needs."""

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

    def post(self, body: dict, suffix: str = "", client: str | None = "web"):
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


def expense_body(env: Env, **overrides) -> dict:
    body = {
        "source_id": str(env.bank.id),
        "kind": "expense",
        "amount": "-45.50",
        "currency": "CNY",
        "occurred_at": SEP1.isoformat(),
        "category_l1": "groceries",
        "category_l2": "fresh_food",
        "merchant": "Carrefour",
        "note": "周末采购",
    }
    body.update(overrides)
    return body


def events_of(db, transaction_id) -> list[TransactionEvent]:
    return (
        db.query(TransactionEvent)
        .filter(TransactionEvent.transaction_id == transaction_id)
        .all()
    )


# ---------------------------------------------------------------------------
# POST /transactions (§5.26)
# ---------------------------------------------------------------------------


def test_create_expense_returns_item_with_conversion_and_event(env, db):
    response = env.post(expense_body(env, currency="eur"))

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["kind"] == "expense"
    assert body["amount"] == "-45.5000"
    assert body["currency"] == "EUR"           # normalized upper case (§4.5)
    assert body["transfer_pair_id"] is None
    assert body["refunded_total"] == "0.0000"
    assert body["refundable"] == "45.5000"
    assert body["rate_used"] == "7.82608696"
    assert body["amount_base"] == "-356.0870"
    assert body["created_by"] == str(env.user.id)

    stored = db.get(Transaction, uuid.UUID(body["id"]))
    assert stored is not None
    (event,) = events_of(db, stored.id)
    assert (event.event, event.client) == ("created", "web")


def test_create_income_refund_and_single_leg_transfer(env, db):
    income = env.post(
        expense_body(
            env,
            kind="income",
            amount="5000.00",
            category_l1="salary",
            category_l2="base_salary",
            merchant=None,
        )
    )
    assert income.status_code == 201, income.text
    assert income.json()["amount"] == "5000.0000"
    # Only expense rows carry the two refund fields (§5.25)
    assert "refunded_total" not in income.json()

    refund = env.post(
        expense_body(
            env,
            kind="refund",
            amount="10.00",
            occurred_at=SEP4.isoformat(),
            refund_of=env.post(expense_body(env)).json()["id"],
        )
    )
    assert refund.status_code == 201, refund.text
    assert refund.json()["refund_of"] is not None

    transfer = env.post(
        {
            "source_id": str(env.bank.id),
            "kind": "transfer",
            "amount": "500.00",
            "currency": "CNY",
            "occurred_at": SEP6.isoformat(),
            "transfer_role": "in",
            "transfer_subtype": "plain",
            "counterparty": "老婆",
            "note": "生活费",
        }
    )
    assert transfer.status_code == 201, transfer.text
    body = transfer.json()
    assert (body["transfer_role"], body["transfer_subtype"]) == ("in", "plain")
    assert body["counterparty"] == "老婆"
    assert body["category_l1"] is None and body["transfer_pair_id"] is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"kind": "expense", "amount": "45.50"},
        {"kind": "income", "amount": "-45.50", "category_l1": "salary"},
        {"kind": "refund", "amount": "-45.50"},
    ],
)
def test_create_rejects_sign_that_contradicts_kind(env, overrides):
    response = env.post(expense_body(env, **overrides))

    assert response.status_code == 400
    assert response.json()["code"] == "validation_error"


def test_create_transfer_rejects_category_and_merchant(env):
    base = {
        "source_id": str(env.bank.id),
        "kind": "transfer",
        "amount": "-500.00",
        "currency": "CNY",
        "occurred_at": SEP6.isoformat(),
        "transfer_role": "out",
        "transfer_subtype": "plain",
    }

    with_category = env.post({**base, "category_l1": "groceries"})
    assert with_category.status_code == 400
    assert with_category.json()["code"] == "category_invalid"

    with_merchant = env.post({**base, "merchant": "Carrefour"})
    assert with_merchant.status_code == 400
    assert with_merchant.json()["code"] == "validation_error"


def test_create_single_leg_transfer_must_use_account_currency(env):
    response = env.post(
        {
            "source_id": str(env.bank.id),      # CNY account
            "kind": "transfer",
            "amount": "-100.00",
            "currency": "EUR",
            "occurred_at": SEP6.isoformat(),
            "transfer_role": "out",
            "transfer_subtype": "plain",
        }
    )

    assert response.status_code == 400
    assert response.json()["code"] == "validation_error"


def test_create_repayment_judges_only_the_incoming_leg(env):
    """A11: the credit-card rule binds the leg the money lands on, not the payer."""
    body = {
        "source_id": str(env.bank.id),
        "kind": "transfer",
        "amount": "3000.00",
        "currency": "CNY",
        "occurred_at": SEP6.isoformat(),
        "transfer_role": "in",
        "transfer_subtype": "repayment",
    }
    rejected = env.post(body)
    assert rejected.status_code == 400
    assert rejected.json()["code"] == "repayment_target_not_credit"

    accepted = env.post({**body, "amount": "-3000.00", "transfer_role": "out"})
    assert accepted.status_code == 201, accepted.text

    onto_card = env.post({**body, "source_id": str(env.card.id)})
    assert onto_card.status_code == 201, onto_card.text


def test_create_rejects_income_category_on_expense(env):
    response = env.post(expense_body(env, category_l1="salary", category_l2=None))

    assert response.status_code == 400
    assert response.json()["code"] == "category_kind_mismatch"


def test_create_refund_target_must_be_an_expense(env, transaction_factory):
    income = transaction_factory(
        env.ledger, env.bank, kind="income", amount=Decimal("100"), category_l1="salary"
    )

    response = env.post(
        expense_body(env, kind="refund", amount="10.00", refund_of=str(income.id))
    )

    assert response.status_code == 400
    assert response.json()["code"] == "refund_target_invalid"


def test_create_refund_without_category_inherits_the_original(env):
    origin = env.post(expense_body(env)).json()

    refund = env.post(
        {
            "source_id": str(env.bank.id),
            "kind": "refund",
            "amount": "10.00",
            "currency": "CNY",
            "occurred_at": SEP4.isoformat(),
            "refund_of": origin["id"],
        }
    )

    assert refund.status_code == 201, refund.text
    assert refund.json()["category_l1"] == "groceries"
    assert refund.json()["category_l2"] == "fresh_food"


def test_create_on_archived_account_conflicts(env, source_factory):
    archived = source_factory(env.ledger, name="旧卡", archived=True)

    response = env.post(expense_body(env, source_id=str(archived.id)))

    assert response.status_code == 409
    assert response.json()["code"] == "source_archived"


def test_create_rejects_a_date_two_days_ahead(env):
    day_after_tomorrow = utcnow().date() + dt.timedelta(days=2)

    response = env.post(expense_body(env, occurred_at=day_after_tomorrow.isoformat()))

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_create_rejects_an_amount_wider_than_the_column(env):
    """NUMERIC(18, 4) stops at 14 integer digits — a 400, never a database 500."""
    response = env.post(expense_body(env, amount="-" + "9" * 15))

    assert response.status_code == 400
    assert response.json()["code"] == "validation_error"

    # One digit fewer is a perfectly ordinary (if unlikely) expense.
    assert env.post(expense_body(env, amount="-" + "9" * 14)).status_code == 201


def test_create_on_a_foreign_account_is_not_found(
    env, user_factory, ledger_factory, source_factory
):
    other = source_factory(ledger_factory(user_factory()), name="别人的卡")

    response = env.post(expense_body(env, source_id=str(other.id)))

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


# ---------------------------------------------------------------------------
# GET /transactions (§5.25) — one case per parameter, then a combined one
# ---------------------------------------------------------------------------


@pytest.fixture()
def rows(env, transaction_factory, pair_factory):
    """A small, deliberately mixed ledger the filter cases all share."""
    made = {
        "coffee": transaction_factory(
            env.ledger,
            env.bank,
            amount=Decimal("-30.0000"),
            occurred_at=SEP1,
            category_l1="food",
            category_l2="breakfast",
            merchant="Blue Bottle",
            note="早餐",
        ),
        "eur_dinner": transaction_factory(
            env.ledger,
            env.euro,
            amount=Decimal("-20.0000"),
            currency="EUR",
            occurred_at=SEP4,
            category_l1="food",
            category_l2="dinner",
            merchant="Trattoria",
        ),
        "jpy_snack": transaction_factory(
            env.ledger,
            env.bank,
            amount=Decimal("-1000.0000"),
            currency="JPY",
            occurred_at=SEP4,
            category_l1="food",
            category_l2="snacks_drinks",
            merchant="Lawson",
        ),
        "salary": transaction_factory(
            env.ledger,
            env.bank,
            kind="income",
            amount=Decimal("5000.0000"),
            occurred_at=SEP6,
            category_l1="salary",
            note="九月工资",
        ),
        "refund": transaction_factory(
            env.ledger,
            env.cash,
            kind="refund",
            amount=Decimal("12.0000"),
            occurred_at=SEP12,
            category_l1="food",
            merchant="Blue Bottle",
        ),
    }
    made["out_leg"], made["in_leg"] = pair_factory(
        env.ledger,
        env.bank,
        env.cash,
        amount_out=Decimal("-200.0000"),
        occurred_at=SEP6,
    )
    return made


def ids(response) -> set[str]:
    return {item["id"] for item in response.json()["items"]}


def test_list_filters_by_q_over_merchant_and_note(env, rows):
    by_merchant = env.get(q="  blue bottle  ")
    assert ids(by_merchant) == {str(rows["coffee"].id), str(rows["refund"].id)}

    by_note = env.get(q="九月")
    assert ids(by_note) == {str(rows["salary"].id)}

    # An empty q is the same as no q at all (§5.25)
    assert env.get(q="   ").json()["total"] == 7


def test_list_q_treats_like_wildcards_as_literal_text(env, transaction_factory):
    """``%`` and ``_`` are characters the user typed, not LIKE patterns."""
    literal = transaction_factory(env.ledger, env.bank, merchant="a%b")
    transaction_factory(env.ledger, env.bank, merchant="axxb")
    underscore = transaction_factory(env.ledger, env.bank, merchant="c_d")
    transaction_factory(env.ledger, env.bank, merchant="cxd")

    assert ids(env.get(q="a%b")) == {str(literal.id)}
    assert ids(env.get(q="c_d")) == {str(underscore.id)}


def test_list_filters_by_repeated_kind(env, rows):
    response = env.client.get(
        env.url(), headers=env.headers, params=[("kind", "income"), ("kind", "refund")]
    )

    assert ids(response) == {str(rows["salary"].id), str(rows["refund"].id)}


def test_list_filters_by_category_levels(env, rows):
    assert env.get(category_l1="salary").json()["total"] == 1
    assert ids(env.get(category_l2="breakfast")) == {str(rows["coffee"].id)}
    assert ids(env.get(category_l1="food", category_l2="dinner")) == {
        str(rows["eur_dinner"].id)
    }


@pytest.mark.parametrize(
    "params",
    [
        {"category_l1": "nonsense"},
        {"category_l2": "nonsense"},
        {"category_l1": "food", "category_l2": "fresh_food"},   # l2 of another l1
    ],
)
def test_list_rejects_an_illegal_category_filter(env, params):
    response = env.get(**params)

    assert response.status_code == 400
    assert response.json()["code"] == "category_invalid"


def test_list_filters_by_repeated_source_id(env, rows):
    response = env.client.get(
        env.url(),
        headers=env.headers,
        params=[("source_id", str(env.euro.id)), ("source_id", str(env.cash.id))],
    )

    assert ids(response) == {
        str(rows["eur_dinner"].id),
        str(rows["refund"].id),
        str(rows["in_leg"].id),
    }


def test_list_source_filter_from_another_ledger_is_not_found(
    env, rows, user_factory, ledger_factory, source_factory
):
    foreign = source_factory(ledger_factory(user_factory()), name="别人的卡")

    response = env.client.get(
        env.url(),
        headers=env.headers,
        params=[("source_id", str(env.bank.id)), ("source_id", str(foreign.id))],
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_list_filters_by_date_range_inclusive(env, rows):
    response = env.get(**{"from": SEP4.isoformat(), "to": SEP6.isoformat()})

    assert ids(response) == {
        str(rows["eur_dinner"].id),
        str(rows["jpy_snack"].id),
        str(rows["salary"].id),
        str(rows["out_leg"].id),
        str(rows["in_leg"].id),
    }


def test_list_filters_by_original_currency(env, rows):
    """§14.49 keeps a currency filter, and it matches the row's own code."""
    assert ids(env.get(currency="eur")) == {str(rows["eur_dinner"].id)}
    assert ids(env.get(currency="JPY")) == {str(rows["jpy_snack"].id)}


def test_list_amount_range_compares_base_currency(env, rows):
    """1000 JPY is 48 CNY, 20 EUR is 156.52 CNY (decision §14.49)."""
    above_100 = env.get(min_amount="100", kind="expense")
    assert str(rows["jpy_snack"].id) not in ids(above_100)
    assert str(rows["eur_dinner"].id) in ids(above_100)

    below_100 = env.get(max_amount="100", kind="expense")
    assert ids(below_100) == {str(rows["jpy_snack"].id), str(rows["coffee"].id)}

    # The bound is on the absolute value, so income and expense are comparable.
    assert ids(env.get(min_amount="1000")) == {str(rows["salary"].id)}


def test_list_rejects_min_above_max(env):
    response = env.get(min_amount="100", max_amount="10")

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


@pytest.fixture()
def jpy_rate_gone(monkeypatch):
    """Every conversion that touches JPY fails, as an upstream outage would."""
    from app.core.errors import ApiError, ErrorCode
    from app.services import fx

    real = fx.convert_many

    def flaky(db, items, to_currency):
        batch = list(items)
        if any(currency.upper() == "JPY" for _amount, currency, _on in batch):
            raise ApiError(503, ErrorCode.FX_UNAVAILABLE, "no rate for JPY")
        return real(db, batch, to_currency)

    monkeypatch.setattr(fx, "convert_many", flaky)


def test_list_renders_an_unconvertible_row_as_three_nulls(env, rows, jpy_rate_gone):
    """§5.25: the row still comes back, the summary says how many are unvalued."""
    response = env.get()
    body = response.json()

    snack = next(
        item for item in body["items"] if item["id"] == str(rows["jpy_snack"].id)
    )
    assert snack["amount_base"] is None
    assert snack["rate_used"] is None
    assert snack["rate_date"] is None
    assert body["total"] == 7
    assert body["summary"]["rate_missing_count"] == 1


def test_list_amount_range_still_counts_the_rows_it_could_not_value(
    env, rows, jpy_rate_gone
):
    """An unvalued row cannot satisfy a bound, but it must not vanish silently."""
    response = env.get(min_amount="0")
    body = response.json()

    assert str(rows["jpy_snack"].id) not in ids(response)
    assert body["total"] == 6
    assert body["summary"]["rate_missing_count"] == 1


def test_detail_of_an_unconvertible_row_is_three_nulls(env, rows, jpy_rate_gone):
    body = env.get(f"/{rows['jpy_snack'].id}").json()

    assert body["amount"] == "-1000.0000"
    assert body["amount_base"] is None
    assert body["rate_used"] is None
    assert body["rate_date"] is None


def test_list_filters_by_import_batch(env, db, rows, transaction_factory):
    now = utcnow()
    batch = ImportBatch(
        ledger_id=env.ledger.id,
        source_id=env.bank.id,
        created_by=env.user.id,
        source="csv",
        filename="cmb.csv",
        size_bytes=1024,
        skill_version="2026-09-10",
        status="ready",
        row_count=1,
        created_at=now,
        updated_at=now,
    )
    db.add(batch)
    db.flush()
    imported = transaction_factory(
        env.ledger, env.bank, amount=Decimal("-8.0000"), import_batch_id=batch.id
    )

    response = env.get(import_batch_id=str(batch.id))

    assert ids(response) == {str(imported.id)}
    assert response.json()["items"][0]["import_batch_id"] == str(batch.id)


def test_list_import_batch_from_another_ledger_is_not_found(
    env, db, user_factory, ledger_factory, source_factory
):
    other_user = user_factory()
    other_ledger = ledger_factory(other_user)
    other_source = source_factory(other_ledger, name="别人的卡")
    now = utcnow()
    batch = ImportBatch(
        ledger_id=other_ledger.id,
        source_id=other_source.id,
        created_by=other_user.id,
        source="paste",
        size_bytes=10,
        skill_version="2026-09-10",
        status="ready",
        row_count=0,
        created_at=now,
        updated_at=now,
    )
    db.add(batch)
    db.flush()

    response = env.get(import_batch_id=str(batch.id))

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_list_combines_filters(env, rows):
    response = env.get(
        kind="expense",
        category_l1="food",
        q="a",
        max_amount="200",
        **{"from": SEP4.isoformat(), "to": SEP4.isoformat()},
    )

    assert ids(response) == {str(rows["eur_dinner"].id), str(rows["jpy_snack"].id)}


def test_list_summary_covers_the_whole_result_and_survives_paging(env, rows):
    whole = env.get(limit=200).json()
    # 30 CNY + 20 EUR (156.5217) + 1000 JPY (48) expenses, 5000 income, 12 refund;
    # neither transfer leg takes part (decision §14.52 A14).
    assert whole["summary"] == {
        "base_currency": "CNY",
        "expense": "234.5217",
        "income": "5000.0000",
        "net": "4777.4783",
        "count": 7,
        "rate_missing_count": 0,
    }
    assert whole["total"] == 7

    page_two = env.get(limit=2, offset=2).json()
    assert page_two["summary"] == whole["summary"]
    assert page_two["total"] == 7
    assert len(page_two["items"]) == 2

    filtered = env.get(kind="expense").json()["summary"]
    assert filtered["income"] == "0.0000"
    assert filtered["count"] == 3


def test_list_pages_do_not_overlap_and_carry_one_summary(env, rows):
    """The fast path pages in SQL; two pages must tile the result, not repeat it."""
    first = env.get(limit=4, offset=0)
    second = env.get(limit=4, offset=4)

    assert ids(first) and ids(first).isdisjoint(ids(second))
    assert ids(first) | ids(second) == ids(env.get(limit=200))
    assert len(first.json()["items"]) == 4
    assert len(second.json()["items"]) == 3
    assert first.json()["total"] == second.json()["total"] == 7
    assert first.json()["summary"] == second.json()["summary"]


@pytest.fixture()
def valued_batches(monkeypatch) -> list[list[str]]:
    """Records the rows handed to ``valuation.value_transactions``, per call."""
    from app.services import valuation

    real = valuation.value_transactions
    batches: list[list[str]] = []

    def spy(db, base_currency, batch):
        rows = list(batch)
        batches.append([str(row.id) for row in rows])
        return real(db, base_currency, rows)

    monkeypatch.setattr(valuation, "value_transactions", spy)
    return batches


def test_list_without_an_amount_bound_values_only_the_current_page(
    env, rows, valued_batches
):
    """§5.25's fast path: SQL filters and pages, conversion sees one page.

    The summary still covers all seven rows — it is computed from grouped
    subtotals, not from the rows the response carries.
    """
    body = env.get(limit=2, offset=2).json()

    assert valued_batches == [[item["id"] for item in body["items"]]]
    assert body["total"] == 7
    assert body["summary"] == {
        "base_currency": "CNY",
        "expense": "234.5217",
        "income": "5000.0000",
        "net": "4777.4783",
        "count": 7,
        "rate_missing_count": 0,
    }


def test_list_with_an_amount_bound_still_values_the_whole_result(
    env, rows, valued_batches
):
    """Decision §14.49 compares base-currency amounts, which SQL cannot do."""
    body = env.get(limit=2, min_amount="0").json()

    assert len(body["items"]) == 2
    assert body["total"] == 7
    assert [len(batch) for batch in valued_batches] == [7]


def test_list_summary_is_the_same_on_both_paths(env, rows):
    """A bound that excludes nothing must not move a single figure."""
    fast = env.get(limit=1).json()
    bounded = env.get(limit=1, min_amount="0").json()

    assert fast["summary"] == bounded["summary"]
    assert fast["total"] == bounded["total"]


def test_list_summary_agrees_on_both_paths_with_several_rows_per_group(
    env, transaction_factory
):
    """Same day, same currency, several rows — the two paths must still agree.

    The fast path converts one subtotal per ``(kind, currency, day)`` group, so
    if the bound path converted row by row instead, a group of foreign-currency
    rows whose fractions round differently together than apart would make the
    same selection report two different expenses. These four EUR amounts do
    exactly that.
    """
    for amount in ("-40.1400", "-36.5100", "-52.4800", "-63.3100"):
        transaction_factory(
            env.ledger,
            env.euro,
            amount=Decimal(amount),
            currency="EUR",
            occurred_at=SEP4,
            category_l1="food",
            category_l2="dinner",
        )

    fast = env.get(limit=200).json()
    bounded = env.get(limit=200, min_amount="0").json()

    assert fast["summary"] == bounded["summary"]
    assert fast["total"] == bounded["total"]
    assert ids(env.get(limit=200)) == ids(env.get(limit=200, min_amount="0"))


def test_list_returns_both_legs_of_a_transfer(env, rows):
    items = env.get(kind="transfer").json()["items"]

    assert len(items) == 2
    assert {item["transfer_role"] for item in items} == {"out", "in"}
    assert len({item["transfer_pair_id"] for item in items}) == 1


def test_list_refund_totals_only_on_expense_rows(env, rows, transaction_factory):
    transaction_factory(
        env.ledger,
        env.bank,
        kind="refund",
        amount=Decimal("11.0000"),
        occurred_at=SEP12,
        refund_of=rows["coffee"].id,
        category_l1="food",
    )

    items = {item["id"]: item for item in env.get(limit=200).json()["items"]}

    coffee = items[str(rows["coffee"].id)]
    assert coffee["refunded_total"] == "11.0000"
    assert coffee["refundable"] == "19.0000"
    assert "refunded_total" not in items[str(rows["salary"].id)]
    assert "refundable" not in items[str(rows["in_leg"].id)]


def test_list_orders_by_date_then_creation(env, transaction_factory):
    older = transaction_factory(env.ledger, env.bank, occurred_at=SEP1)
    same_day_later = transaction_factory(env.ledger, env.bank, occurred_at=SEP1)
    newest = transaction_factory(env.ledger, env.bank, occurred_at=SEP6)

    order = [item["id"] for item in env.get().json()["items"]]

    assert order == [str(newest.id), str(same_day_later.id), str(older.id)]


def test_list_total_counts_filtered_rows_not_the_page(env, rows):
    body = env.get(kind="expense", limit=1).json()

    assert len(body["items"]) == 1
    assert body["total"] == 3


def test_list_rejects_a_non_member(env, user_factory, auth_headers):
    outsider = user_factory()

    response = env.client.get(env.url(), headers=auth_headers(outsider))

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_list_requires_a_token(env):
    response = env.client.get(env.url())

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


# ---------------------------------------------------------------------------
# GET /transactions/{tid} (§5.27)
# ---------------------------------------------------------------------------


def test_detail_expense_lists_its_refunds_oldest_first(env, transaction_factory):
    origin = transaction_factory(
        env.ledger, env.bank, amount=Decimal("-45.5000"), occurred_at=SEP1
    )
    later = transaction_factory(
        env.ledger,
        env.bank,
        kind="refund",
        amount=Decimal("5.0000"),
        occurred_at=SEP12,
        refund_of=origin.id,
        note="又退了一份",
    )
    earlier = transaction_factory(
        env.ledger,
        env.bank,
        kind="refund",
        amount=Decimal("10.0000"),
        occurred_at=SEP4,
        refund_of=origin.id,
        note="退了一盒草莓",
    )

    body = env.get(f"/{origin.id}").json()

    assert [refund["id"] for refund in body["refunds"]] == [
        str(earlier.id),
        str(later.id),
    ]
    assert body["refunds"][0]["note"] == "退了一盒草莓"
    assert body["refunded_total"] == "15.0000"
    assert body["refundable"] == "30.5000"
    assert body["refund_of_detail"] is None
    assert body["pair"] is None
    assert body["rate_used"] == "1.00000000"    # CNY on a CNY ledger (A24)
    assert body["rate_date"] == SEP1.isoformat()


def test_detail_refunds_are_scoped_to_this_ledger(
    env, user_factory, ledger_factory, source_factory, transaction_factory
):
    """``refunds[]`` reads this ledger only (§3.3), like every other query here.

    The API can never write a cross-ledger ``refund_of`` — the row below goes
    straight into the database — but the read does not lean on that.
    """
    origin = transaction_factory(
        env.ledger, env.bank, amount=Decimal("-45.5000"), occurred_at=SEP1
    )
    mine = transaction_factory(
        env.ledger,
        env.bank,
        kind="refund",
        amount=Decimal("10.0000"),
        occurred_at=SEP4,
        refund_of=origin.id,
    )
    outsider = user_factory()
    other_ledger = ledger_factory(outsider, base_currency="CNY")
    transaction_factory(
        other_ledger,
        source_factory(other_ledger, name="别人的卡", type="checking", currency="CNY"),
        kind="refund",
        amount=Decimal("7.0000"),
        occurred_at=SEP6,
        refund_of=origin.id,
    )

    body = env.get(f"/{origin.id}").json()

    assert [refund["id"] for refund in body["refunds"]] == [str(mine.id)]
    # The two totals describe that same list, so the foreign row is out of
    # them too: 45.50 - 10.00, not 45.50 - 17.00 (§5.27).
    assert body["refunded_total"] == "10.0000"
    assert body["refundable"] == "35.5000"


def test_detail_refund_expands_the_original_without_itself(env, transaction_factory):
    origin = transaction_factory(
        env.ledger,
        env.bank,
        amount=Decimal("-45.5000"),
        occurred_at=SEP1,
        merchant="Carrefour",
        category_l1="groceries",
        category_l2="fresh_food",
    )
    mine = transaction_factory(
        env.ledger,
        env.bank,
        kind="refund",
        amount=Decimal("10.0000"),
        occurred_at=SEP4,
        refund_of=origin.id,
    )
    sibling = transaction_factory(
        env.ledger,
        env.bank,
        kind="refund",
        amount=Decimal("5.0000"),
        occurred_at=SEP12,
        refund_of=origin.id,
    )

    body = env.get(f"/{mine.id}").json()

    detail = body["refund_of_detail"]
    assert detail["id"] == str(origin.id)
    assert detail["merchant"] == "Carrefour"
    assert detail["category_l2"] == "fresh_food"
    assert detail["refunded_total"] == "15.0000"
    assert detail["refundable"] == "30.5000"
    assert [row["id"] for row in detail["other_refunds"]] == [str(sibling.id)]
    assert body["refunds"] == []


def test_detail_refund_loses_its_origin_when_the_expense_is_deleted(
    env, db, transaction_factory
):
    origin = transaction_factory(env.ledger, env.bank, amount=Decimal("-45.5000"))
    refund = transaction_factory(
        env.ledger,
        env.bank,
        kind="refund",
        amount=Decimal("10.0000"),
        occurred_at=SEP4,
        refund_of=origin.id,
    )

    assert env.delete(f"/{origin.id}").status_code == 204

    body = env.get(f"/{refund.id}").json()
    assert body["refund_of"] is None
    assert body["refund_of_detail"] is None


def test_detail_pair_is_a_precis_on_a_leg_and_null_on_a_single_one(
    env, pair_factory, transaction_factory
):
    out_leg, in_leg = pair_factory(
        env.ledger,
        env.bank,
        env.euro,
        amount_out=Decimal("-100.0000"),
        amount_in=Decimal("720.0000"),
        currency_in="EUR",
        occurred_at=SEP6,
    )
    single = transaction_factory(
        env.ledger,
        env.bank,
        kind="transfer",
        amount=Decimal("500.0000"),
        occurred_at=SEP6,
        counterparty="老婆",
    )

    pair = env.get(f"/{out_leg.id}").json()["pair"]
    assert pair["pair_id"] == str(out_leg.transfer_pair_id)
    assert pair["out"] == {
        "transaction_id": str(out_leg.id),
        "source_id": str(env.bank.id),
        "amount": "-100.0000",
        "currency": "CNY",
    }
    assert pair["in"]["transaction_id"] == str(in_leg.id)
    assert "occurred_at" not in pair

    assert env.get(f"/{single.id}").json()["pair"] is None


def test_detail_events_are_newest_first_and_carry_the_client(env, db):
    created = env.post(expense_body(env), client="web").json()
    patched = env.patch(
        f"/{created['id']}",
        {"amount": "-42.00", "updated_at": created["updated_at"]},
        client="cli",
    )
    assert patched.status_code == 200, patched.text

    events = env.get(f"/{created['id']}").json()["events"]

    assert [event["event"] for event in events] == ["updated", "created"]
    assert [event["client"] for event in events] == ["cli", "web"]
    assert events[0]["changes"] == {
        "amount": {"before": "-45.5000", "after": "-42.0000"}
    }
    assert events[0]["actor_id"] == str(env.user.id)
    assert events[0]["import_batch_id"] is None


def test_detail_of_another_ledgers_transaction_is_not_found(
    env, user_factory, ledger_factory, source_factory, transaction_factory
):
    other_user = user_factory()
    other_ledger = ledger_factory(other_user)
    foreign = transaction_factory(
        other_ledger, source_factory(other_ledger, name="别人的卡")
    )

    response = env.get(f"/{foreign.id}")

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


# ---------------------------------------------------------------------------
# PATCH /transactions/{tid} (§5.28)
# ---------------------------------------------------------------------------


def test_patch_with_a_stale_version_conflicts(env):
    created = env.post(expense_body(env)).json()

    response = env.patch(
        f"/{created['id']}",
        {"amount": "-42.00", "updated_at": "2020-01-01T00:00:00.000000Z"},
    )

    assert response.status_code == 409
    assert response.json()["code"] == "stale_update"


def test_patch_turns_an_expense_into_a_refund(env):
    """§10.2's PATCH row: the sign has to flip inside the one request."""
    origin = env.post(expense_body(env)).json()
    mistake = env.post(expense_body(env, amount="-45.50", merchant="Metro")).json()

    response = env.patch(
        f"/{mistake['id']}",
        {
            "kind": "refund",
            "amount": "45.50",
            "refund_of": origin["id"],
            "updated_at": mistake["updated_at"],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "refund"
    assert body["amount"] == "45.5000"
    assert body["refund_of"] == origin["id"]


def test_patch_turns_an_income_into_a_refund(env):
    origin = env.post(expense_body(env)).json()
    wrong = env.post(
        expense_body(
            env,
            kind="income",
            amount="10.00",
            category_l1="salary",
            category_l2=None,
            merchant=None,
        )
    ).json()

    response = env.patch(
        f"/{wrong['id']}",
        {
            "kind": "refund",
            "category_l1": "groceries",
            "refund_of": origin["id"],
            "updated_at": wrong["updated_at"],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "refund"
    assert body["refund_of"] == origin["id"]


def test_patch_cannot_cross_the_transfer_boundary(env):
    """Decision §14.3, judged before the edit is applied.

    The dedicated ``kind_change_not_allowed`` is what proves the boundary is
    checked first: whole-row validation would have complained about the
    category or the transfer columns instead, with a different code.
    """
    expense = env.post(expense_body(env)).json()
    to_transfer = env.patch(
        f"/{expense['id']}",
        {
            "kind": "transfer",
            "category_l2": None,
            "merchant": None,
            "transfer_role": "out",
            "transfer_subtype": "plain",
            "updated_at": expense["updated_at"],
        },
    )
    assert to_transfer.status_code == 400
    assert to_transfer.json()["code"] == "kind_change_not_allowed"

    leg = env.post(
        {
            "source_id": str(env.bank.id),
            "kind": "transfer",
            "amount": "-500.00",
            "currency": "CNY",
            "occurred_at": SEP6.isoformat(),
            "transfer_role": "out",
            "transfer_subtype": "plain",
        }
    ).json()
    to_expense = env.patch(
        f"/{leg['id']}",
        {
            "kind": "expense",
            "category_l1": "food",
            "updated_at": leg["updated_at"],
        },
    )
    assert to_expense.status_code == 400
    assert to_expense.json()["code"] == "kind_change_not_allowed"


def test_patch_on_a_paired_leg_points_at_the_transfer_endpoint(env, pair_factory):
    out_leg, _in_leg = pair_factory(
        env.ledger, env.bank, env.cash, amount_out=Decimal("-200.0000"), occurred_at=SEP6
    )
    stamp = out_leg.updated_at.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"

    response = env.patch(f"/{out_leg.id}", {"note": "x", "updated_at": stamp})

    assert response.status_code == 409
    assert response.json()["code"] == "use_transfer_endpoint"


def test_patch_writes_refund_link_and_unlink_events(env, db):
    origin = env.post(expense_body(env)).json()
    refund = env.post(
        expense_body(env, kind="refund", amount="10.00", occurred_at=SEP4.isoformat())
    ).json()

    linked = env.patch(
        f"/{refund['id']}",
        {"refund_of": origin["id"], "updated_at": refund["updated_at"]},
    )
    assert linked.status_code == 200, linked.text
    unlinked = env.patch(
        f"/{refund['id']}",
        {"refund_of": None, "updated_at": linked.json()["updated_at"]},
    )
    assert unlinked.status_code == 200, unlinked.text

    names = [event["event"] for event in env.get(f"/{refund['id']}").json()["events"]]
    assert names == ["refund_unlinked", "refund_linked", "created"]


def test_patch_that_changes_nothing_writes_no_event(env, db):
    created = env.post(expense_body(env)).json()

    response = env.patch(
        f"/{created['id']}",
        {"amount": "-45.50", "note": "周末采购", "updated_at": created["updated_at"]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["updated_at"] != created["updated_at"]
    assert [event["event"] for event in env.get(f"/{created['id']}").json()["events"]] == [
        "created"
    ]


def test_patch_rejects_an_explicit_null_on_a_required_field(env):
    created = env.post(expense_body(env)).json()

    response = env.patch(
        f"/{created['id']}", {"amount": None, "updated_at": created["updated_at"]}
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


# ---------------------------------------------------------------------------
# DELETE /transactions/{tid} (§5.29)
# ---------------------------------------------------------------------------


def test_delete_removes_one_row_and_its_events(env, db):
    doomed = env.post(expense_body(env)).json()
    kept = env.post(expense_body(env, note="留着")).json()

    assert env.delete(f"/{doomed['id']}").status_code == 204

    db.expire_all()
    assert db.get(Transaction, uuid.UUID(doomed["id"])) is None
    assert db.get(Transaction, uuid.UUID(kept["id"])) is not None
    assert events_of(db, uuid.UUID(doomed["id"])) == []
    assert len(events_of(db, uuid.UUID(kept["id"]))) == 1
    assert env.get(f"/{doomed['id']}").status_code == 404


def test_delete_of_an_original_keeps_the_refund_row(env, db, transaction_factory):
    origin = transaction_factory(env.ledger, env.bank, amount=Decimal("-45.5000"))
    refund = transaction_factory(
        env.ledger,
        env.bank,
        kind="refund",
        amount=Decimal("10.0000"),
        occurred_at=SEP4,
        refund_of=origin.id,
    )

    assert env.delete(f"/{origin.id}").status_code == 204

    db.expire_all()
    stored = db.get(Transaction, refund.id)
    assert stored is not None
    assert stored.refund_of is None


def test_delete_of_a_paired_leg_points_at_the_transfer_endpoint(env, db, pair_factory):
    out_leg, in_leg = pair_factory(
        env.ledger, env.bank, env.cash, amount_out=Decimal("-200.0000"), occurred_at=SEP6
    )

    response = env.delete(f"/{out_leg.id}")

    assert response.status_code == 409
    assert response.json()["code"] == "use_transfer_endpoint"
    db.expire_all()
    assert db.get(Transaction, in_leg.id) is not None


def test_delete_twice_is_not_found(env):
    created = env.post(expense_body(env)).json()

    assert env.delete(f"/{created['id']}").status_code == 204
    assert env.delete(f"/{created['id']}").status_code == 404
