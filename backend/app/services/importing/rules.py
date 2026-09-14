"""The per-row rules of §2.4, one small function per column.

Every rule here **corrects and annotates**; none of them rejects a row. A date
that is not a date becomes NULL, an amount that is not a number becomes 0, an
unknown ``kind`` is guessed from the sign — and each change is appended to the
row's ``hint`` so the review table can tell the user exactly what happened
(decisions §5, §14.19, §14.28).

The four ``needs_review`` triggers are the ones decision §5 lists: date, amount,
currency and ``kind``. A category problem is deliberately *not* one of them —
it lands in the review table's "uncategorized" bucket instead (§2.4 ⑦).
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal

from app.core.categories import validate_category
from app.core.errors import ApiError
from app.services.importing.drafts import (
    AMOUNT_LIMIT,
    AMOUNT_QUANT,
    COLUMNS,
    KINDS,
    MAX_MERCHANT,
    MAX_NOTE,
    MAX_SOURCE_REF,
    MIN_DATE,
    TRANSFER_ROLES,
    TRANSFER_SUBTYPES,
    ImportContext,
    RowDraft,
    add_hint,
)

_AMOUNT_RE = re.compile(r"[+-]?\d+(\.\d{1,4})?")
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
_CURRENCY_RE = re.compile(r"[A-Z]{3}")
#: 13–19 digits, optionally grouped by spaces or hyphens (§6.2).
_PAN_RE = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")
_CENTS = Decimal("0.01")


def normalize_row(
    row_no: int, fields: list[str], ctx: ImportContext, today: date
) -> RowDraft:
    """Run §2.4's rules, in their documented order, over one record."""
    values = [value.strip() for value in fields]
    values += [""] * (len(COLUMNS) - len(values))  # defensive; check_shape ran first

    row = RowDraft(
        row_no=row_no,
        occurred_at=None,
        amount=Decimal("0").quantize(AMOUNT_QUANT),
        currency=ctx.source_currency,
        kind="expense",
        transfer_role=None,
        transfer_subtype=None,
        merchant=None,
        note=None,
        category_l1=None,
        category_l2=None,
        source_ref=None,
    )
    _apply_date(row, values[0], today)
    _apply_amount(row, values[1])
    _apply_currency(row, values[2], ctx)
    _apply_kind(row, values[3])
    # ⑤ reads the role as the *file* wrote it; ⑥ is what fills a missing one.
    _apply_sign(row, values[4] if values[4] in TRANSFER_ROLES else None)
    _apply_transfer(row, values[4], values[5], ctx)
    _apply_category(row, values[8], values[9])
    _apply_text(row, values[6], values[7], values[10])
    return row


def mask_pan(text: str | None) -> str | None:
    """Keep only the last four digits of anything that looks like a card (§6.2).

    Luhn is the filter: most 13–19 digit runs on a statement are order or
    reference numbers, and blanking those would destroy useful information.
    """
    if not text:
        return text

    def _mask(match: re.Match) -> str:
        digits = re.sub(r"\D", "", match.group())
        if not (13 <= len(digits) <= 19) or not _luhn(digits):
            return match.group()
        return "*" * (len(digits) - 4) + digits[-4:]

    return _PAN_RE.sub(_mask, text)


def sanitize_category(
    kind: str, l1: str | None, l2: str | None
) -> tuple[str | None, str | None, str | None]:
    """§2.4 ⑦: return ``(l1, l2, hint)``; ``hint`` is None when nothing changed.

    ``validate_category`` is the single source of truth for what a valid
    ``(kind, l1, l2)`` is; this narrows its verdict down to "which column has
    to be cleared".
    """
    if kind == "transfer":
        if l1 or l2:
            return None, None, "转账不记分类，已清空"
        return None, None, None
    if not l1:
        if l2:
            return None, None, f'一级分类为空，二级 "{l2}" 已清空'
        return None, None, None
    try:
        validate_category(kind, l1, l2)
        return l1, l2, None
    except ApiError:
        pass
    try:
        validate_category(kind, l1, None)
    except ApiError:
        side = "收入" if kind == "income" else "支出"
        return None, None, f'分类 "{l1}" 不在{side}分类表里，已清空待归类'
    return l1, None, f'二级分类 "{l2}" 不属于 "{l1}"，已清空'


def parse_amount(text: str) -> Decimal | None:
    """§2.4 ②: thousands separators are tolerated, currency symbols are not.

    Tolerating ``¥`` or ``(123)`` here would let the skill's own job — turning
    statement prose into plain numbers — quietly rot (§5.2 rule 2).
    """
    cleaned = text.strip().replace(",", "")
    if _AMOUNT_RE.fullmatch(cleaned) is None:
        return None
    return Decimal(cleaned).quantize(AMOUNT_QUANT)


def _luhn(digits: str) -> bool:
    total, double = 0, False
    for char in reversed(digits):
        value = int(char)
        if double:
            value *= 2
            if value > 9:
                value -= 9
        total += value
        double = not double
    return total % 10 == 0


def _fmt_amount(value: Decimal) -> str:
    """Render an amount for a hint: two decimals unless more are significant."""
    if value == value.quantize(_CENTS):
        return f"{value:.2f}"
    return f"{value:.4f}"


def _apply_date(row: RowDraft, text: str, today: date) -> None:
    """§2.4 ①: blank out anything that is not a real, in-range calendar date.

    Blanking rather than keeping the original is what makes §4.3 stop the
    commit: an out-of-range date would otherwise blow up inside the insert.
    The server never guesses DD/MM vs MM/DD — one wrong guess is a silent
    off-by-a-day.
    """
    parsed: date | None = None
    if _DATE_RE.fullmatch(text):
        try:
            parsed = date.fromisoformat(text)  # also rejects 2026-02-30
        except ValueError:
            parsed = None
    if parsed is None:
        row.occurred_at = None
        row.flags.add("needs_review")
        add_hint(row, f'日期 "{text}" 不是 YYYY-MM-DD，请填写')
        return
    if parsed < MIN_DATE or parsed > today + timedelta(days=1):
        row.occurred_at = None
        row.flags.add("needs_review")
        add_hint(row, f"日期 {parsed.isoformat()} 超出可记账范围，请填写")
        return
    row.occurred_at = parsed


def _apply_amount(row: RowDraft, text: str) -> None:
    """§2.4 ②: a number or nothing; 0 and absurdly large values are flagged."""
    parsed = parse_amount(text)
    if parsed is None:
        row.amount = Decimal("0").quantize(AMOUNT_QUANT)
        row.flags.add("needs_review")
        add_hint(row, f'金额 "{text}" 不是数字，请填写')
        return
    row.amount = parsed
    if parsed == 0:
        row.flags.add("needs_review")
        add_hint(row, "金额为 0，请确认或跳过")
        return
    if abs(parsed) > AMOUNT_LIMIT:
        row.flags.add("needs_review")
        add_hint(row, "金额异常大，请核对")


def _apply_currency(row: RowDraft, text: str, ctx: ImportContext) -> None:
    """§2.4 ③: three upper-case letters, else fall back to the account's.

    Whether the code is a real currency is not checked here — a missing rate
    reports itself at valuation time.
    """
    code = text.upper()
    if _CURRENCY_RE.fullmatch(code):
        row.currency = code
        return
    row.currency = ctx.source_currency
    row.flags.add("needs_review")
    add_hint(row, f'币种 "{text}" 无效，已改为账户币种 {ctx.source_currency}')


def _apply_kind(row: RowDraft, text: str) -> None:
    """§2.4 ④: one of the four kinds, else guess from the amount's sign."""
    if text in KINDS:
        row.kind = text
        return
    row.kind = "expense" if row.amount < 0 else "income"
    row.flags.add("needs_review")
    add_hint(row, f'kind "{text}" 无法识别，已按金额符号记为 {row.kind}')


def _apply_sign(row: RowDraft, file_role: str | None) -> None:
    """§2.4 ⑤: the sign follows ``kind``, because the CHECKs of §10 demand it."""
    amount, changed = row.amount, False
    if row.kind == "expense" and amount > 0:
        amount, changed = -amount, True
    elif row.kind in ("income", "refund") and amount < 0:
        amount, changed = -amount, True
    elif row.kind == "transfer":
        if file_role == "out" and amount > 0:
            amount, changed = -amount, True
        if file_role == "in" and amount < 0:
            amount, changed = -amount, True
    if not changed:
        return
    was = "正数" if row.amount > 0 else "负数"
    subject = f"转账 {file_role}" if row.kind == "transfer" else f"kind 是 {row.kind}"
    row.amount = amount
    row.flags.add("needs_review")
    add_hint(row, f"{subject} 但金额是{was}，已改为 {_fmt_amount(amount)}")


def _apply_transfer(row: RowDraft, role: str, subtype: str, ctx: ImportContext) -> None:
    """§2.4 ⑥: transfers need both columns, everything else needs neither."""
    if row.kind != "transfer":
        if role or subtype:
            add_hint(row, "非转账行不该有转账方向与子类型，已清空")
        row.transfer_role = None
        row.transfer_subtype = None
        return

    if role in TRANSFER_ROLES:
        row.transfer_role = role
    else:
        row.transfer_role = "out" if row.amount < 0 else "in"
        row.flags.add("needs_review")
        said = "为空" if not role else f'"{role}" 无效'
        add_hint(row, f"转账方向{said}，已按金额符号记为 {row.transfer_role}")

    if subtype in TRANSFER_SUBTYPES:
        row.transfer_subtype = subtype
        return
    if not subtype and ctx.source_type == "credit" and row.transfer_role == "in":
        # Money arriving on a credit card is a repayment nearly every time.
        row.transfer_subtype = "repayment"
        return
    row.transfer_subtype = "plain"
    row.flags.add("needs_review")
    said = "为空" if not subtype else f'"{subtype}" 无效'
    add_hint(row, f"转账子类型{said}，已按普通划转处理")


def _apply_category(row: RowDraft, l1: str, l2: str) -> None:
    """§2.4 ⑦: an unusable category is cleared, never flagged."""
    row.category_l1, row.category_l2, hint = sanitize_category(
        row.kind, l1 or None, l2 or None
    )
    if hint:
        add_hint(row, hint)


def _apply_text(row: RowDraft, merchant: str, note: str, source_ref: str) -> None:
    """§2.4 ⑧: trim, truncate, mask card numbers; empty becomes NULL."""
    row.merchant = mask_pan(_truncate(row, merchant, MAX_MERCHANT, "商户名"))
    row.note = mask_pan(_truncate(row, note, MAX_NOTE, "备注"))
    # source_ref is a position reference, not statement prose: long digit runs
    # are meaningful there and it never reaches a transaction (§6.2).
    row.source_ref = _truncate(row, source_ref, MAX_SOURCE_REF, "来源引用")


def _truncate(row: RowDraft, text: str, limit: int, label: str) -> str | None:
    if not text:
        return None
    if len(text) <= limit:
        return text
    add_hint(row, f"{label}超过 {limit} 字，已截断")
    return text[:limit]
