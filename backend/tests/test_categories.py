"""Tests for the frozen category constants (decision §1.3, 03 §1.2/§5.5/§5.7)."""
import pytest

from app.core.categories import (
    ALL_L1_CODES,
    CATEGORY_VERSION,
    EXPENSE_CATEGORIES,
    INCOME_CATEGORIES,
    category_side,
    category_table,
    find,
    render_skill_categories,
    validate_category,
)


def test_top_level_counts():
    assert len(EXPENSE_CATEGORIES) == 16
    assert len(INCOME_CATEGORIES) == 6
    assert len(ALL_L1_CODES) == 22


def test_all_codes_globally_unique():
    codes = []
    for cat in EXPENSE_CATEGORIES + INCOME_CATEGORIES:
        codes.append(cat.code)
        for child in cat.children:
            codes.append(child.code)
    assert len(codes) == len(set(codes)), "duplicate category code found"


def test_l1_desc_non_empty_l2_desc_none():
    for cat in EXPENSE_CATEGORIES + INCOME_CATEGORIES:
        assert cat.desc_zh, f"{cat.code} missing desc_zh"
        assert cat.desc_en, f"{cat.code} missing desc_en"
        for child in cat.children:
            assert child.desc_zh is None, f"{child.code} should have desc_zh=None"
            assert child.desc_en is None, f"{child.code} should have desc_en=None"


def test_groceries_has_household_named_daily_supplies():
    groceries = find("groceries")
    assert groceries is not None
    household = next((c for c in groceries.children if c.code == "household"), None)
    assert household is not None
    assert household.name_zh == "日用杂货"


def test_shopping_has_other_goods():
    shopping = find("shopping")
    assert shopping is not None
    codes = [c.code for c in shopping.children]
    assert "other_goods" in codes


def test_no_misc_goods_anywhere():
    all_codes = set(ALL_L1_CODES)
    for cat in EXPENSE_CATEGORIES + INCOME_CATEGORIES:
        for child in cat.children:
            all_codes.add(child.code)
    assert "misc_goods" not in all_codes


def test_salary_children():
    salary = find("salary")
    assert salary is not None
    assert [c.code for c in salary.children] == ["base_salary", "bonus", "rsu"]


@pytest.mark.parametrize("code", ["side_income", "reimbursement", "other_income"])
def test_no_l2_categories(code):
    cat = find(code)
    assert cat is not None
    assert cat.children == ()


def test_category_side():
    assert category_side("food") == "expense"
    assert category_side("groceries") == "expense"
    assert category_side("salary") == "income"
    assert category_side("investment") == "income"
    assert category_side("nonexistent_code") is None


def test_validate_category_transfer_with_category_rejected():
    with pytest.raises(Exception) as exc_info:
        validate_category("transfer", "food", None)
    assert exc_info.value.code == "category_invalid"


def test_validate_category_expense_missing_l1_rejected():
    with pytest.raises(Exception) as exc_info:
        validate_category("expense", None, None)
    assert exc_info.value.code == "category_invalid"


def test_validate_category_l2_not_belonging_to_l1_rejected():
    with pytest.raises(Exception) as exc_info:
        validate_category("expense", "food", "electronics")
    assert exc_info.value.code == "category_invalid"


def test_validate_category_income_with_expense_category_rejected():
    with pytest.raises(Exception) as exc_info:
        validate_category("income", "food", None)
    assert exc_info.value.code == "category_kind_mismatch"


def test_validate_category_refund_with_expense_category_passes():
    validate_category("refund", "food", "lunch")  # should not raise


def test_validate_category_expense_l1_only_passes():
    validate_category("expense", "food", None)  # should not raise


def test_validate_category_unknown_kind_rejected():
    with pytest.raises(Exception) as exc_info:
        validate_category("foo", "food", None)
    assert exc_info.value.code == "category_invalid"


def test_category_table_shape():
    table = category_table()
    assert table["version"] == CATEGORY_VERSION
    assert set(table.keys()) == {"version", "expense", "income"}
    assert len(table["expense"]) == 16
    assert len(table["income"]) == 6

    food = next(c for c in table["expense"] if c["code"] == "food")
    assert food["name_zh"] == "餐饮"
    assert food["name_en"] == "Food & Dining"
    assert food["desc_zh"]
    assert food["desc_en"]
    assert isinstance(food["children"], list)
    assert len(food["children"]) == 5
    for child in food["children"]:
        assert child["desc_zh"] is None
        assert child["desc_en"] is None
        assert child["children"] == []

    side_income = next(c for c in table["income"] if c["code"] == "side_income")
    assert side_income["children"] == []


def test_render_skill_categories_zh_has_codes_and_desc_zh():
    text = render_skill_categories("zh")
    assert "支出：" in text
    assert "收入：" in text
    for cat in EXPENSE_CATEGORIES + INCOME_CATEGORIES:
        assert cat.code in text
        assert cat.desc_zh in text


def test_render_skill_categories_en_has_desc_en():
    text = render_skill_categories("en")
    for cat in EXPENSE_CATEGORIES + INCOME_CATEGORIES:
        assert cat.code in text
        assert cat.desc_en in text
