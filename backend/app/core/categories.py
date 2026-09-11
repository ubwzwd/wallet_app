"""Frozen category constants (decision §1.3).

Categories are a code constant, not user/database data: no management API, no
management page. `l1`/`l2` codes are stored on `transactions.category_l1` /
`category_l2`. Changing meaning requires a code change plus a data migration
and a `CATEGORY_VERSION` bump (decision §1.3, §14.21, §14.30).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

# Content version of the category table (decision §14.30). Bump this whenever
# the table changes: added/removed categories, display names, or desc_zh/desc_en.
# It is also the skill's "# version:" line and the import's hard-check value.
CATEGORY_VERSION: str = "2026-09-10"


@dataclass(frozen=True)
class Category:
    code: str
    name_zh: str
    name_en: str
    # Classification criteria / where easily-confused items belong.
    # Only present on l1 categories; always None on l2 (decision §14.21).
    desc_zh: str | None = None
    desc_en: str | None = None
    children: tuple["Category", ...] = field(default_factory=tuple)


def _l2(code: str, name_zh: str, name_en: str) -> Category:
    """Build a leaf (l2) category: no desc, no children."""
    return Category(code=code, name_zh=name_zh, name_en=name_en)


EXPENSE_CATEGORIES: tuple[Category, ...] = (
    Category(
        code="clothing",
        name_zh="服饰",
        name_en="Clothing",
        desc_zh="穿在身上的：衣服、鞋、包、配饰。运动装备也算这里；童装归育儿",
        desc_en=(
            "What you wear: clothes, shoes, bags, accessories. Sportswear too; "
            "kids' clothes go under Childcare"
        ),
        children=(
            _l2("clothes", "衣服", "Clothes"),
            _l2("shoes", "鞋子", "Shoes"),
            _l2("bags", "包", "Bags"),
            _l2("accessories", "配饰", "Accessories"),
        ),
    ),
    Category(
        code="food",
        name_zh="餐饮",
        name_en="Food & Dining",
        desc_zh="日常吃喝：堂食、外卖、咖啡奶茶、零食。旅途中的吃喝归旅游",
        desc_en=(
            "Everyday eating and drinking, incl. delivery, coffee, snacks. "
            "Meals on trips go under Travel"
        ),
        children=(
            _l2("breakfast", "早餐", "Breakfast"),
            _l2("lunch", "午餐", "Lunch"),
            _l2("dinner", "晚餐", "Dinner"),
            _l2("late_snack", "夜宵", "Late-night Snack"),
            _l2("snacks_drinks", "零食饮料", "Snacks & Drinks"),
        ),
    ),
    Category(
        code="housing",
        name_zh="居住",
        name_en="Housing",
        desc_zh="住的固定大头：房租、房贷。水电物业归固定支出",
        desc_en="Rent and mortgage. Utilities and property fees go under Bills",
        children=(
            _l2("rent", "房租", "Rent"),
            _l2("mortgage", "房贷", "Mortgage"),
        ),
    ),
    Category(
        code="transport",
        name_zh="交通",
        name_en="Transport",
        desc_zh="日常出行：公交地铁、打车、加油、停车、火车飞机。旅游期间的交通归旅游",
        desc_en="Daily getting around. Transport during trips goes under Travel",
        children=(
            _l2("public_transit", "公交地铁", "Public Transit"),
            _l2("taxi", "打车", "Taxi & Ride-hailing"),
            _l2("fuel", "加油", "Fuel"),
            _l2("parking", "停车", "Parking"),
            _l2("train", "火车", "Train"),
            _l2("flight", "飞机", "Flight"),
        ),
    ),
    Category(
        code="health",
        name_zh="健康",
        name_en="Health",
        desc_zh="自己的看病买药、体检、保健品、健身。宠物和孩子的医疗各归宠物、育儿",
        desc_en=(
            "Your own medical care, checkups, supplements, fitness. Pets' and "
            "kids' care go to their own categories"
        ),
        children=(
            _l2("medical", "看病", "Medical"),
            _l2("medicine", "买药", "Medicine"),
            _l2("checkup", "体检", "Checkup"),
            _l2("wellness", "保健", "Wellness"),
            _l2("fitness", "健身", "Fitness"),
        ),
    ),
    Category(
        code="entertainment",
        name_zh="娱乐",
        name_en="Entertainment",
        desc_zh="玩乐：电影、游戏、KTV、酒吧、桌游密室。视频音乐订阅归精神文化",
        desc_en=(
            "Fun: movies, games, karaoke, bars, board games. Streaming "
            "subscriptions go under Culture & Learning"
        ),
        children=(
            _l2("movies", "电影", "Movies"),
            _l2("games", "游戏", "Games"),
            _l2("ktv", "KTV", "KTV"),
            _l2("outing", "出去玩", "Outing"),
        ),
    ),
    Category(
        code="groceries",
        name_zh="生活购物",
        name_en="Groceries & Household",
        desc_zh=(
            "消耗品和家里的日常运转：买菜、洗护清洁、厨房用品、纸巾垃圾袋等日用杂货。"
            "判据：用完就没了"
        ),
        desc_en=(
            "Consumables that keep the household running: groceries, toiletries, "
            "kitchen and household supplies. Test: it gets used up"
        ),
        children=(
            _l2("fresh_food", "买菜", "Fresh Food"),
            _l2("toiletries", "洗护清洁", "Toiletries & Cleaning"),
            _l2("kitchenware", "厨房用品", "Kitchenware"),
            _l2("household", "日用杂货", "Household Supplies"),
        ),
    ),
    Category(
        code="shopping",
        name_zh="消费购物",
        name_en="Shopping",
        desc_zh="耐用品和一次性大件：数码、家电、家具、行李箱工具等。判据：买一次用几年",
        desc_en=(
            "Durable and one-off purchases: electronics, appliances, furniture, "
            "luggage, tools. Test: bought once, used for years"
        ),
        children=(
            _l2("electronics", "数码", "Electronics"),
            _l2("appliances", "家电", "Appliances"),
            _l2("furniture", "家具", "Furniture"),
            _l2("other_goods", "其他物件", "Other Goods"),
        ),
    ),
    Category(
        code="pet",
        name_zh="宠物",
        name_en="Pets",
        desc_zh="宠物的吃、用、看病",
        desc_en="Everything for pets: food, supplies, vet",
        children=(
            _l2("pet_food", "宠物粮", "Pet Food"),
            _l2("pet_medical", "宠物医疗", "Pet Medical"),
            _l2("pet_supplies", "宠物用品", "Pet Supplies"),
        ),
    ),
    Category(
        code="childcare",
        name_zh="育儿",
        name_en="Childcare",
        desc_zh="孩子的一切：奶粉尿布、玩具、教育、衣物、医疗",
        desc_en="Everything for the kids: formula, diapers, toys, education, clothes, medical",
        children=(
            _l2("formula_diapers", "奶粉尿布", "Formula & Diapers"),
            _l2("toys", "玩具", "Toys"),
            _l2("education", "教育", "Education"),
            _l2("kids_clothes", "衣物", "Kids' Clothes"),
            _l2("kids_medical", "医疗", "Medical"),
        ),
    ),
    Category(
        code="parents",
        name_zh="父母",
        name_en="Parents",
        desc_zh="给父母的：孝敬钱、礼物、医疗",
        desc_en="For your parents: allowances, gifts, medical",
        children=(
            _l2("filial", "孝敬", "Filial Support"),
            _l2("gifts", "礼物", "Gifts"),
            _l2("parents_medical", "医疗", "Medical"),
        ),
    ),
    Category(
        code="bills",
        name_zh="固定支出",
        name_en="Bills & Utilities",
        desc_zh="每月固定的账单：水、电、燃气、物业、宽带、话费。房租房贷归居住",
        desc_en=(
            "Recurring monthly bills: water, electricity, gas, property fee, "
            "internet, mobile. Rent and mortgage go under Housing"
        ),
        children=(
            _l2("water", "水费", "Water"),
            _l2("electricity", "电费", "Electricity"),
            _l2("gas", "燃气", "Gas"),
            _l2("property_fee", "物业", "Property Fee"),
            _l2("internet", "宽带", "Internet"),
            _l2("mobile", "话费", "Mobile"),
        ),
    ),
    Category(
        code="culture",
        name_zh="精神文化支出",
        name_en="Culture & Learning",
        desc_zh="学习和精神消费：书、课程、文具、知识付费、展览、视频音乐订阅",
        desc_en=(
            "Learning and culture: books, courses, stationery, paid content, "
            "exhibitions, streaming subscriptions"
        ),
        children=(
            _l2("books", "书籍", "Books"),
            _l2("courses", "课程", "Courses"),
            _l2("stationery", "文具", "Stationery"),
            _l2("paid_content", "知识付费", "Paid Content"),
            _l2("exhibitions", "展览", "Exhibitions"),
            _l2("subscriptions", "订阅", "Subscriptions"),
        ),
    ),
    Category(
        code="travel",
        name_zh="旅游",
        name_en="Travel",
        desc_zh="离开常住地的旅程中的一切：机票、酒店、门票、当地交通、旅途餐饮",
        desc_en=(
            "Everything on a trip away from home: flights, hotels, tickets, "
            "local transport, meals"
        ),
        children=(
            _l2("flights", "机票", "Flights"),
            _l2("hotels", "酒店", "Hotels"),
            _l2("tickets", "门票", "Tickets"),
            _l2("local_transport", "当地交通", "Local Transport"),
            _l2("travel_food", "旅游餐饮", "Travel Food"),
        ),
    ),
    Category(
        code="social",
        name_zh="人情往来",
        name_en="Social & Gifts",
        desc_zh="花在别人身上的：红包礼金、请客、借出、转给他人。给父母的归父母",
        desc_en=(
            "Spent on other people: gifts and red packets, treating, lending, "
            "transfers to others. Parents have their own category"
        ),
        children=(
            _l2("red_packet", "红包礼金", "Red Packet & Gifts"),
            _l2("treat", "请客", "Treat"),
            _l2("lend", "借出", "Lend"),
            _l2("transfer_out", "转给他人", "Transfer to Others"),
        ),
    ),
    Category(
        code="other",
        name_zh="其他",
        name_en="Other",
        desc_zh="归不进上面任何一类的：罚款、手续费、年费",
        desc_en="Anything that fits nowhere above: fines, fees, annual charges",
        children=(
            _l2("fines", "罚款", "Fines"),
            _l2("fees", "手续费", "Fees"),
        ),
    ),
)

INCOME_CATEGORIES: tuple[Category, ...] = (
    Category(
        code="salary",
        name_zh="工资",
        name_en="Salary",
        desc_zh="雇主发的钱：基本工资、奖金、RSU",
        desc_en="From your employer: base salary, bonus, RSU",
        children=(
            _l2("base_salary", "基本工资", "Base Salary"),
            _l2("bonus", "奖金", "Bonus"),
            _l2("rsu", "RSU", "RSU"),
        ),
    ),
    Category(
        code="side_income",
        name_zh="兼职",
        name_en="Side Income",
        desc_zh="主业之外的劳务收入",
        desc_en="Income from work outside your main job",
    ),
    Category(
        code="investment",
        name_zh="理财",
        name_en="Investment",
        desc_zh="钱生的钱：利息、分红、基金赎回收益",
        desc_en="Money earned by money: interest, dividends, fund gains",
        children=(
            _l2("interest", "利息", "Interest"),
            _l2("dividend", "分红", "Dividend"),
            _l2("fund", "基金", "Fund"),
        ),
    ),
    Category(
        code="reimbursement",
        name_zh="报销",
        name_en="Reimbursement",
        desc_zh="垫付后收回的钱",
        desc_en="Money paid back to you after you covered a cost",
    ),
    Category(
        code="social_income",
        name_zh="人情往来",
        name_en="Social & Gifts",
        desc_zh="别人给的：红包礼金、借入、他人转入",
        desc_en="From other people: red packets and gifts, loans received, transfers in",
        children=(
            _l2("red_packet_in", "红包礼金", "Red Packet & Gifts"),
            _l2("borrow", "借入", "Borrow"),
            _l2("transfer_in", "他人转入", "Transfer from Others"),
        ),
    ),
    Category(
        code="other_income",
        name_zh="其他",
        name_en="Other",
        desc_zh="归不进上面任何一类的收入",
        desc_en="Income that fits nowhere above",
    ),
)


def _iter_all(categories: tuple[Category, ...]):
    for cat in categories:
        yield cat
        yield from cat.children


ALL_L1_CODES: tuple[str, ...] = tuple(
    cat.code for cat in EXPENSE_CATEGORIES + INCOME_CATEGORIES
)

# Internal lookup maps built once at import time.
_L1_BY_CODE: dict[str, Category] = {cat.code: cat for cat in EXPENSE_CATEGORIES + INCOME_CATEGORIES}
_SIDE_BY_L1: dict[str, Literal["expense", "income"]] = {
    **{cat.code: "expense" for cat in EXPENSE_CATEGORIES},
    **{cat.code: "income" for cat in INCOME_CATEGORIES},
}


def find(l1_code: str) -> Category | None:
    """Look up an l1 category by code; None if it doesn't exist."""
    return _L1_BY_CODE.get(l1_code)


def category_side(l1_code: str) -> Literal["expense", "income"] | None:
    """Whether an l1 code is on the expense or income side; None if unknown."""
    return _SIDE_BY_L1.get(l1_code)


def validate_category(kind: str, l1: str | None, l2: str | None) -> None:
    """Validate (kind, l1, l2) per decision §1.3.

    - transfer: both l1 and l2 must be None.
    - other kinds: l1 is required, must be a known l1 code, and its side must
      match kind (expense/refund -> expense side, income -> income side).
    - l2, if given, must belong to that l1.

    Raises ApiError(400, "category_invalid" | "category_kind_mismatch", ...) on failure.
    """
    # Deferred import: app.core.errors is created by a sibling task in this
    # same wave, so import lazily to avoid import-order issues at module load.
    from app.core.errors import ApiError

    if kind == "transfer":
        if l1 is not None or l2 is not None:
            raise ApiError(
                400, "category_invalid", "transfer transactions must not have a category"
            )
        return

    if l1 is None:
        raise ApiError(400, "category_invalid", f"category_l1 is required for kind={kind}")

    category = find(l1)
    if category is None:
        raise ApiError(400, "category_invalid", f"unknown category_l1: {l1}")

    if l2 is not None:
        if not any(child.code == l2 for child in category.children):
            raise ApiError(
                400, "category_invalid", f"category_l2 {l2!r} does not belong to category_l1 {l1!r}"
            )

    side = _SIDE_BY_L1[l1]
    expected_side = "income" if kind == "income" else "expense"
    if side != expected_side:
        raise ApiError(
            400,
            "category_kind_mismatch",
            f"category_l1 {l1!r} is on the {side} side, incompatible with kind={kind}",
        )


def _category_to_dict(category: Category) -> dict:
    return {
        "code": category.code,
        "name_zh": category.name_zh,
        "name_en": category.name_en,
        "desc_zh": category.desc_zh,
        "desc_en": category.desc_en,
        "children": [_category_to_dict(child) for child in category.children],
    }


def category_table() -> dict:
    """The response body of GET /categories (§5.5)."""
    return {
        "version": CATEGORY_VERSION,
        "expense": [_category_to_dict(cat) for cat in EXPENSE_CATEGORIES],
        "income": [_category_to_dict(cat) for cat in INCOME_CATEGORIES],
    }


def _render_section(title: str, categories: tuple[Category, ...], lang: str) -> str:
    lines = [title]
    for cat in categories:
        name = cat.name_zh if lang == "zh" else cat.name_en
        desc = cat.desc_zh if lang == "zh" else cat.desc_en
        lines.append(f"- {cat.code} {name} — {desc}")
        if cat.children:
            parts = [
                f"{child.code} {child.name_zh if lang == 'zh' else child.name_en}"
                for child in cat.children
            ]
            lines.append("  - " + " / ".join(parts))
    return "\n".join(lines)


def render_skill_categories(lang: str = "zh") -> str:
    """Render the category table as skill text (§5.7 `categories_block`).

    One section for expense, one for income; l1 lines carry the l1 code, name
    and desc as the classification criterion; l2 lines are an indented,
    slash-separated list of "code name" pairs.
    """
    if lang == "zh":
        expense_title, income_title = "支出：", "收入："
    else:
        expense_title, income_title = "Expense:", "Income:"

    expense_block = _render_section(expense_title, EXPENSE_CATEGORIES, lang)
    income_block = _render_section(income_title, INCOME_CATEGORIES, lang)
    return f"{expense_block}\n\n{income_block}"
