"""Tests for the accounts/transactions/transfers/stats schemas (03-backend-api.md
§4.5, §5.20-§5.36).

These are pure pydantic unit tests: shape, length, enum, the one date bound
that lives in the schema layer, and null semantics for each *Patch* model,
plus the Decimal digit-count and the ``refunded_total``/``refundable``
exclude-when-unset behaviour called out by the task spec. Business-rule
coupling (sign vs. kind, category vs. kind, ``refund_of`` legality) is
service-layer territory and is intentionally not exercised here.
"""
import datetime as dt
import json
import uuid
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.finance_source import (
    SourceCreate,
    SourceListResponse,
    SourcePatch,
    SourceResponse,
)
from app.schemas.stats import (
    CategoryStat,
    MonthExpense,
    SubStat,
    SummaryResponse,
    TrendResponse,
)
from app.schemas.transaction import (
    EventItem,
    PairLeg,
    PairRef,
    PairRequest,
    RefundOrigin,
    RefundRef,
    TransactionCreate,
    TransactionDetail,
    TransactionItem,
    TransactionListResponse,
    TransactionPatch,
    TransactionSummary,
    TransferCreate,
    TransferLeg,
    TransferPatch,
    TransferResponse,
    UnpairedLeg,
    UnpairResponse,
)

UID = uuid.uuid4


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _tx_item_kwargs(**overrides: object) -> dict:
    base = dict(
        id=UID(),
        ledger_id=UID(),
        source_id=UID(),
        kind="expense",
        amount=Decimal("-45.50"),
        currency="EUR",
        occurred_at=dt.date(2026, 9, 1),
        category_l1="groceries",
        category_l2="fresh_food",
        merchant="Carrefour",
        note="周末采购",
        counterparty=None,
        transfer_role=None,
        transfer_subtype=None,
        transfer_pair_id=None,
        refund_of=None,
        import_batch_id=None,
        amount_base=Decimal("-377.57"),
        rate_used=Decimal("8.29824176"),
        rate_date=dt.date(2026, 9, 1),
        created_by=UID(),
        updated_by=UID(),
        created_at=dt.datetime(2026, 9, 1, 18, 20, 0),
        updated_at=dt.datetime(2026, 9, 1, 18, 20, 0),
    )
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# finance_source.py
# ---------------------------------------------------------------------------


def test_source_create_strips_name_and_rejects_blank():
    src = SourceCreate(name="  招商 储蓄卡  ", type="checking", default_currency="cny")
    assert src.name == "招商 储蓄卡"
    with pytest.raises(ValidationError):
        SourceCreate(name="   ", type="checking", default_currency="cny")


def test_source_create_type_is_four_way_enum():
    for good in ("checking", "credit", "cash", "other"):
        SourceCreate(name="x", type=good, default_currency="cny")
    with pytest.raises(ValidationError):
        SourceCreate(name="x", type="savings", default_currency="cny")


def test_source_create_currency_pattern_and_uppercase():
    src = SourceCreate(name="x", type="cash", default_currency="sgd")
    assert src.default_currency == "SGD"
    with pytest.raises(ValidationError):
        SourceCreate(name="x", type="cash", default_currency="sg1")


def test_source_create_opening_balance_defaults_zero_and_quantizes():
    src = SourceCreate(name="x", type="credit", default_currency="cny")
    assert src.opening_balance == Decimal("0.0000")
    src2 = SourceCreate(
        name="x", type="credit", default_currency="cny", opening_balance="-2300"
    )
    assert src2.opening_balance == Decimal("-2300.0000")
    assert json.loads(src2.model_dump_json())["opening_balance"] == "-2300.0000"


def test_source_create_opening_balance_out_of_precision_is_422_not_500():
    """Same ``decimal.InvalidOperation`` guard as ``TransactionCreate.amount``
    (the quantize helper is shared, imported from ``app.schemas.transaction``)."""
    with pytest.raises(ValidationError):
        SourceCreate(name="x", type="cash", default_currency="cny", opening_balance="1e40")


def test_source_patch_requires_updated_at():
    with pytest.raises(ValidationError):
        SourcePatch(name="new name")


def test_source_patch_rejects_explicit_null_on_editable_fields():
    now = dt.datetime(2026, 9, 3, 5, 51, 45)
    with pytest.raises(ValidationError):
        SourcePatch(updated_at=now, name=None)
    with pytest.raises(ValidationError):
        SourcePatch(updated_at=now, type=None)
    with pytest.raises(ValidationError):
        SourcePatch(updated_at=now, opening_balance=None)
    with pytest.raises(ValidationError):
        SourcePatch(updated_at=now, archived=None)


def test_source_patch_allows_default_currency_to_appear_unvalidated():
    """The endpoint (not the schema) turns a present ``default_currency`` into
    400 ``currency_locked``; the schema only needs to let it through, null or
    not, without ``extra="forbid"`` rejecting it."""
    now = dt.datetime(2026, 9, 3, 5, 51, 45)
    patch = SourcePatch(updated_at=now, default_currency="USD")
    assert "default_currency" in patch.model_fields_set
    patch_null = SourcePatch(updated_at=now, default_currency=None)
    assert "default_currency" in patch_null.model_fields_set
    patch_omitted = SourcePatch(updated_at=now)
    assert "default_currency" not in patch_omitted.model_fields_set


def test_source_response_serializes_decimals_with_fixed_digits():
    resp = SourceResponse(
        id=UID(),
        ledger_id=UID(),
        name="Revolut EUR",
        type="other",
        default_currency="EUR",
        opening_balance=Decimal("100"),
        archived=True,
        archived_at=dt.datetime(2026, 9, 6, 10, 0, 0),
        balance=Decimal("54.5"),
        balance_base=Decimal("452.35"),
        balance_rate=Decimal("8.3"),
        balance_rate_date=dt.date(2026, 9, 8),
        rate_missing_count=0,
        created_by=UID(),
        updated_by=UID(),
        created_at=dt.datetime(2026, 9, 3, 5, 51, 45, 953116),
        updated_at=dt.datetime(2026, 9, 6, 10, 0, 0),
    )
    data = json.loads(resp.model_dump_json())
    assert data["opening_balance"] == "100.0000"
    assert data["balance"] == "54.5000"
    assert data["balance_base"] == "452.3500"
    assert data["balance_rate"] == "8.30000000"
    assert data["archived_at"] == "2026-09-06T10:00:00.000000Z"


def test_source_list_response_totals_can_be_null():
    resp = SourceListResponse(
        items=[], total=0, base_currency="CNY", assets=None, liabilities=None, net_worth=None
    )
    assert resp.assets is None and resp.liabilities is None and resp.net_worth is None


# ---------------------------------------------------------------------------
# transaction.py — TransactionCreate / TransactionPatch
# ---------------------------------------------------------------------------


def test_transaction_create_amount_rejects_zero():
    with pytest.raises(ValidationError):
        TransactionCreate(
            source_id=UID(),
            kind="expense",
            amount=Decimal("0"),
            currency="EUR",
            occurred_at=dt.date.today(),
            category_l1="groceries",
        )


def test_transaction_create_amount_out_of_precision_is_422_not_500():
    """A finite but huge amount (``1e40``) needs more digits than the default
    ``decimal`` context precision (28) to quantize, which raises
    ``decimal.InvalidOperation`` from inside the ``AfterValidator``. That must
    surface as a pydantic ``ValidationError`` (422), never an uncaught
    exception (which would 500 through FastAPI)."""
    with pytest.raises(ValidationError):
        TransactionCreate(
            source_id=UID(),
            kind="expense",
            amount=Decimal("1e40"),
            currency="EUR",
            occurred_at=dt.date.today(),
            category_l1="groceries",
        )


def test_transaction_create_occurred_at_bound_is_tomorrow_utc():
    today = dt.datetime.now(dt.UTC).date()
    ok = TransactionCreate(
        source_id=UID(),
        kind="expense",
        amount=Decimal("-1"),
        currency="EUR",
        occurred_at=today + dt.timedelta(days=1),
        category_l1="groceries",
    )
    assert ok.occurred_at == today + dt.timedelta(days=1)
    with pytest.raises(ValidationError):
        TransactionCreate(
            source_id=UID(),
            kind="expense",
            amount=Decimal("-1"),
            currency="EUR",
            occurred_at=today + dt.timedelta(days=2),
            category_l1="groceries",
        )


def test_transaction_create_kind_enum_and_lengths():
    with pytest.raises(ValidationError):
        TransactionCreate(
            source_id=UID(),
            kind="withdrawal",
            amount=Decimal("-1"),
            currency="EUR",
            occurred_at=dt.date.today(),
        )
    with pytest.raises(ValidationError):
        TransactionCreate(
            source_id=UID(),
            kind="expense",
            amount=Decimal("-1"),
            currency="EUR",
            occurred_at=dt.date.today(),
            merchant="x" * 201,
        )
    with pytest.raises(ValidationError):
        TransactionCreate(
            source_id=UID(),
            kind="expense",
            amount=Decimal("-1"),
            currency="EUR",
            occurred_at=dt.date.today(),
            note="x" * 501,
        )
    with pytest.raises(ValidationError):
        TransactionCreate(
            source_id=UID(),
            kind="transfer",
            amount=Decimal("1"),
            currency="CNY",
            occurred_at=dt.date.today(),
            transfer_role="in",
            transfer_subtype="plain",
            counterparty="x" * 101,
        )


def test_transaction_create_currency_uppercased():
    tx = TransactionCreate(
        source_id=UID(),
        kind="income",
        amount=Decimal("100"),
        currency="cny",
        occurred_at=dt.date.today(),
        category_l1="salary",
    )
    assert tx.currency == "CNY"


def test_transaction_create_does_not_enforce_sign_kind_coupling():
    """Shape-only: an expense with a positive amount is a service-layer 400,
    not a schema-level rejection (schema only requires amount != 0)."""
    tx = TransactionCreate(
        source_id=UID(),
        kind="expense",
        amount=Decimal("45.50"),
        currency="EUR",
        occurred_at=dt.date.today(),
        category_l1="groceries",
    )
    assert tx.amount == Decimal("45.5000")


def test_transaction_patch_requires_updated_at():
    with pytest.raises(ValidationError):
        TransactionPatch(amount=Decimal("-1"))


def test_transaction_patch_nullable_fields_accept_explicit_null():
    now = dt.datetime(2026, 9, 1, 18, 20, 0)
    patch = TransactionPatch(
        updated_at=now,
        category_l2=None,
        merchant=None,
        note=None,
        counterparty=None,
        refund_of=None,
    )
    assert patch.category_l2 is None
    assert patch.merchant is None
    assert patch.note is None
    assert patch.counterparty is None
    assert patch.refund_of is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("source_id", None),
        ("kind", None),
        ("amount", None),
        ("currency", None),
        ("occurred_at", None),
        ("category_l1", None),
        ("transfer_role", None),
        ("transfer_subtype", None),
    ],
)
def test_transaction_patch_non_nullable_fields_reject_explicit_null(field, value):
    now = dt.datetime(2026, 9, 1, 18, 20, 0)
    with pytest.raises(ValidationError):
        TransactionPatch(**{"updated_at": now, field: value})


def test_transaction_patch_omitted_fields_stay_out_of_fields_set():
    now = dt.datetime(2026, 9, 1, 18, 20, 0)
    patch = TransactionPatch(updated_at=now, amount=Decimal("-42"))
    assert "amount" in patch.model_fields_set
    assert "kind" not in patch.model_fields_set
    assert "category_l2" not in patch.model_fields_set


# ---------------------------------------------------------------------------
# transaction.py — TransactionItem / TransactionDetail
# ---------------------------------------------------------------------------


def test_transaction_item_amount_and_rate_digit_counts():
    tx = TransactionItem(**_tx_item_kwargs())
    data = json.loads(tx.model_dump_json())
    assert data["amount"] == "-45.5000"
    assert data["amount_base"] == "-377.5700"
    assert data["rate_used"] == "8.29824176"


def test_transaction_item_refunded_total_absent_when_unset():
    tx = TransactionItem(**_tx_item_kwargs())
    data = json.loads(tx.model_dump_json())
    assert "refunded_total" not in data
    assert "refundable" not in data
    # a field that is genuinely null (not "unset") must still serialize as null
    assert data["category_l2"] == "fresh_food"
    assert data["transfer_role"] is None
    assert "transfer_role" in data


def test_transaction_item_refunded_total_present_when_set():
    tx = TransactionItem(
        **_tx_item_kwargs(refunded_total=Decimal("15"), refundable=Decimal("30.5"))
    )
    data = json.loads(tx.model_dump_json())
    assert data["refunded_total"] == "15.0000"
    assert data["refundable"] == "30.5000"


def test_transaction_detail_inherits_and_extends_item():
    detail = TransactionDetail(
        **_tx_item_kwargs(),
        refunds=[
            RefundRef(
                id=UID(),
                occurred_at=dt.date(2026, 9, 4),
                amount=Decimal("10"),
                currency="EUR",
                note="退了一盒草莓",
                source_id=UID(),
            )
        ],
        refund_of_detail=None,
        pair=None,
        events=[
            EventItem(
                id=UID(),
                event="created",
                at=dt.datetime(2026, 9, 1, 18, 20, 0),
                actor_id=UID(),
                client="web",
                changes=None,
                import_batch_id=None,
            )
        ],
    )
    data = json.loads(detail.model_dump_json())
    assert data["refund_of_detail"] is None
    assert data["pair"] is None
    assert len(data["refunds"]) == 1
    assert data["events"][0]["event"] == "created"
    assert "refunded_total" not in data


def test_refund_origin_shape():
    origin = RefundOrigin(
        id=UID(),
        occurred_at=dt.date(2026, 9, 1),
        merchant="Carrefour",
        amount=Decimal("-45.5"),
        currency="EUR",
        source_id=UID(),
        category_l1="groceries",
        category_l2="fresh_food",
        refunded_total=Decimal("15"),
        refundable=Decimal("30.5"),
        other_refunds=[],
    )
    assert origin.refundable == Decimal("30.5000")


def test_pair_ref_renames_in_field_in_json():
    ref = PairRef(
        pair_id=UID(),
        out=PairLeg(transaction_id=UID(), source_id=UID(), amount=Decimal("-100"), currency="USD"),
        in_=PairLeg(transaction_id=UID(), source_id=UID(), amount=Decimal("720"), currency="CNY"),
    )
    data = json.loads(ref.model_dump_json())
    assert "in" in data
    assert "in_" not in data
    assert data["in"]["currency"] == "CNY"


def test_pair_ref_round_trips_through_its_own_alias_dump():
    """The ``in`` rename is a field alias, not a wrapping serializer, so the
    model must be able to re-validate its own ``by_alias`` dump (and a plain
    ``model_dump()``/``model_dump_json()``, since ``serialize_by_alias`` makes
    the alias the default) — an endpoint returning a hand-built dict with key
    ``"in"`` must not 500 with a ``ResponseValidationError``."""
    ref = PairRef(
        pair_id=UID(),
        out=PairLeg(transaction_id=UID(), source_id=UID(), amount=Decimal("-100"), currency="USD"),
        in_=PairLeg(transaction_id=UID(), source_id=UID(), amount=Decimal("720"), currency="CNY"),
    )
    assert "in" in ref.model_dump()
    round_tripped = PairRef.model_validate(ref.model_dump(by_alias=True))
    assert round_tripped == ref
    # A plain dict with the wire key also validates (service code building a
    # response body by hand, not just from another PairRef instance).
    from_dict = PairRef.model_validate(
        {"pair_id": ref.pair_id, "out": ref.out.model_dump(), "in": ref.in_.model_dump()}
    )
    assert from_dict == ref


def test_event_item_event_enum():
    now = dt.datetime(2026, 9, 1, 18, 20, 0)
    EventItem(
        id=UID(), event="refund_unlinked", at=now, actor_id=UID(), client=None,
        changes=None, import_batch_id=None,
    )
    with pytest.raises(ValidationError):
        EventItem(
            id=UID(), event="deleted", at=now, actor_id=UID(), client=None,
            changes=None, import_batch_id=None,
        )


def test_transaction_summary_and_list_response_shape():
    summary = TransactionSummary(
        base_currency="CNY",
        expense=Decimal("8421.66"),
        income=Decimal("0"),
        net=Decimal("-8338.68"),
        count=37,
        rate_missing_count=0,
    )
    listing = TransactionListResponse(items=[], total=37, summary=summary)
    data = json.loads(listing.model_dump_json())
    assert data["summary"]["expense"] == "8421.6600"
    assert data["total"] == 37


# ---------------------------------------------------------------------------
# transaction.py — TransferCreate / TransferPatch / TransferLeg / TransferResponse
# ---------------------------------------------------------------------------


def test_transfer_create_amounts_must_be_positive():
    with pytest.raises(ValidationError):
        TransferCreate(
            from_source_id=UID(),
            to_source_id=UID(),
            amount_out=Decimal("0"),
            occurred_at=dt.date.today(),
            subtype="plain",
        )
    with pytest.raises(ValidationError):
        TransferCreate(
            from_source_id=UID(),
            to_source_id=UID(),
            amount_out=Decimal("100"),
            amount_in=Decimal("-1"),
            occurred_at=dt.date.today(),
            subtype="plain",
        )


def test_transfer_create_currency_defaults_none_and_uppercases_when_given():
    xfer = TransferCreate(
        from_source_id=UID(),
        to_source_id=UID(),
        amount_out=Decimal("100"),
        currency_out="usd",
        occurred_at=dt.date.today(),
        subtype="plain",
    )
    assert xfer.currency_out == "USD"
    assert xfer.currency_in is None


def test_transfer_create_subtype_enum():
    with pytest.raises(ValidationError):
        TransferCreate(
            from_source_id=UID(),
            to_source_id=UID(),
            amount_out=Decimal("100"),
            occurred_at=dt.date.today(),
            subtype="installment",
        )


def test_transfer_patch_requires_updated_at():
    with pytest.raises(ValidationError):
        TransferPatch(note="x")


def test_transfer_patch_note_accepts_null_but_subtype_does_not():
    now = dt.datetime(2026, 9, 6, 12, 0, 0)
    patch = TransferPatch(updated_at=now, note=None)
    assert patch.note is None
    with pytest.raises(ValidationError):
        TransferPatch(updated_at=now, subtype=None)


def test_transfer_leg_full_field_shape_and_digits():
    leg = TransferLeg(
        id=UID(),
        source_id=UID(),
        kind="transfer",
        occurred_at=dt.date(2026, 9, 6),
        transfer_role="out",
        transfer_subtype="plain",
        amount=Decimal("-100"),
        currency="USD",
        counterparty=None,
        amount_base=Decimal("-724.5"),
        rate_used=Decimal("7.245"),
        rate_date=dt.date(2026, 9, 5),
        transfer_pair_id=UID(),
        note="换汇到人民币账户",
        created_at=dt.datetime(2026, 9, 6, 12, 0, 0),
        updated_at=dt.datetime(2026, 9, 6, 12, 0, 0),
    )
    data = json.loads(leg.model_dump_json())
    assert data["amount"] == "-100.0000"
    assert data["rate_used"] == "7.24500000"


def test_transfer_response_renames_in_field_and_pair_fields():
    out_leg = TransferLeg(
        id=UID(), source_id=UID(), kind="transfer", occurred_at=dt.date(2026, 9, 6),
        transfer_role="out", transfer_subtype="plain", amount=Decimal("-100"),
        currency="USD", counterparty=None, amount_base=Decimal("-724.5"),
        rate_used=Decimal("7.245"), rate_date=dt.date(2026, 9, 5),
        transfer_pair_id=UID(), note="备注",
        created_at=dt.datetime(2026, 9, 6, 12, 0, 0), updated_at=dt.datetime(2026, 9, 6, 12, 0, 0),
    )
    in_leg = out_leg.model_copy(update={"transfer_role": "in", "amount": Decimal("720")})
    resp = TransferResponse(
        pair_id=UID(), occurred_at=dt.date(2026, 9, 6), subtype="plain", note="备注",
        out=out_leg, in_=in_leg, updated_at=dt.datetime(2026, 9, 9, 6, 30, 0),
    )
    data = json.loads(resp.model_dump_json())
    assert "in" in data and "in_" not in data
    assert data["out"]["transfer_role"] == "out"
    assert data["in"]["transfer_role"] == "in"


def test_pair_request_shape():
    req = PairRequest(other_transaction_id=UID())
    assert isinstance(req.other_transaction_id, uuid.UUID)
    with pytest.raises(ValidationError):
        PairRequest(other_transaction_id=UID(), extra_field="nope")


def test_unpair_response_shape_is_leg_subset():
    resp = UnpairResponse(
        pair_id=UID(),
        unpaired=[
            UnpairedLeg(
                id=UID(), source_id=UID(), kind="transfer", transfer_role="out",
                transfer_subtype="plain", amount=Decimal("-100"), currency="USD",
                transfer_pair_id=None, counterparty=None,
                updated_at=dt.datetime(2026, 9, 10, 9, 0, 0),
            ),
        ],
    )
    data = json.loads(resp.model_dump_json())
    assert data["unpaired"][0]["transfer_pair_id"] is None
    assert "note" not in data["unpaired"][0]


# ---------------------------------------------------------------------------
# stats.py
# ---------------------------------------------------------------------------


def test_category_stat_children_allow_null_code():
    stat = CategoryStat(
        code="food",
        name_zh="餐饮",
        name_en="Food & Dining",
        amount=Decimal("2310.5"),
        share=0.2743,
        count=41,
        children=[
            SubStat(code="lunch", name_zh="午餐", name_en="Lunch", amount=Decimal("980"), count=22),
            SubStat(
                code=None, name_zh="未细分", name_en="Unspecified", amount=Decimal("200"), count=2
            ),
        ],
    )
    assert stat.children[1].code is None
    assert stat.share == 0.2743


def test_summary_response_shape_and_digits():
    resp = SummaryResponse(
        month="2026-09",
        base_currency="CNY",
        expense_total=Decimal("8421.66"),
        income_total=Decimal("23500"),
        net=Decimal("15078.34"),
        expense=[],
        income=[],
        refund_total=Decimal("82.98"),
        rate_missing_count=0,
    )
    data = json.loads(resp.model_dump_json())
    assert data["expense_total"] == "8421.6600"
    assert data["refund_total"] == "82.9800"
    assert data["month"] == "2026-09"


def test_trend_response_has_no_income_or_net_fields():
    resp = TrendResponse(
        base_currency="CNY",
        months=[MonthExpense(month="2026-09", expense=Decimal("8421.66"))],
        rate_missing_count=0,
    )
    data = json.loads(resp.model_dump_json())
    assert set(data.keys()) == {"base_currency", "months", "rate_missing_count"}
    assert "income" not in data["months"][0]
    assert data["months"][0]["expense"] == "8421.6600"


def test_month_expense_amount_out_of_precision_is_422_not_500():
    """Same shared ``Amount`` quantize guard as the transaction/source tests above."""
    with pytest.raises(ValidationError):
        MonthExpense(month="2026-09", expense=Decimal("1e40"))
