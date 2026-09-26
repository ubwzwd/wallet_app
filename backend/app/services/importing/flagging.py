"""The four automatic flags of 05 §3.

``flag_rows()`` runs once, right before the batch lands in ``ready``. There are
only four flags (decision §14.31) and they do not exclude one another: one row
can be both ``duplicate`` and ``needs_review``.

The call order is fixed (§3):

1. ``flag_duplicates`` — same account, same day, same amount, same currency.
2. ``flag_transfer_candidates`` — takes the transfer legs away first, so that
   a repayment arriving on a credit card is not mistaken for a refund.
3. ``flag_refund_candidates`` — runs last on purpose: both it and step 1 write
   ``matched_transaction_id`` and the refunded expense is the more useful of
   the two, so it wins.

Steps 2 and 3 clear ``matched_transaction_id`` before looking for candidates
(§3.2, §3.3): a "same day, same amount" hit from step 1 is not a refund target
and cannot be a counterpart leg (that one lives on *another* account), and
leaving it there would have §4.4 write it into ``refund_of`` or §4.5 treat it
as a pairing target.

Candidates are only ever looked for among **committed** transactions: drafts in
the same batch have no ``transactions.id`` yet, so nothing could point at them
(decision §14.7). Every statement carries a ``ledger_id`` predicate, and each
of the three steps issues exactly one query for the whole batch — a per-row
query would mean 2000 round trips.
"""
from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Iterable, Sequence
from uuid import UUID

from sqlalchemy import Row, and_, select
from sqlalchemy.orm import Session, aliased

from app.models.finance_source import FinanceSource
from app.models.transaction import Transaction
from app.services import source_access
from app.services.importing.validation import (
    ImportContext,
    RowDraft,
    add_hint,
    sanitize_category,
)
from app.services.valuation import quantize_amount

#: §3.2: an expense older than this is never offered as a refund target.
REFUND_WINDOW_DAYS = 90
#: §3.3 / decision §14.34: the counterpart leg may be this many days off.
TRANSFER_WINDOW_DAYS = 3
#: §3.2's ``LIMIT 200``: a guard against pulling a whole account into memory,
#: not a business rule. Truncation can never turn "several candidates" into
#: "exactly one", so it cannot change what gets pre-filled.
REFUND_POOL_LIMIT = 200

_ZERO = Decimal("0")
#: Everything that is neither a letter nor a digit, for merchant comparison.
_NOISE_RE = re.compile(r"[\W_]+", re.UNICODE)


def flag_rows(db: Session, ctx: ImportContext, rows: list[RowDraft]) -> None:
    """§3's four flags, applied in place to ``rows`` (§0.3)."""
    flag_duplicates(db, ctx, rows)
    flag_transfer_candidates(db, ctx, rows)
    flag_refund_candidates(db, ctx, rows)


# ---------------------------------------------------------------------------
# §3.1 duplicate
# ---------------------------------------------------------------------------


def flag_duplicates(db: Session, ctx: ImportContext, rows: list[RowDraft]) -> None:
    """Same ledger, same account, same day, same signed amount, same currency.

    The pre-filled ``matched_transaction_id`` is there so review can jump to
    the transaction that is already booked; the user's usual answer is to mark
    this row ``skipped``.
    """
    dated = [row for row in rows if row.occurred_at is not None]
    if not dated:
        return

    index: dict[tuple[date, Decimal, str], list[Row[Any]]] = defaultdict(list)
    for tx in _fetch_same_day_transactions(db, ctx, dated):
        index[(tx.occurred_at, quantize_amount(tx.amount), tx.currency)].append(tx)

    for row in dated:
        assert row.occurred_at is not None  # narrowed by the filter above
        hits = index.get((row.occurred_at, row.amount, row.currency), [])
        if not hits:
            continue
        row.flags.add("duplicate")
        if len(hits) == 1:
            row.matched_transaction_id = hits[0].id
        add_hint(row, f"账户里已有 {len(hits)} 笔同日同额交易")


def _fetch_same_day_transactions(
    db: Session, ctx: ImportContext, rows: Sequence[RowDraft]
) -> Sequence[Row[Any]]:
    """One query for the whole batch: this account, these days, these currencies."""
    dates = sorted({row.occurred_at for row in rows if row.occurred_at is not None})
    currencies = sorted({row.currency for row in rows})
    return db.execute(
        select(
            Transaction.id,
            Transaction.occurred_at,
            Transaction.amount,
            Transaction.currency,
        ).where(
            Transaction.ledger_id == ctx.ledger_id,
            Transaction.source_id == ctx.source_id,
            Transaction.occurred_at.in_(dates),
            Transaction.currency.in_(currencies),
        )
    ).all()


# ---------------------------------------------------------------------------
# §3.3 transfer_candidate
# ---------------------------------------------------------------------------


def flag_transfer_candidates(
    db: Session, ctx: ImportContext, rows: list[RowDraft]
) -> None:
    """Look for the other leg on **another** account (decision §14.34).

    Hard conditions: another account of the same ledger, ``kind='transfer'``,
    the opposite ``transfer_role``, the same currency, the exactly negated
    amount and a date within ±3 days. ``transfer_subtype`` is neither a filter
    nor a tie-breaker (decision §14.53a): the same repayment is written
    ``plain`` on one statement and ``repayment`` on the other, and the two legs
    are unified at commit time (§4.5).

    A single leg is only a candidate while its account is live and usable by
    the uploader in this ledger (01 §3.15 A condition 6, decision §14.62 e):
    pairing touches that leg too, so the commit refuses anything else (404 /
    409, §4.5 ①) — suggesting it would pre-tick a pair that cannot land.
    """
    targets = [
        row for row in rows if row.kind == "transfer" and row.occurred_at is not None
    ]
    if not targets:
        return

    legs: dict[tuple[str | None, str, Decimal], list[Row[Any]]] = defaultdict(list)
    fit: dict[UUID, bool] = {}
    for leg in _fetch_transfer_legs(db, ctx, targets):
        legs[(leg.transfer_role, leg.currency, quantize_amount(leg.amount))].append(leg)

    for row in targets:
        # Symmetrical with §3.2: drop whatever §3.1 pre-filled. That is a hit on
        # *this* account, so it can never be a counterpart leg; left in place,
        # §4.5 would try to pair with it and the commit would 400 pair_invalid.
        row.matched_transaction_id = None
        opposite = "out" if row.transfer_role == "in" else "in"
        found = [
            leg
            for leg in legs.get((opposite, row.currency, -row.amount), [])
            if _days_apart(leg.occurred_at, row.occurred_at) <= TRANSFER_WINDOW_DAYS
        ]
        single = _by_closest_day(
            [
                leg
                for leg in found
                if leg.transfer_pair_id is None and _pairable_account(db, ctx, leg, fit)
            ],
            row,
        )
        paired = [leg for leg in found if leg.transfer_pair_id is not None]

        if len(single) == 1:
            row.flags.add("transfer_candidate")
            row.matched_transaction_id = single[0].id
            row.counterpart_source_id = single[0].source_id
            add_hint(row, "已勾选：与另一个账户上的那条转账合并为一笔，可取消")
        elif len(single) > 1:
            # Several candidates: pick none, store none (decision §14.53b). The
            # user chooses one in review; needs_review puts the row in the
            # "flagged" filter until then.
            row.flags.add("transfer_candidate")
            row.flags.add("needs_review")
            add_hint(row, f"找到 {len(single)} 条可以配对的转账，请选一条")
        elif paired:
            # The other leg is already half of a two-leg transfer and cannot be
            # paired again (UNIQUE (transfer_pair_id, transfer_role)), so this
            # row is most likely the same transfer imported twice (§14.34).
            row.flags.add("duplicate")
            add_hint(row, "另一个账户上这笔转账已经配好对了，本行可能是重复的")
        else:
            # Nothing found: guess nothing (decision §14.53c). Inventing a
            # counterpart account would create a transaction out of thin air.
            row.counterpart_source_id = None
            add_hint(row, "没找到对腿；对方账户在应用里就选一个，不在就填对方名字或留空")


def _pairable_account(
    db: Session, ctx: ImportContext, leg: Row[Any], fit: dict[UUID, bool]
) -> bool:
    """Whether a leg's account is live and usable by the uploader here.

    Someone else's account not shared into this ledger (or unshared since), or
    an archived one, would pass review only to have the commit refuse the pair
    (§4.5 ①, decision §14.62 e) — so such a leg is not offered at all. Cached
    per account: many rows of one statement meet the same few accounts.
    """
    if leg.source_id not in fit:
        source = db.get(FinanceSource, leg.source_id)
        fit[leg.source_id] = (
            source is not None
            and not source.archived
            and source_access.is_usable(db, ctx.actor_id, ctx.ledger_id, source)
        )
    return fit[leg.source_id]


def _fetch_transfer_legs(
    db: Session, ctx: ImportContext, rows: Sequence[RowDraft]
) -> Sequence[Row[Any]]:
    """Every transfer leg of other accounts inside the batch's ±3 day window.

    Amount and role are matched in Python: an ``IN`` list of up to 2000 amounts
    would be both unwieldy and dependent on how the driver renders a Decimal.
    """
    days = [row.occurred_at for row in rows if row.occurred_at is not None]
    low = min(days) - timedelta(days=TRANSFER_WINDOW_DAYS)
    high = max(days) + timedelta(days=TRANSFER_WINDOW_DAYS)
    currencies = sorted({row.currency for row in rows})
    return db.execute(
        select(
            Transaction.id,
            Transaction.source_id,
            Transaction.occurred_at,
            Transaction.amount,
            Transaction.currency,
            Transaction.transfer_role,
            Transaction.transfer_pair_id,
        ).where(
            Transaction.ledger_id == ctx.ledger_id,
            Transaction.source_id != ctx.source_id,
            Transaction.kind == "transfer",
            Transaction.currency.in_(currencies),
            Transaction.occurred_at.between(low, high),
        )
    ).all()


def _by_closest_day(legs: Iterable[Row[Any]], row: RowDraft) -> list[Row[Any]]:
    """Closest day first, id as the tie-break — the ``ORDER BY`` of §3.3."""
    assert row.occurred_at is not None
    return sorted(
        legs, key=lambda leg: (_days_apart(leg.occurred_at, row.occurred_at), str(leg.id))
    )


def _days_apart(left: date, right: date) -> int:
    return abs((left - right).days)


# ---------------------------------------------------------------------------
# §3.2 refund_candidate
# ---------------------------------------------------------------------------


def flag_refund_candidates(
    db: Session, ctx: ImportContext, rows: list[RowDraft]
) -> None:
    """``kind='refund'``, or money arriving on a credit card (§3.2).

    The candidate pool is all hard conditions — same account, same currency, a
    committed ``kind='expense'`` within 90 days, large enough, with refundable
    room left. The merchant only scores (decision §5): a refund often carries
    the acquirer's name rather than the shop's, and a scoring lead must never
    decide a pre-fill, because §4.4 writes ``matched_transaction_id`` into
    ``refund_of`` unconditionally.
    """
    targets = [row for row in rows if _is_refund_trigger(ctx, row)]
    if not targets:
        return
    pool = _fetch_refund_pool(db, ctx, targets)

    for row in targets:
        # Before looking anything up (§3.2): a §3.1 hit is "a transaction with
        # the same day and amount", which is not the same thing as "the expense
        # this refunds". Clearing after the lookup would miss the rows that
        # `continue` below.
        row.matched_transaction_id = None
        candidates = sorted(
            (cand for cand in pool if _refund_fits(cand, row)),
            key=lambda cand: (
                -_refund_score(cand, row),
                -cand.occurred_at.toordinal(),  # §3.2's ORDER BY occurred_at DESC
                str(cand.id),
            ),
        )[:REFUND_POOL_LIMIT]
        if not candidates:
            continue

        row.flags.add("refund_candidate")
        if len(candidates) > 1:
            # Several candidates: pre-fill nothing and name nobody, the same way
            # §3.3 does for transfers (decision §14.53b).
            row.flags.add("needs_review")
            add_hint(row, f"找到 {len(candidates)} 笔可能的原支出，请选一笔")
            continue

        best = candidates[0]
        row.matched_transaction_id = best.id
        if row.kind != "refund":
            row.kind = "refund"
            row.flags.add("needs_review")  # the server changed kind: have a look
        # kind may just have changed, so §2.4 ⑦ has to run again: an income
        # category on a refund row is an illegal combination (decision §1.3).
        row.category_l1, row.category_l2, _ = sanitize_category(
            "refund", row.category_l1, row.category_l2
        )
        if row.category_l1 is None:  # decision §1.1: inherit the expense's
            row.category_l1, row.category_l2 = best.category_l1, best.category_l2
        add_hint(row, f"已关联 {best.occurred_at} 的原支出，可改选")


def _is_refund_trigger(ctx: ImportContext, row: RowDraft) -> bool:
    """§3.2's trigger; transfers were taken away by §3.3 and stay out of it.

    A non-positive amount is excluded as well: a row whose amount could not be
    read is 0 (§2.4 ②) and would otherwise "fit" every expense in the window.
    """
    if row.occurred_at is None or row.kind == "transfer" or row.amount <= _ZERO:
        return False
    return row.kind == "refund" or ctx.source_type == "credit"


@dataclass(frozen=True)
class _Candidate:
    """One expense of the refund pool, with its refunded total folded in."""

    id: UUID
    occurred_at: date
    gross: Decimal  # abs(amount): the pool is expenses, so amount < 0
    currency: str
    merchant: str | None
    category_l1: str | None
    category_l2: str | None
    refunded: Decimal


def _fetch_refund_pool(
    db: Session, ctx: ImportContext, rows: Sequence[RowDraft]
) -> list[_Candidate]:
    """Committed expenses of this account inside the batch's 90-day window.

    One query for the whole batch, left-joined to the refunds that already
    point at each expense; the totals are summed in Python, the way
    :func:`transaction_service.refund_totals` does it.
    """
    days = [row.occurred_at for row in rows if row.occurred_at is not None]
    low = min(days) - timedelta(days=REFUND_WINDOW_DAYS)
    high = max(days)
    currencies = sorted({row.currency for row in rows})

    refund = aliased(Transaction)
    found = db.execute(
        select(
            Transaction.id,
            Transaction.occurred_at,
            Transaction.amount,
            Transaction.currency,
            Transaction.merchant,
            Transaction.category_l1,
            Transaction.category_l2,
            refund.amount.label("refund_amount"),
        )
        .join(
            refund,
            and_(
                refund.refund_of == Transaction.id,
                refund.kind == "refund",
                refund.ledger_id == ctx.ledger_id,
            ),
            isouter=True,
        )
        .where(
            Transaction.ledger_id == ctx.ledger_id,
            Transaction.source_id == ctx.source_id,
            Transaction.kind == "expense",
            Transaction.currency.in_(currencies),
            Transaction.occurred_at.between(low, high),
        )
    ).all()

    refunded: dict[UUID, Decimal] = defaultdict(lambda: _ZERO)
    expenses: dict[UUID, Row[Any]] = {}
    for record in found:
        expenses[record.id] = record
        if record.refund_amount is not None:
            refunded[record.id] += quantize_amount(record.refund_amount)
    return [
        _Candidate(
            id=record.id,
            occurred_at=record.occurred_at,
            gross=abs(quantize_amount(record.amount)),
            currency=record.currency,
            merchant=record.merchant,
            category_l1=record.category_l1,
            category_l2=record.category_l2,
            refunded=refunded[record.id],
        )
        for record in expenses.values()
    ]


def _refund_fits(cand: _Candidate, row: RowDraft) -> bool:
    """§3.2's hard conditions; the merchant is deliberately not among them."""
    assert row.occurred_at is not None
    if cand.currency != row.currency:
        return False
    if not (
        row.occurred_at - timedelta(days=REFUND_WINDOW_DAYS)
        <= cand.occurred_at
        <= row.occurred_at
    ):
        return False
    if cand.gross < row.amount:
        return False
    return cand.gross - cand.refunded > _ZERO


def _refund_score(cand: _Candidate, row: RowDraft) -> int:
    """Order candidates only: it changes nothing about the hard conditions.

    The ranking is invisible outside this module — candidates are neither
    stored nor returned nor named in a hint (decision §14.53b).
    """
    assert row.occurred_at is not None
    score = 0
    if cand.gross == row.amount:
        score += 100
    elif cand.gross - cand.refunded == row.amount:
        score += 80
    if _merchant_alike(cand.merchant, row.merchant):
        score += 20
    return score + max(0, 30 - (row.occurred_at - cand.occurred_at).days // 3)


def _merchant_alike(left: str | None, right: str | None) -> bool:
    """NFKC + lower-case + drop spaces and punctuation, then either contains
    the other ("星巴克" ⊂ "星巴克咖啡")."""
    if not left or not right:
        return False
    one, two = _merchant_key(left), _merchant_key(right)
    if not one or not two:
        return False
    return one in two or two in one


def _merchant_key(text: str) -> str:
    return _NOISE_RE.sub("", unicodedata.normalize("NFKC", text).casefold())
