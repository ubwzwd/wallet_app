"""Transaction business logic (03-backend-api.md §5.26-§5.34).

Everything the transaction endpoints are not allowed to decide for themselves
lives here: the field rules of §5.26, the ``kind`` boundary of decision §14.3,
the two-leg transfer lifecycle of §5.30-§5.32, pairing and unpairing
(§5.33/§5.34, decisions §14.34 and §14.53a), and the event trail of §7.

Two conventions carry over from the ledger service:

* **flush, never commit.** Each function leaves a complete, consistent set of
  rows in the session; the endpoint owns the transaction, so "insert two legs
  and their two events" either all lands or none of it does (§5.30).
* **Validate before the database does.** Every CHECK of 02-database.md §1.6 has
  a check here that fires first, so a bad request is a 400 with the right code
  from §4.2, never an ``IntegrityError`` turned into a 500.

Optimistic concurrency follows §4.4 literally: lock the row(s) with
``SELECT ... FOR UPDATE`` (a no-op on SQLite), compare ``updated_at`` to the
microsecond, 409 ``stale_update`` on a mismatch.
"""
import datetime as dt
import re
import uuid
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Sequence

from sqlalchemy import and_, select
from sqlalchemy.orm import Session, aliased

from app.core.categories import validate_category
from app.core.clock import utcnow
from app.core.errors import ApiError, ErrorCode
from app.models.finance_source import FinanceSource
from app.models.ledger import Ledger
from app.models.transaction import Transaction
from app.services import events, fx
from app.services.valuation import quantize_amount

KINDS = ("expense", "income", "refund", "transfer")
TRANSFER_ROLES = ("out", "in")
TRANSFER_SUBTYPES = ("plain", "repayment")

# Column bounds of 02-database.md §1.6; checked here so an over-long string is
# a 400, not a Postgres error (SQLite would silently accept it).
MAX_MERCHANT_LENGTH = 200
MAX_NOTE_LENGTH = 500
MAX_COUNTERPARTY_LENGTH = 100

# Guard against a mistyped year (decision §14.44, 03-13).
MAX_FUTURE_DAYS = 1

CURRENCY_RE = re.compile(r"^[A-Za-z]{3}$")

# "the request did not mention this field" — distinct from an explicit ``None``,
# which is how a PATCH clears ``note``.
_MISSING = object()

# Money columns are NUMERIC(18, 4) (02-database.md §1.6), which leaves 14
# digits before the point. Checked here so a mistyped 20-digit amount is a 400
# ``validation_error`` and not a Postgres "numeric field overflow" (a 500).
MAX_AMOUNT_INTEGER_DIGITS = 14
MAX_AMOUNT = Decimal(10) ** MAX_AMOUNT_INTEGER_DIGITS

# The columns a single transaction's PATCH may touch, and the ones a diff is
# taken over (§5.28: "id, ledger_id, transfer_pair_id, import_batch_id,
# created_by, created_at" are not among them).
SINGLE_FIELDS: tuple[str, ...] = (
    "source_id",
    "kind",
    "amount",
    "currency",
    "occurred_at",
    "category_l1",
    "category_l2",
    "merchant",
    "note",
    "refund_of",
    "transfer_role",
    "transfer_subtype",
    "counterparty",
)

# What a two-leg PATCH may name (§5.31); each maps onto one or both legs.
TRANSFER_FIELDS: tuple[str, ...] = (
    "from_source_id",
    "to_source_id",
    "amount_out",
    "currency_out",
    "amount_in",
    "currency_in",
    "occurred_at",
    "subtype",
    "note",
)

# The version token of §4.4 is not a column edit; callers may hand the whole
# request body over, so it is skipped rather than rejected.
_VERSION_KEY = "updated_at"


@dataclass(frozen=True)
class SingleTxInput:
    """One booked row as §5.26 accepts it, before any normalization."""

    source_id: uuid.UUID
    kind: str
    amount: Decimal
    currency: str
    occurred_at: dt.date
    category_l1: str | None = None
    category_l2: str | None = None
    merchant: str | None = None
    note: str | None = None
    refund_of: uuid.UUID | None = None
    transfer_role: str | None = None
    transfer_subtype: str | None = None
    counterparty: str | None = None


@dataclass(frozen=True, kw_only=True)
class TransferInput:
    """A two-leg transfer as §5.30 accepts it (keyword arguments only).

    ``currency_out`` / ``currency_in`` default to the respective account's
    currency; ``amount_in`` may be omitted only when both legs end up in the
    same currency (decision §14.52 A11).
    """

    from_source_id: uuid.UUID
    to_source_id: uuid.UUID
    amount_out: Decimal
    currency_out: str | None = None
    amount_in: Decimal | None = None
    currency_in: str | None = None
    occurred_at: dt.date
    subtype: str
    note: str | None = None


# ---------------------------------------------------------------------------
# Single transactions (§5.26, §5.28, §5.29)
# ---------------------------------------------------------------------------


def create_single(
    db: Session,
    ledger: Ledger,
    actor_id: uuid.UUID,
    data: SingleTxInput,
    client: str | None,
) -> Transaction:
    """Book one transaction and its ``created`` event (§5.26).

    Only single rows: a two-leg transfer goes through :func:`create_transfer`,
    so ``transfer_pair_id`` is always NULL here.
    """
    source = _load_source(db, ledger, data.source_id)
    if source.archived:
        raise ApiError(
            409, ErrorCode.SOURCE_ARCHIVED, f"Account {source.name!r} is archived"
        )

    values = _validate_single(db, ledger, source, _as_dict(data), tx_id=None)

    now = utcnow()
    tx = Transaction(
        ledger_id=ledger.id,
        created_by=actor_id,
        updated_by=actor_id,
        created_at=now,
        updated_at=now,
        **values,
    )
    db.add(tx)
    db.flush()

    # The event carries the row's own stamp: one operation, one instant (§1.9).
    events.record(
        db,
        ledger_id=ledger.id,
        transaction_id=tx.id,
        actor_id=actor_id,
        event="created",
        client=client,
        at=now,
    )
    db.flush()
    return tx


def update_single(
    db: Session,
    ledger: Ledger,
    actor_id: uuid.UUID,
    tx: Transaction,
    changes: dict[str, object],
    expected_updated_at: dt.datetime,
    client: str | None,
) -> Transaction:
    """Apply a PATCH to one transaction (§5.28).

    ``changes`` holds only the fields the request actually carried; the row is
    validated as a whole afterwards, because §5.26's rules are about the
    finished row, not about the edit.
    """
    locked = _lock_transaction(db, tx.id)
    if locked is None or locked.ledger_id != ledger.id:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Transaction not found")
    tx = locked

    if tx.transfer_pair_id is not None:
        raise ApiError(
            409,
            ErrorCode.USE_TRANSFER_ENDPOINT,
            "This leg belongs to a paired transfer; use "
            "PATCH /ledgers/{id}/transactions/transfer/{pair_id}",
        )
    if tx.updated_at != expected_updated_at:
        raise ApiError(
            409,
            ErrorCode.STALE_UPDATE,
            "Transaction was modified by someone else; reload and retry",
        )

    edits = _clean_changes(changes, SINGLE_FIELDS)

    # The transfer / non-transfer boundary is judged before the edit is
    # applied: a request that also fixes up every other column would satisfy
    # all of §10's CHECKs and slip through whole-row validation (decision §14.3).
    new_kind = edits.get("kind", tx.kind)
    if (tx.kind == "transfer") != (new_kind == "transfer"):
        raise ApiError(
            400,
            ErrorCode.KIND_CHANGE_NOT_ALLOWED,
            "Cannot change kind between transfer and non-transfer; "
            "delete and re-enter instead",
        )

    before = events.snapshot(tx, SINGLE_FIELDS)
    merged = dict(before)
    merged.update(edits)

    source = _load_source(db, ledger, merged["source_id"])
    # A historical row on an archived account stays editable (decision §14.40,
    # 01-12); moving one *onto* an archived account does not.
    if source.id != tx.source_id and source.archived:
        raise ApiError(
            409, ErrorCode.SOURCE_ARCHIVED, f"Account {source.name!r} is archived"
        )

    values = _validate_single(
        db, ledger, source, merged, tx_id=tx.id, current_currency=tx.currency
    )

    now = utcnow()
    for field, value in values.items():
        setattr(tx, field, value)
    tx.updated_by = actor_id
    tx.updated_at = now
    db.flush()

    diff = events.diff_changes(before, values)
    refund_event = _refund_event(before["refund_of"], values["refund_of"])
    # A link / unlink is told by its own event, so it is not repeated inside
    # the `updated` one; at most two events per PATCH (§5.28, §7.2). Both carry
    # the row's new ``updated_at``, which is what ties them to this one edit
    # (§1.9); ``events.list_for`` orders the tie by id.
    updated_changes = {
        field: change
        for field, change in diff.items()
        if not (field == "refund_of" and refund_event is not None)
    }
    if updated_changes:
        events.record(
            db,
            ledger_id=ledger.id,
            transaction_id=tx.id,
            actor_id=actor_id,
            event="updated",
            changes=updated_changes,
            client=client,
            at=now,
        )
    if refund_event is not None:
        events.record(
            db,
            ledger_id=ledger.id,
            transaction_id=tx.id,
            actor_id=actor_id,
            event=refund_event,
            changes={"refund_of": diff["refund_of"]},
            client=client,
            at=now,
        )
    db.flush()
    return tx


def delete_single(db: Session, ledger: Ledger, tx: Transaction) -> None:
    """Delete exactly one row (§5.29).

    No event is written — the transaction is gone and its events go with it
    through the cascade (§7.2). Refund rows pointing at a deleted expense keep
    their row and have ``refund_of`` set to NULL by the database.
    """
    if tx.ledger_id != ledger.id:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Transaction not found")
    if tx.transfer_pair_id is not None:
        raise ApiError(
            409,
            ErrorCode.USE_TRANSFER_ENDPOINT,
            "This leg belongs to a paired transfer; use "
            "DELETE /ledgers/{id}/transactions/transfer/{pair_id}",
        )
    db.delete(tx)
    db.flush()


# ---------------------------------------------------------------------------
# Two-leg transfers (§5.30 - §5.32)
# ---------------------------------------------------------------------------


def create_transfer(
    db: Session,
    ledger: Ledger,
    actor_id: uuid.UUID,
    data: TransferInput,
    client: str | None,
) -> tuple[Transaction, Transaction]:
    """Book both legs of a transfer in one go (§5.30); returns ``(out, in)``.

    The pair id is generated here — a client never names it.
    """
    from_source = _load_source(db, ledger, data.from_source_id)
    to_source = _load_source(db, ledger, data.to_source_id)

    for source in (from_source, to_source):
        if source.archived:
            raise ApiError(
                409, ErrorCode.SOURCE_ARCHIVED, f"Account {source.name!r} is archived"
            )
    if from_source.id == to_source.id:
        raise ApiError(
            400, ErrorCode.SAME_SOURCE, "A transfer needs two different accounts"
        )

    subtype = _check_subtype(data.subtype, to_source)
    currency_out = _check_currency(data.currency_out or from_source.default_currency)
    currency_in = _check_currency(data.currency_in or to_source.default_currency)
    amount_out = _positive_amount(data.amount_out, "amount_out")
    amount_in = _resolve_amount_in(data.amount_in, amount_out, currency_out, currency_in)
    note = _check_text(data.note, "note", MAX_NOTE_LENGTH)

    pair_id = uuid.uuid4()
    now = utcnow()
    legs: list[Transaction] = []
    for role, source, amount, currency in (
        ("out", from_source, -amount_out, currency_out),
        ("in", to_source, amount_in, currency_in),
    ):
        leg = Transaction(
            ledger_id=ledger.id,
            source_id=source.id,
            kind="transfer",
            amount=amount,
            currency=currency,
            occurred_at=data.occurred_at,
            note=note,
            merchant=None,
            category_l1=None,
            category_l2=None,
            transfer_role=role,
            transfer_subtype=subtype,
            transfer_pair_id=pair_id,
            counterparty=None,
            refund_of=None,
            created_by=actor_id,
            updated_by=actor_id,
            created_at=now,
            updated_at=now,
        )
        db.add(leg)
        legs.append(leg)
    db.flush()

    for leg in legs:
        events.record(
            db,
            ledger_id=ledger.id,
            transaction_id=leg.id,
            actor_id=actor_id,
            event="created",
            client=client,
            at=now,
        )
    db.flush()
    return legs[0], legs[1]


def update_transfer(
    db: Session,
    ledger: Ledger,
    actor_id: uuid.UUID,
    pair_id: uuid.UUID,
    changes: dict[str, object],
    expected_updated_at: dt.datetime,
    client: str | None,
) -> tuple[Transaction, Transaction]:
    """Edit a pair as one object (§5.31); returns ``(out, in)``.

    ``occurred_at`` / ``subtype`` / ``note`` are written to **both** legs when
    the request names them (decision §14.53a); a field the request leaves out
    keeps whatever each leg already had, so a pair whose legs carry different
    dates or notes survives an edit of something else. Amounts, currencies and
    accounts belong to one leg each.
    """
    out_leg, in_leg = get_pair(db, ledger, pair_id, for_update=True)
    edits = _clean_changes(changes, TRANSFER_FIELDS)

    # The client echoes the newer of the two stamps (§5.31); neither leg may
    # have moved past it.
    newest = max(out_leg.updated_at, in_leg.updated_at)
    if expected_updated_at != newest:
        raise ApiError(
            409,
            ErrorCode.STALE_UPDATE,
            "Transfer was modified by someone else; reload and retry",
        )

    before_out = events.snapshot(out_leg, SINGLE_FIELDS)
    before_in = events.snapshot(in_leg, SINGLE_FIELDS)

    from_source = _resolve_source(db, ledger, edits, "from_source_id", out_leg)
    to_source = _resolve_source(db, ledger, edits, "to_source_id", in_leg)
    if from_source.id == to_source.id:
        raise ApiError(
            400, ErrorCode.SAME_SOURCE, "A transfer needs two different accounts"
        )

    subtype = _check_subtype(edits.get("subtype", out_leg.transfer_subtype), to_source)
    # ``occurred_at`` and ``note`` go to both legs only when the request names
    # them (decision §14.53a): a pair tied together by :func:`pair` is allowed
    # to keep one date per leg (swipe day vs posting day) and one note per
    # statement, and an unrelated PATCH must not flatten that.
    occurred_at = edits["occurred_at"] if "occurred_at" in edits else _MISSING
    note = (
        _check_text(edits["note"], "note", MAX_NOTE_LENGTH)
        if "note" in edits
        else _MISSING
    )
    currency_out = (
        _check_currency(edits["currency_out"])
        if "currency_out" in edits
        else out_leg.currency
    )
    currency_in = (
        _check_currency(edits["currency_in"])
        if "currency_in" in edits
        else in_leg.currency
    )
    amount_out = (
        _positive_amount(edits["amount_out"], "amount_out")
        if "amount_out" in edits
        else -_amount(out_leg.amount)
    )
    amount_in = (
        _positive_amount(edits["amount_in"], "amount_in")
        if "amount_in" in edits
        else _amount(in_leg.amount)
    )

    now = utcnow()
    for leg, source, amount, currency in (
        (out_leg, from_source, -amount_out, currency_out),
        (in_leg, to_source, amount_in, currency_in),
    ):
        leg.source_id = source.id
        leg.amount = amount
        leg.currency = currency
        if occurred_at is not _MISSING:
            leg.occurred_at = occurred_at
        # Both legs always carry the same subtype, so it is written outright.
        leg.transfer_subtype = subtype
        if note is not _MISSING:
            leg.note = note
        leg.updated_by = actor_id
        leg.updated_at = now
    db.flush()

    for leg, before in ((out_leg, before_out), (in_leg, before_in)):
        diff = events.diff_changes(before, events.snapshot(leg, SINGLE_FIELDS))
        if diff:
            events.record(
                db,
                ledger_id=ledger.id,
                transaction_id=leg.id,
                actor_id=actor_id,
                event="updated",
                changes=diff,
                client=client,
                at=now,
            )
    db.flush()
    return out_leg, in_leg


def delete_transfer(db: Session, ledger: Ledger, pair_id: uuid.UUID) -> None:
    """Delete every leg of a pair (§5.32).

    A half-broken pair is deleted too: ``transfer_pair_incomplete`` is not
    raised here, since the point of the call is to leave nothing behind.
    """
    legs = _pair_legs(db, ledger, pair_id)
    if not legs:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Transfer not found")
    for leg in legs:
        db.delete(leg)
    db.flush()


def get_pair(
    db: Session,
    ledger: Ledger,
    pair_id: uuid.UUID,
    *,
    for_update: bool = False,
) -> tuple[Transaction, Transaction]:
    """The ``(out, in)`` legs of a pair, or the errors of §5.31."""
    legs = _pair_legs(db, ledger, pair_id, for_update=for_update)
    if not legs:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Transfer not found")
    return _split_legs(legs, ErrorCode.TRANSFER_PAIR_INCOMPLETE, 409)


# ---------------------------------------------------------------------------
# Pairing and unpairing (§5.33, §5.34, decisions §14.34 / §14.53a)
# ---------------------------------------------------------------------------


def unify_subtype(
    out_subtype: str | None, in_subtype: str | None, in_source_type: str
) -> str:
    """The one subtype a freshly paired transfer gets (decision §14.53a).

    Either leg saying ``repayment`` makes the pair a repayment — but only when
    the money lands on a credit account, so the result can never contradict
    ``repayment_target_not_credit`` (§4.2).
    """
    if "repayment" in (out_subtype, in_subtype) and in_source_type == "credit":
        return "repayment"
    return "plain"


def pair(
    db: Session,
    ledger: Ledger,
    actor_id: uuid.UUID,
    tid: uuid.UUID,
    other_id: uuid.UUID,
    client: str | None,
) -> tuple[Transaction, Transaction]:
    """Tie two single-leg transfers into one pair (§5.33); returns ``(out, in)``.

    No optimistic concurrency: only ``transfer_pair_id`` / ``transfer_subtype``
    / ``counterparty`` move, and a second concurrent attempt fails check 3.
    Amounts, currencies, dates and subtypes are deliberately *not* compared.
    """
    first = _load_transaction(db, ledger, tid)
    second = _load_transaction(db, ledger, other_id)

    if first.id == second.id:
        raise ApiError(400, ErrorCode.PAIR_INVALID, "A transaction cannot pair with itself")

    # Lock both rows in a fixed order (no deadlock) and judge the locked state:
    # whoever gets here second sees the pair id the first one wrote.
    for row in sorted((first, second), key=lambda leg: leg.id.bytes):
        _lock_transaction(db, row.id)

    for row in (first, second):
        if row.kind != "transfer":
            raise ApiError(
                400, ErrorCode.PAIR_INVALID, "Both transactions must be transfers"
            )
        if row.transfer_pair_id is not None:
            raise ApiError(
                400,
                ErrorCode.PAIR_INVALID,
                "Both transactions must still be single legs; unpair first",
            )
    if first.transfer_role == second.transfer_role:
        raise ApiError(
            400, ErrorCode.PAIR_INVALID, "The two legs must point in opposite directions"
        )
    if first.source_id == second.source_id:
        raise ApiError(
            400, ErrorCode.PAIR_INVALID, "The two legs must be on different accounts"
        )

    out_leg, in_leg = _split_legs([first, second], ErrorCode.PAIR_INVALID, 400)
    in_source = _load_source(db, ledger, in_leg.source_id)
    subtype = unify_subtype(
        out_leg.transfer_subtype, in_leg.transfer_subtype, in_source.type
    )

    pair_id = uuid.uuid4()
    now = utcnow()
    for leg in (out_leg, in_leg):
        before = events.snapshot(leg, ("transfer_pair_id", "counterparty"))
        before_subtype = leg.transfer_subtype
        leg.transfer_pair_id = pair_id
        leg.counterparty = None
        leg.transfer_subtype = subtype
        leg.updated_by = actor_id
        leg.updated_at = now
        db.flush()

        # §7.2 asks a ``paired`` event for both values outright ("only fields
        # that really changed" is the rule for ``updated``), so a leg whose
        # counterparty was already NULL still shows the key.
        events.record(
            db,
            ledger_id=ledger.id,
            transaction_id=leg.id,
            actor_id=actor_id,
            event="paired",
            changes={
                "transfer_pair_id": {
                    "before": events.serialize(before["transfer_pair_id"]),
                    "after": events.serialize(pair_id),
                },
                "counterparty": {
                    "before": events.serialize(before["counterparty"]),
                    "after": None,
                },
            },
            client=client,
            at=now,
        )
        if before_subtype != subtype:
            events.record(
                db,
                ledger_id=ledger.id,
                transaction_id=leg.id,
                actor_id=actor_id,
                event="updated",
                changes=events.diff_changes(
                    {"transfer_subtype": before_subtype},
                    {"transfer_subtype": subtype},
                ),
                client=client,
                at=now,
            )
    db.flush()
    return out_leg, in_leg


def unpair(
    db: Session,
    ledger: Ledger,
    actor_id: uuid.UUID,
    pair_id: uuid.UUID,
    client: str | None,
) -> list[Transaction]:
    """Turn a pair back into two single legs (§5.34); returns ``[out, in]``.

    Amounts, dates, accounts and subtypes are untouched, and ``counterparty``
    stays empty — guessing the other side would only invent data.
    """
    legs = _pair_legs(db, ledger, pair_id, for_update=True)
    if not legs:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Transfer not found")
    out_leg, in_leg = _split_legs(legs, ErrorCode.UNPAIR_INVALID, 409)

    now = utcnow()
    ordered = [out_leg, in_leg]
    for leg in ordered:
        before = events.snapshot(leg, ("transfer_pair_id",))
        leg.transfer_pair_id = None
        leg.updated_by = actor_id
        leg.updated_at = now
        db.flush()
        events.record(
            db,
            ledger_id=ledger.id,
            transaction_id=leg.id,
            actor_id=actor_id,
            event="unpaired",
            changes=events.diff_changes(
                before, events.snapshot(leg, ("transfer_pair_id",))
            ),
            client=client,
            at=now,
        )
    db.flush()
    return ordered


# ---------------------------------------------------------------------------
# Refund totals (§5.25, §5.27)
# ---------------------------------------------------------------------------


def refund_totals(
    db: Session, ledger: Ledger, expense_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, tuple[Decimal, Decimal]]:
    """``{expense id: (refunded_total, refundable)}`` in one aggregate query.

    ``refundable`` is ``|amount| - refunded_total`` and may go negative: a
    refund over the original amount is warned about in the UI, not rejected
    (decision §1.1).
    """
    wanted = list(dict.fromkeys(expense_ids))
    totals: dict[uuid.UUID, tuple[Decimal, Decimal]] = {
        expense_id: (_zero(), _zero()) for expense_id in wanted
    }
    if not wanted:
        return totals

    refund = aliased(Transaction)
    rows = db.execute(
        select(
            Transaction.id,
            Transaction.amount,
            refund.amount,
        )
        .join(
            refund,
            and_(
                refund.refund_of == Transaction.id,
                refund.kind == "refund",
                # Same ledger as the expense: the detail page's ``refunds[]``
                # is ledger-scoped (§3.3), and these two totals describe that
                # same list, so they must not count a row it never shows.
                refund.ledger_id == ledger.id,
            ),
            isouter=True,
        )
        .where(
            Transaction.ledger_id == ledger.id,
            Transaction.kind == "expense",
            Transaction.id.in_(wanted),
        )
    ).all()

    refunded: dict[uuid.UUID, Decimal] = {}
    amounts: dict[uuid.UUID, Decimal] = {}
    for expense_id, expense_amount, refund_amount in rows:
        amounts[expense_id] = _amount(expense_amount)
        running = refunded.get(expense_id, _zero())
        if refund_amount is not None:
            running += _amount(refund_amount)
        refunded[expense_id] = running

    for expense_id, amount in amounts.items():
        total = refunded[expense_id]
        totals[expense_id] = (total, quantize_amount(abs(amount) - total))
    return totals


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------


def _validate_single(
    db: Session,
    ledger: Ledger,
    source: FinanceSource,
    values: dict[str, object],
    *,
    tx_id: uuid.UUID | None,
    current_currency: str | None = None,
) -> dict[str, object]:
    """Check a whole single row against §5.26 and return normalized columns.

    Called with the finished row, both on create and on PATCH: §5.28 judges
    "the row after the edit", not the edit. ``current_currency`` is the code the
    row already carries; it lets a PATCH that never touched the currency go
    through while Frankfurter is unreachable (:func:`fx.ensure_supported`).
    """
    kind = values["kind"]
    if kind not in KINDS:
        raise _invalid(f"kind must be one of {', '.join(KINDS)}")

    amount = _amount(values["amount"])
    if amount == 0:
        raise _invalid("amount must not be zero")

    role = values["transfer_role"]
    subtype = values["transfer_subtype"]
    merchant = _check_text(values["merchant"], "merchant", MAX_MERCHANT_LENGTH)
    note = _check_text(values["note"], "note", MAX_NOTE_LENGTH)
    counterparty = _check_text(
        values["counterparty"], "counterparty", MAX_COUNTERPARTY_LENGTH
    )
    currency = _check_currency(values["currency"], current=current_currency)

    if kind == "transfer":
        if role not in TRANSFER_ROLES:
            raise _invalid("transfer_role must be 'out' or 'in' on a transfer")
        if subtype not in TRANSFER_SUBTYPES:
            raise _invalid("transfer_subtype must be 'plain' or 'repayment' on a transfer")
        if merchant is not None:
            raise _invalid("a transfer has no merchant")
        if role == "out" and amount > 0:
            raise _invalid("the outgoing leg of a transfer must be negative")
        if role == "in" and amount < 0:
            raise _invalid("the incoming leg of a transfer must be positive")
        # A single leg has no counter leg to carry another currency (A11).
        if currency != source.default_currency:
            raise _invalid(
                "a single-leg transfer must use the account currency "
                f"({source.default_currency})"
            )
        # Only the incoming leg can be judged: the account of an outgoing
        # repayment is the one being debited, not the credit card (A11).
        if subtype == "repayment" and role == "in" and source.type != "credit":
            raise ApiError(
                400,
                ErrorCode.REPAYMENT_TARGET_NOT_CREDIT,
                "A repayment must land on a credit account",
            )
    else:
        if role is not None or subtype is not None:
            raise _invalid("transfer_role / transfer_subtype are only for transfers")
        if counterparty is not None:
            raise _invalid("counterparty is only for single-leg transfers")
        if kind == "expense" and amount > 0:
            raise _invalid("an expense must be negative")
        if kind in ("income", "refund") and amount < 0:
            raise _invalid(f"a {kind} must be positive")

    occurred_at = values["occurred_at"]
    if not isinstance(occurred_at, dt.date) or isinstance(occurred_at, dt.datetime):
        raise _invalid("occurred_at must be a date")
    if occurred_at > utcnow().date() + dt.timedelta(days=MAX_FUTURE_DAYS):
        raise _invalid("occurred_at cannot be more than one day in the future")

    category_l1 = values["category_l1"]
    category_l2 = values["category_l2"]
    refund_of = values["refund_of"]

    if refund_of is not None:
        if kind != "refund":
            raise ApiError(
                400,
                ErrorCode.REFUND_TARGET_INVALID,
                "refund_of is only allowed on a refund",
            )
        if tx_id is not None and refund_of == tx_id:
            raise ApiError(
                400, ErrorCode.REFUND_TARGET_INVALID, "A refund cannot point at itself"
            )
        target = db.get(Transaction, refund_of)
        if target is None or target.ledger_id != ledger.id or target.kind != "expense":
            raise ApiError(
                400,
                ErrorCode.REFUND_TARGET_INVALID,
                "refund_of must point at an expense in this ledger",
            )
        # Decision §1.1: linking to an original carries its category over, but
        # only when the request did not name one itself.
        if category_l1 is None:
            category_l1 = target.category_l1
            category_l2 = target.category_l2

    validate_category(kind, category_l1, category_l2)

    return {
        "source_id": source.id,
        "kind": kind,
        "amount": amount,
        "currency": currency,
        "occurred_at": occurred_at,
        "category_l1": category_l1,
        "category_l2": category_l2,
        "merchant": merchant,
        "note": note,
        "refund_of": refund_of,
        "transfer_role": role,
        "transfer_subtype": subtype,
        "counterparty": counterparty,
    }


def _refund_event(before: object, after: object) -> str | None:
    """``refund_linked`` / ``refund_unlinked`` / neither (§7.2)."""
    if before is None and after is not None:
        return "refund_linked"
    if before is not None and after is None:
        return "refund_unlinked"
    return None


def _resolve_source(
    db: Session,
    ledger: Ledger,
    edits: dict[str, object],
    key: str,
    leg: Transaction,
) -> FinanceSource:
    """The account a transfer leg ends up on, archived only if it already was."""
    source_id = edits.get(key, leg.source_id)
    source = _load_source(db, ledger, source_id)
    if source.id != leg.source_id and source.archived:
        raise ApiError(
            409, ErrorCode.SOURCE_ARCHIVED, f"Account {source.name!r} is archived"
        )
    return source


def _check_subtype(subtype: object, to_source: FinanceSource) -> str:
    """A transfer subtype plus the credit-account rule of A11."""
    if subtype not in TRANSFER_SUBTYPES:
        raise _invalid("subtype must be 'plain' or 'repayment'")
    if subtype == "repayment" and to_source.type != "credit":
        raise ApiError(
            400,
            ErrorCode.REPAYMENT_TARGET_NOT_CREDIT,
            "A repayment must land on a credit account",
        )
    return str(subtype)


def _resolve_amount_in(
    amount_in: object,
    amount_out: Decimal,
    currency_out: str,
    currency_in: str,
) -> Decimal:
    """``amount_in`` may be omitted only when both legs share a currency (A11)."""
    if amount_in is None:
        if currency_in != currency_out:
            raise _invalid("amount_in is required when the two legs differ in currency")
        return amount_out
    return _positive_amount(amount_in, "amount_in")


def _check_currency(currency: object, current: str | None = None) -> str:
    """Upper-cased three-letter code Frankfurter knows (§5.26, §6).

    ``current`` is the code already stored on the row being edited: an upstream
    outage must not turn a PATCH of an unrelated field into a 503.
    """
    if not isinstance(currency, str) or not CURRENCY_RE.match(currency):
        raise _invalid("currency must be three letters")
    return fx.ensure_supported(currency, current)


def _check_text(value: object, field: str, limit: int) -> str | None:
    """Trim an optional free-text column; blank becomes NULL, over-long is 400."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise _invalid(f"{field} must be a string")
    trimmed = value.strip()
    if not trimmed:
        return None
    if len(trimmed) > limit:
        raise _invalid(f"{field} must be at most {limit} characters")
    return trimmed


def _positive_amount(value: object, field: str) -> Decimal:
    """A transfer leg amount: strictly positive, four decimals."""
    amount = _amount(value)
    if amount <= 0:
        raise _invalid(f"{field} must be greater than 0")
    return amount


def _amount(value: object) -> Decimal:
    """Any numeric input as a four-decimal ``Decimal`` that fits the column (§4.5).

    The range check is the same rule as :data:`MAX_MERCHANT_LENGTH` and friends:
    NUMERIC(18, 4) holds 14 digits before the point, so a bigger number is
    answered with 400 ``validation_error`` here instead of travelling down to
    Postgres and coming back as a 500.
    """
    try:
        raw = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise _invalid("amount must be a number") from None
    if not raw.is_finite():
        raise _invalid("amount must be a number")
    # Checked before quantizing as well: ``Decimal.quantize`` itself raises on a
    # value too large for the arithmetic context (e.g. 1e40).
    if abs(raw) >= MAX_AMOUNT:
        raise _too_large()

    amount = quantize_amount(raw)
    if abs(amount) >= MAX_AMOUNT:    # rounded up across the boundary
        raise _too_large()
    return amount


def _too_large() -> ApiError:
    return _invalid(
        "amount must have at most "
        f"{MAX_AMOUNT_INTEGER_DIGITS} digits before the decimal point"
    )


def _zero() -> Decimal:
    return quantize_amount(Decimal("0"))


def _invalid(detail: str) -> ApiError:
    return ApiError(400, ErrorCode.VALIDATION_ERROR, detail)


# ---------------------------------------------------------------------------
# Loading helpers
# ---------------------------------------------------------------------------


def _clean_changes(
    changes: dict[str, object], allowed: Sequence[str]
) -> dict[str, object]:
    """Keep the editable keys of a PATCH body, reject the immutable ones.

    ``updated_at`` is the version token of §4.4, not a column, so a caller may
    hand the whole request body over untouched.
    """
    edits: dict[str, object] = {}
    for key, value in changes.items():
        if key == _VERSION_KEY:
            continue
        if key not in allowed:
            raise _invalid(f"{key} cannot be changed")
        edits[key] = value
    return edits


def _as_dict(data: SingleTxInput) -> dict[str, object]:
    return {field: getattr(data, field) for field in SINGLE_FIELDS}


def _load_source(
    db: Session, ledger: Ledger, source_id: object
) -> FinanceSource:
    """An account of this ledger; anything else is invisible (§3.3)."""
    source = db.get(FinanceSource, source_id) if source_id is not None else None
    if source is None or source.ledger_id != ledger.id:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Account not found")
    return source


def _load_transaction(
    db: Session, ledger: Ledger, transaction_id: uuid.UUID
) -> Transaction:
    """A transaction of this ledger, or 404 (§3.3)."""
    tx = db.get(Transaction, transaction_id)
    if tx is None or tx.ledger_id != ledger.id:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Transaction not found")
    return tx


def _lock_transaction(db: Session, transaction_id: uuid.UUID) -> Transaction | None:
    """``SELECT ... FOR UPDATE`` on one row (§4.4); SQLite ignores the clause."""
    return db.execute(
        select(Transaction)
        .where(Transaction.id == transaction_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def _pair_legs(
    db: Session,
    ledger: Ledger,
    pair_id: uuid.UUID,
    *,
    for_update: bool = False,
) -> list[Transaction]:
    """Every row carrying this ``transfer_pair_id`` in this ledger."""
    stmt = (
        select(Transaction)
        .where(
            Transaction.ledger_id == ledger.id,
            Transaction.transfer_pair_id == pair_id,
        )
        .order_by(Transaction.transfer_role)
    )
    if for_update:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    return list(db.execute(stmt).scalars().all())


def _split_legs(
    legs: Sequence[Transaction], code: str, status_code: int
) -> tuple[Transaction, Transaction]:
    """Sort legs into ``(out, in)``; anything but one of each is an error."""
    out_legs = [leg for leg in legs if leg.transfer_role == "out"]
    in_legs = [leg for leg in legs if leg.transfer_role == "in"]
    if len(out_legs) != 1 or len(in_legs) != 1 or len(legs) != 2:
        raise ApiError(
            status_code, code, "A transfer needs exactly one outgoing and one incoming leg"
        )
    return out_legs[0], in_legs[0]
