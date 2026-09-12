"""Transaction event trail (03-backend-api.md §7, decision §14.51).

Every write path that touches a transaction appends one line of "who did what
to it, when". Three rules shape this module:

* **Append only** (§7.2). Nothing here updates or deletes an event; the rows go
  away only with their transaction, through the ``ON DELETE CASCADE`` on
  ``transaction_events.transaction_id``.
* **Same transaction as the write** (§7.3 rule 1). :func:`record` only ``add()``s
  to the caller's ``Session``; the endpoint commits. A transaction that was
  written while its event was not is a state this application never reaches.
* **Values already in API shape** (§7.3 rule 3). ``changes`` stores
  ``"-45.5000"``, not ``Decimal("-45.5")``, and ``"2026-09-01"``, not a
  ``date`` — the frontend renders the trail without guessing types (§4.5).

:func:`diff_changes` is what keeps "only fields that really changed" honest: it
compares the raw values (so ``Decimal("-45.50")`` and ``Decimal("-45.5000")``
are the same amount, not an edit) and serializes only the survivors.
"""
import datetime as dt
import uuid
from decimal import Decimal
from typing import Literal, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models.transaction_event import TransactionEvent
from app.services.valuation import quantize_amount

# The seven event names of decision §14.51 — no more, no fewer.
EventName = Literal[
    "created",
    "updated",
    "imported",
    "paired",
    "unpaired",
    "refund_linked",
    "refund_unlinked",
]

# ``transaction_events.client`` is VARCHAR(16) (02-database.md §1.9) and 03
# §4.7 says the same width since the 2026-09-12 sync;
# ``core/deps.CLIENT_NAME_MAX_LENGTH`` cuts the header to it upstream and this
# is the last line of defence, so an over-long name can never become a Postgres
# DataError (500) on INSERT.
MAX_CLIENT_LENGTH = 16


def record(
    db: Session,
    *,
    ledger_id: uuid.UUID,
    transaction_id: uuid.UUID,
    actor_id: uuid.UUID,
    event: EventName,
    changes: dict[str, dict] | None = None,
    import_batch_id: uuid.UUID | None = None,
    client: str | None = None,
    at: dt.datetime | None = None,
) -> TransactionEvent:
    """Append one event to the caller's session (§7.3 rule 1).

    Only ``add()`` — no flush, no commit: the endpoint owns the transaction, so
    the event lands exactly when the write it describes does. ``changes`` is
    ``{field: {"before": ..., "after": ...}}`` already serialized by
    :func:`diff_changes`; ``created`` and ``imported`` pass ``None``.
    ``client`` is cut to the width of its column (:data:`MAX_CLIENT_LENGTH`).

    ``at`` defaults to "right now"; a caller that also stamps the row hands in
    the very value it wrote to ``transactions.updated_at``, because 02-database
    §1.9 asks for one instant per operation — the two events one PATCH may
    write then carry the same ``at`` as the row they describe.
    """
    row = TransactionEvent(
        ledger_id=ledger_id,
        transaction_id=transaction_id,
        actor_id=actor_id,
        at=utcnow() if at is None else at,
        event=event,
        changes=changes,
        import_batch_id=import_batch_id,
        client=client[:MAX_CLIENT_LENGTH] if client else None,
    )
    db.add(row)
    return row


def list_for(db: Session, transaction_id: uuid.UUID) -> list[TransactionEvent]:
    """Every event of one transaction, newest first (§5.27's ``events[]``).

    ``id`` breaks the tie: the two events one operation may write share its
    timestamp (§1.9), so ``at`` alone would leave their order to the database.
    Not paged on purpose: a transaction normally carries a handful of events
    (§7.3 rule 5).
    """
    return list(
        db.execute(
            select(TransactionEvent)
            .where(TransactionEvent.transaction_id == transaction_id)
            .order_by(TransactionEvent.at.desc(), TransactionEvent.id.desc())
        )
        .scalars()
        .all()
    )


def diff_changes(
    before: dict[str, object], after: dict[str, object]
) -> dict[str, dict]:
    """``changes`` for the fields that really changed, serialized per §4.5.

    Keys whose value is unchanged are dropped, which is what makes "nothing
    really changed → write no event" (§5.28) a one-line check on the result.
    Comparison happens on the raw values, so a ``Decimal`` that only differs in
    scale is not an edit.
    """
    changed: dict[str, dict] = {}
    keys: list[str] = list(before)
    keys.extend(key for key in after if key not in before)

    for key in keys:
        old = before.get(key)
        new = after.get(key)
        if _same(old, new):
            continue
        changed[key] = {"before": serialize(old), "after": serialize(new)}
    return changed


def snapshot(obj: object, fields: Sequence[str]) -> dict[str, object]:
    """Read ``fields`` off a model instance into a plain dict for diffing."""
    return {field: getattr(obj, field) for field in fields}


def serialize(value: object) -> object:
    """One value in the shape the API would give it (§4.5, §7.3 rule 3)."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, Decimal):
        return format(quantize_amount(value), "f")
    if isinstance(value, dt.datetime):
        return value.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, str):
        return value
    return str(value)


def _same(old: object, new: object) -> bool:
    """Whether two raw field values mean the same thing."""
    if old is None or new is None:
        return old is None and new is None
    try:
        return bool(old == new)
    except TypeError:  # pragma: no cover - defensive, values are scalars
        return False
