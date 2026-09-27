"""The 23 validation rules of 05 §2.8, plus §2.2/§2.3/§2.6/§2.7 (05 §7.2).

The validation path never touches the database, so none of these tests take a
db fixture: a RawFile and an ImportContext are all it takes.
"""
import uuid
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from app.core.categories import CATEGORY_VERSION
from app.core.clock import utcnow
from app.core.errors import ApiError
from app.services.importing.reading import RawFile, read_upload
from app.services.importing.validation import (
    COLUMNS,
    GUIDE_URL,
    ImportContext,
    ImportFormatInvalid,
    RowDraft,
    SkillOutdated,
    check_row_limit,
    check_shape,
    check_version,
    mask_pan,
    normalize_rows,
)

FIXTURES = Path(__file__).parent / "fixtures" / "import"
HEADER_LINE = ",".join(COLUMNS)
VERSION_LINE = f"# version: {CATEGORY_VERSION}"
TODAY = utcnow().date()

CREDIT_CNY = ImportContext(
    ledger_id=uuid.uuid4(),
    source_id=uuid.uuid4(),
    source_currency="CNY",
    source_type="credit",
    base_currency="CNY",
    actor_id=uuid.uuid4(),
    category_version=CATEGORY_VERSION,
)
CHECKING_CNY = ImportContext(
    ledger_id=CREDIT_CNY.ledger_id,
    source_id=uuid.uuid4(),
    source_currency="CNY",
    source_type="checking",
    base_currency="CNY",
    actor_id=CREDIT_CNY.actor_id,
    category_version=CATEGORY_VERSION,
)

DEFAULTS: dict[str, str] = {
    "date": "2026-08-03",
    "amount": "-128.00",
    "currency": "CNY",
    "kind": "expense",
    "transfer_role": "",
    "transfer_subtype": "",
    "merchant": "星巴克",
    "note": "",
    "category_l1": "food",
    "category_l2": "snacks_drinks",
    "source_ref": "p1:1",
}


def csv_field(value: str) -> str:
    if any(char in value for char in ',"\n'):
        return '"' + value.replace('"', '""') + '"'
    return value


def line(**overrides: str) -> str:
    """One data line: the defaults are all valid, overrides break one column."""
    values = {**DEFAULTS, **overrides}
    return ",".join(csv_field(values[column]) for column in COLUMNS)


def raw_of(*lines: str, version: str = VERSION_LINE, header: str = HEADER_LINE) -> RawFile:
    body = "\n".join([version, header, *lines]) + "\n"
    return read_upload(body.encode("utf-8"), "t.csv")


def one_row(ctx: ImportContext = CREDIT_CNY, **overrides: str) -> RowDraft:
    return normalize_rows(raw_of(line(**overrides)), ctx)[0]


def fixture_raw(name: str) -> RawFile:
    return read_upload((FIXTURES / name).read_bytes(), name)


# --- §2.2 structure (rules 1-4) --------------------------------------------


def test_rule_1_a_non_utf8_file_never_reaches_the_shape_check() -> None:
    with pytest.raises(ImportFormatInvalid) as excinfo:
        fixture_raw("bad_gbk.csv")

    assert excinfo.value.errors[0]["line"] == 1


def test_rule_2_missing_version_line_is_one_structure_error() -> None:
    with pytest.raises(ImportFormatInvalid) as excinfo:
        check_shape(fixture_raw("bad_no_version.csv"))

    error = excinfo.value
    assert error.status_code == 400
    assert error.code == "import_format_invalid"
    assert [item["line"] for item in error.errors] == [1]
    assert "# version:" in error.errors[0]["message"]
    assert "missing '# version:' line" in error.detail


def test_rule_3_extra_header_column_is_named() -> None:
    with pytest.raises(ImportFormatInvalid) as excinfo:
        check_shape(fixture_raw("bad_header_extra_col.csv"))

    errors = {item["line"]: item["message"] for item in excinfo.value.errors}
    assert 2 in errors
    assert "多出 counterparty" in errors[2]
    assert "缺少" not in errors[2]


def test_rule_3_missing_header_column_is_named() -> None:
    header = HEADER_LINE.replace(",transfer_subtype", "")
    with pytest.raises(ImportFormatInvalid) as excinfo:
        check_shape(raw_of(header=header))

    assert "缺少 transfer_subtype" in excinfo.value.errors[0]["message"]


def test_rule_3_reordered_header_reports_the_first_position() -> None:
    with pytest.raises(ImportFormatInvalid) as excinfo:
        check_shape(fixture_raw("bad_header_reordered.csv"))

    errors = excinfo.value.errors
    assert [item["line"] for item in errors] == [2]
    assert "第 2 列应为 amount，实际为 currency" in errors[0]["message"]


def test_rule_4_every_ragged_row_is_reported_at_once() -> None:
    with pytest.raises(ImportFormatInvalid) as excinfo:
        check_shape(fixture_raw("bad_ragged.csv"))

    error = excinfo.value
    assert [item["line"] for item in error.errors] == [14, 27]
    assert "有 10 列" in error.errors[0]["message"]
    assert "有 12 列" in error.errors[1]["message"]
    assert "2 problem(s)" in error.detail


def test_rule_4_the_error_list_is_capped_and_the_rest_counted() -> None:
    bad = "2026-08-03,-1.00,CNY,expense,,,店,,food,lunch"  # 10 columns
    with pytest.raises(ImportFormatInvalid) as excinfo:
        check_shape(raw_of(*[bad] * 60))

    error = excinfo.value
    assert len(error.errors) == 50
    assert "60 problem(s)" in error.detail
    assert "10 more not listed" in error.detail


def test_a_valid_file_passes_the_shape_check() -> None:
    for name in ("ok_credit_cny.csv", "ok_checking_sgd.csv", "ok_bom.csv", "ok_crlf.csv"):
        check_shape(fixture_raw(name))


# --- §2.3 version (rule 5) --------------------------------------------------


def test_rule_5_matching_version_is_returned() -> None:
    assert check_version(fixture_raw("ok_credit_cny.csv"), CATEGORY_VERSION) == CATEGORY_VERSION


def test_rule_5_stale_version_carries_both_versions_and_the_guide() -> None:
    raw = fixture_raw("stale_version.csv")
    check_shape(raw)

    with pytest.raises(SkillOutdated) as excinfo:
        check_version(raw, CATEGORY_VERSION)

    error = excinfo.value
    assert error.status_code == 400
    assert error.code == "skill_outdated"
    assert error.body() == {
        "detail": error.detail,
        "code": "skill_outdated",
        "current_version": CATEGORY_VERSION,
        "file_version": "2026-08-20",
        # The service layer carries the path *template*; `app/api/imports.py`
        # fills `{ledger_id}` in, because only it knows which ledger (04 §4.10).
        "guide_url": GUIDE_URL,
    }
    assert GUIDE_URL == "/imports/guide"  # §14.66: the page path carries no ledger id


def test_missing_version_line_is_not_skill_outdated() -> None:
    """Decision §14.53d: a missing line is a structure error, not a stale skill."""
    with pytest.raises(ImportFormatInvalid):
        check_version(fixture_raw("bad_no_version.csv"), CATEGORY_VERSION)


# --- §2.6 limits (rule 6) ---------------------------------------------------


def test_rule_6_two_thousand_rows_pass() -> None:
    raw = fixture_raw("ok_2000_rows.csv")
    check_shape(raw)
    check_row_limit(raw)

    assert len(normalize_rows(raw, CREDIT_CNY)) == 2000


def test_rule_6_two_thousand_and_one_rows_are_refused() -> None:
    raw = fixture_raw("bad_2001_rows.csv")
    check_shape(raw)

    with pytest.raises(ApiError) as excinfo:
        normalize_rows(raw, CREDIT_CNY)

    assert excinfo.value.status_code == 400
    assert excinfo.value.code == "rows_exceed_limit"
    assert "2001" in excinfo.value.detail


# --- §2.4 row rules (rules 7-22) -------------------------------------------


@pytest.mark.parametrize(
    "value, expected",
    [
        ("2026-08-03", date(2026, 8, 3)),
        ((TODAY + timedelta(days=1)).isoformat(), TODAY + timedelta(days=1)),
    ],
    ids=["plain", "tomorrow"],
)
def test_rule_7_good_dates_are_kept(value: str, expected: date) -> None:
    row = one_row(date=value)

    assert row.occurred_at == expected
    assert row.flags == set()
    assert row.hint is None


@pytest.mark.parametrize(
    "value, fragment",
    [
        ("03/08/2026", "不是 YYYY-MM-DD"),
        ("2026-02-30", "不是 YYYY-MM-DD"),
        ("8月3日", "不是 YYYY-MM-DD"),
        ("", "不是 YYYY-MM-DD"),
        ("1998-01-01", "超出可记账范围"),
        ((TODAY + timedelta(days=2)).isoformat(), "超出可记账范围"),
    ],
    ids=["dd/mm", "no-such-day", "chinese", "empty", "too-old", "too-far"],
)
def test_rules_7_and_8_bad_dates_are_blanked_and_flagged(value: str, fragment: str) -> None:
    row = one_row(date=value)

    assert row.occurred_at is None
    assert "needs_review" in row.flags
    assert fragment in (row.hint or "")


@pytest.mark.parametrize(
    "value, expected",
    [("-128.00", "-128.0000"), ("-1,234.56", "-1234.5600"), ("-0.1234", "-0.1234")],
    ids=["plain", "thousands", "four-decimals"],
)
def test_rule_9_good_amounts_are_kept(value: str, expected: str) -> None:
    row = one_row(amount=value)

    assert row.amount == Decimal(expected)
    assert row.hint is None


@pytest.mark.parametrize(
    "value", ["¥128.00", "(128.00)", "1234.56 DR", "1.23456", "abc", ""]
)
def test_rule_9_unparsable_amounts_become_zero(value: str) -> None:
    row = one_row(amount=value)

    assert row.amount == Decimal("0")
    assert "needs_review" in row.flags
    assert "不是数字" in (row.hint or "")


def test_rule_10_a_zero_amount_is_kept_and_flagged() -> None:
    row = one_row(amount="0")

    assert row.amount == Decimal("0")
    assert "needs_review" in row.flags
    assert "金额为 0" in (row.hint or "")


def test_rule_11_an_absurd_amount_is_kept_and_flagged() -> None:
    row = one_row(amount="-999999999999", kind="expense")

    assert row.amount == Decimal("-999999999999")
    assert "needs_review" in row.flags
    assert "异常大" in (row.hint or "")


@pytest.mark.parametrize(
    "value, expected", [("CNY", "CNY"), ("cny", "CNY"), ("XYZ", "XYZ"), ("rmb", "RMB")]
)
def test_rule_12_three_letter_codes_are_kept(value: str, expected: str) -> None:
    """§2.4 ③: upper-case first, then match; realness is not checked here.

    §7.2's table lists `rmb` as invalid, which contradicts the same section's
    "lower-case three letters are upper-cased first" rule and rule 12 of §2.8;
    the syntactic rule wins (see the task notes).
    """
    row = one_row(currency=value)

    assert row.currency == expected
    assert row.flags == set()
    assert row.hint is None


@pytest.mark.parametrize("value", ["", "人民币", "CNY￥", "CN"])
def test_rule_12_bad_currencies_fall_back_to_the_account(value: str) -> None:
    row = one_row(currency=value)

    assert row.currency == "CNY"
    assert "needs_review" in row.flags
    assert "已改为账户币种 CNY" in (row.hint or "")


@pytest.mark.parametrize(
    "value, amount, expected",
    [("payment", "-88.00", "expense"), ("支出", "88.00", "income"), ("", "-1.00", "expense")],
    ids=["payment", "chinese", "empty"],
)
def test_rule_13_an_unknown_kind_follows_the_sign(
    value: str, amount: str, expected: str
) -> None:
    row = one_row(kind=value, amount=amount, category_l1="", category_l2="")

    assert row.kind == expected
    assert "needs_review" in row.flags
    assert "无法识别" in (row.hint or "")


@pytest.mark.parametrize(
    "kind, amount, expected, fragment",
    [
        ("expense", "32", "-32.0000", "已改为 -32.00"),
        ("refund", "-32", "32.0000", "已改为 32.00"),
        ("income", "-32", "32.0000", "已改为 32.00"),
    ],
    ids=["expense-positive", "refund-negative", "income-negative"],
)
def test_rule_14_the_sign_follows_the_kind(
    kind: str, amount: str, expected: str, fragment: str
) -> None:
    category = {"category_l1": "salary", "category_l2": "base_salary"} if kind == "income" else {}
    row = one_row(kind=kind, amount=amount, **category)

    assert row.amount == Decimal(expected)
    assert "needs_review" in row.flags
    assert fragment in (row.hint or "")


def test_rule_14_a_transfer_leg_follows_its_role() -> None:
    row = one_row(
        kind="transfer",
        transfer_role="in",
        transfer_subtype="repayment",
        amount="-3000",
        category_l1="",
        category_l2="",
    )

    assert row.amount == Decimal("3000")
    assert "needs_review" in row.flags


@pytest.mark.parametrize(
    "amount, expected", [("-500.00", "out"), ("500.00", "in")], ids=["out", "in"]
)
def test_rule_15_a_missing_transfer_role_follows_the_sign(
    amount: str, expected: str
) -> None:
    row = one_row(
        ctx=CHECKING_CNY,
        kind="transfer",
        transfer_role="",
        transfer_subtype="plain",
        amount=amount,
        category_l1="",
        category_l2="",
        merchant="",
    )

    assert row.transfer_role == expected
    assert "needs_review" in row.flags
    assert "转账方向" in (row.hint or "")


def test_rule_16_credit_card_incoming_transfer_defaults_to_repayment() -> None:
    row = one_row(
        kind="transfer",
        transfer_role="in",
        transfer_subtype="",
        amount="3000.00",
        category_l1="",
        category_l2="",
        merchant="",
    )

    assert row.transfer_subtype == "repayment"
    assert row.flags == set()
    assert row.hint is None


def test_rule_16_everything_else_defaults_to_plain_with_a_flag() -> None:
    row = one_row(
        ctx=CHECKING_CNY,
        kind="transfer",
        transfer_role="out",
        transfer_subtype="",
        amount="-500.00",
        category_l1="",
        category_l2="",
        merchant="",
    )

    assert row.transfer_subtype == "plain"
    assert "needs_review" in row.flags
    assert "已按普通划转" in (row.hint or "")


def test_rule_17_a_non_transfer_loses_both_transfer_columns() -> None:
    row = one_row(transfer_role="out", transfer_subtype="plain")

    assert row.transfer_role is None
    assert row.transfer_subtype is None
    assert row.flags == set()
    assert "已清空" in (row.hint or "")


@pytest.mark.parametrize(
    "kind, l1, l2, expected, fragment",
    [
        ("expense", "dining", "", (None, None), "不在支出分类表里"),
        ("income", "food", "lunch", (None, None), "不在收入分类表里"),
        ("expense", "food", "taxi", ("food", None), "不属于"),
        ("expense", "", "lunch", (None, None), "已清空"),
        ("transfer", "food", "lunch", (None, None), "转账不记分类"),
    ],
    ids=["rule-18", "rule-18-side", "rule-19", "rule-18b", "rule-20"],
)
def test_rules_18_to_20_bad_categories_are_cleared_but_not_flagged(
    kind: str, l1: str, l2: str, expected: tuple, fragment: str
) -> None:
    row = one_row(
        kind=kind,
        category_l1=l1,
        category_l2=l2,
        amount="30.00" if kind == "income" else "-30.00",
        transfer_role="out" if kind == "transfer" else "",
        transfer_subtype="plain" if kind == "transfer" else "",
    )

    assert (row.category_l1, row.category_l2) == expected
    assert "needs_review" not in row.flags
    assert fragment in (row.hint or "")


def test_an_empty_category_is_left_alone() -> None:
    row = one_row(category_l1="", category_l2="")

    assert (row.category_l1, row.category_l2) == (None, None)
    assert row.flags == set()
    assert row.hint is None


def test_rule_21_long_text_is_truncated() -> None:
    row = one_row(merchant="商" * 260, note="备" * 600, source_ref="r" * 140)

    assert len(row.merchant or "") == 200
    assert len(row.note or "") == 500
    assert len(row.source_ref or "") == 100
    assert "已截断" in (row.hint or "")
    assert "needs_review" not in row.flags


def test_blank_text_becomes_none() -> None:
    row = one_row(merchant="  ", note="", source_ref=" ")

    assert (row.merchant, row.note, row.source_ref) == (None, None, None)


def test_rule_22_a_card_number_keeps_only_its_last_four_digits() -> None:
    row = one_row(merchant="超市 6225880212341235", note="卡号 6225-8802-1234-1235")

    assert row.merchant == "超市 ************1235"
    assert row.note == "卡号 ************1235"
    assert row.flags == set()


def test_rule_22_non_card_digit_runs_are_left_alone() -> None:
    # Both fail Luhn: an order number, and the card number 05 §7.1 quotes.
    row = one_row(note="订单号 1234567890123456789 / 6225880212341234", source_ref="r" * 16)

    assert row.note == "订单号 1234567890123456789 / 6225880212341234"


def test_rule_22_source_ref_is_never_masked() -> None:
    """§6.2: source_ref is a position reference and never reaches a transaction."""
    row = one_row(source_ref="6225880212341235")

    assert row.source_ref == "6225880212341235"


@pytest.mark.parametrize(
    "text, expected",
    [
        (None, None),
        ("", ""),
        ("4111111111111111", "************1111"),
        ("4111 1111 1111 1111", "************1111"),
        ("1234567890123", "1234567890123"),
    ],
)
def test_mask_pan_directly(text: str | None, expected: str | None) -> None:
    assert mask_pan(text) == expected


# --- §2.7 intra-batch duplicates (rule 23) ---------------------------------


def test_rule_23_identical_rows_are_all_kept_and_cross_named() -> None:
    rows = normalize_rows(fixture_raw("dirty_rows.csv"), CREDIT_CNY)
    duplicates = [row for row in rows if row.row_no in (3, 7)]

    assert len(rows) == 14
    assert len(duplicates) == 2
    for row in duplicates:
        assert "needs_review" in row.flags
        assert "本批内有相同的行（第 3、7 行）" in (row.hint or "")


def test_rows_differing_only_in_source_ref_are_not_duplicates() -> None:
    rows = normalize_rows(raw_of(line(source_ref="a"), line(source_ref="b")), CREDIT_CNY)

    assert all(row.flags == set() for row in rows)


# --- dirty_rows.csv, row by row (§7.1) -------------------------------------


@pytest.mark.parametrize(
    "row_no, fragment",
    [
        (1, "不是 YYYY-MM-DD"),
        (2, "不是数字"),
        (4, "金额为 0"),
        (6, "无法识别"),
        (8, "已改为 -32.00"),
        (9, "转账方向为空"),
        (10, "不在支出分类表里"),
        (11, "不属于"),
        (12, "不在收入分类表里"),
        (13, "转账不记分类"),
        (14, "已改为账户币种 CNY"),
    ],
)
def test_dirty_rows_each_problem_lands_on_its_own_row(row_no: int, fragment: str) -> None:
    rows = {row.row_no: row for row in normalize_rows(fixture_raw("dirty_rows.csv"), CREDIT_CNY)}

    assert fragment in (rows[row_no].hint or "")


def test_dirty_rows_are_corrected_not_dropped() -> None:
    rows = normalize_rows(fixture_raw("dirty_rows.csv"), CREDIT_CNY)

    assert [row.row_no for row in rows] == list(range(1, 15))
    assert rows[5].note == "卡号 ************1235"  # row 6: masked (§6.2)
    assert rows[5].kind == "expense"
    assert rows[7].amount == Decimal("-32")  # row 8: sign flipped to match kind
    assert rows[8].transfer_role == "out"  # row 9: role inferred from the sign
    assert rows[12].category_l1 is None  # row 13: a transfer keeps no category


def test_row_no_counts_data_rows_not_physical_lines() -> None:
    """02 §1.8: row_no starts at 1 on the first data row (physical line 3)."""
    raw = fixture_raw("ok_crlf.csv")
    rows = normalize_rows(raw, CREDIT_CNY)

    assert [row.row_no for row in rows] == [1, 2, 3]
    assert raw.row_numbers == [3, 4, 6]


# --- the good fixtures normalize cleanly -----------------------------------


def test_ok_credit_cny_needs_no_correction() -> None:
    raw = fixture_raw("ok_credit_cny.csv")
    check_shape(raw)
    check_version(raw, CATEGORY_VERSION)
    rows = normalize_rows(raw, CREDIT_CNY)

    assert [row.hint for row in rows] == [None] * 6
    assert all(row.flags == set() for row in rows)
    assert rows[3].kind == "refund"
    assert rows[3].amount == Decimal("299")
    assert (rows[3].category_l1, rows[3].category_l2) == (None, None)
    assert rows[5].transfer_role == "in"
    assert rows[5].transfer_subtype == "repayment"


def test_ok_checking_sgd_needs_no_correction() -> None:
    raw = fixture_raw("ok_checking_sgd.csv")
    check_shape(raw)
    ctx = ImportContext(
        ledger_id=CHECKING_CNY.ledger_id,
        source_id=CHECKING_CNY.source_id,
        source_currency="SGD",
        source_type="checking",
        base_currency="CNY",
        actor_id=CHECKING_CNY.actor_id,
        category_version=CATEGORY_VERSION,
    )
    rows = normalize_rows(raw, ctx)

    assert all(row.hint is None and row.flags == set() for row in rows)
    assert {row.currency for row in rows} == {"SGD"}
    assert [row.transfer_subtype for row in rows[5:]] == ["repayment", "plain", "plain"]


def test_every_draft_starts_with_the_fields_review_fills_in() -> None:
    row = one_row()

    assert row.counterparty is None
    assert row.matched_transaction_id is None
    assert row.counterpart_source_id is None


def test_import_context_carries_no_statement_content() -> None:
    """§6.3: the context is logged, so it may hold ids and currencies only."""
    fields = set(ImportContext.__dataclass_fields__)

    assert fields == {
        "ledger_id",
        "source_id",
        "source_currency",
        "source_type",
        "base_currency",
        "actor_id",
        "category_version",
    }
