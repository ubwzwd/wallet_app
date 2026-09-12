"""Shared schema base classes and serialization conventions (03-backend-api.md §4.5).

``ApiModel`` is the base every response schema inherits from (builds from ORM
attributes). ``ApiRequestModel`` is the base every request schema inherits
from (rejects unknown fields, per §10.2). ``UtcDatetime`` is the annotated
datetime type every timestamp field (``created_at``, ``updated_at``,
``expires_at``, ...) uses, so serialization is always
``"2026-09-08T11:20:31.442000Z"`` regardless of how the value is stored.

``Amount`` / ``Rate`` are the quantized-``Decimal`` annotated types every
money / exchange-rate field in the API uses (§4.5: 4 decimals for money, 8 for
a rate) — defined once here and imported by ``transaction.py``,
``finance_source.py`` and ``stats.py`` so the quantizing behaviour, including
the ``InvalidOperation`` guard below, only has to be fixed in one place.
"""
from __future__ import annotations

import datetime as dt
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Annotated, Generic, TypeVar

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, PlainSerializer


# ISO 4217 codes are accepted in either case and upper-cased server side
# (§4.5). Defined here once; every schema that takes a currency imports it.
CURRENCY_PATTERN = r"^[A-Za-z]{3}$"

AMOUNT_QUANTUM = Decimal("0.0001")
RATE_QUANTUM = Decimal("0.00000001")


def _quantize_amount(value: Decimal) -> Decimal:
    """Quantize to 4 dp; an out-of-precision value (e.g. ``1e40``) is a 422, not a 500.

    ``Decimal.quantize`` raises ``decimal.InvalidOperation`` when the result
    would need more digits than the current arithmetic context's precision
    (28 by default). Pydantic only turns ``ValueError``/``AssertionError``
    into a validation error, so that has to be caught and re-raised here.
    """
    try:
        return value.quantize(AMOUNT_QUANTUM, rounding=ROUND_HALF_UP)
    except InvalidOperation as exc:
        raise ValueError("amount out of range") from exc


def _quantize_rate(value: Decimal) -> Decimal:
    """Quantize to 8 dp; see ``_quantize_amount`` for why ``InvalidOperation`` is caught."""
    try:
        return value.quantize(RATE_QUANTUM, rounding=ROUND_HALF_UP)
    except InvalidOperation as exc:
        raise ValueError("rate out of range") from exc


# A quantized amount with no sign constraint (list/detail responses, legs).
Amount = Annotated[Decimal, AfterValidator(_quantize_amount)]
# A quantized exchange rate (§5.30 ``rate``, §5.20 ``balance_rate``, ...).
Rate = Annotated[Decimal, AfterValidator(_quantize_rate)]


class ApiModel(BaseModel):
    """Base class for response schemas: reads straight off ORM objects."""

    model_config = ConfigDict(from_attributes=True)


class ApiRequestModel(BaseModel):
    """Base class for request schemas: unknown fields are a 422 (§10.2)."""

    model_config = ConfigDict(extra="forbid")


def _parse_utc_datetime(value: object) -> object:
    """Accept a naive, ``Z``-suffixed, or offset-aware datetime (str or ``datetime``).

    A naive value (no ``Z``, no offset) is treated as already-UTC and left as
    is. An aware value — ``Z`` suffix or an explicit offset — is converted to
    UTC and its tzinfo dropped, since storage is naive-UTC (§4.5). Non-string,
    non-datetime input is passed through unchanged so pydantic reports its
    own type error.
    """
    if isinstance(value, str):
        text = value.strip()
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"
        parsed = dt.datetime.fromisoformat(text)
    elif isinstance(value, dt.datetime):
        parsed = value
    else:
        return value

    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(dt.timezone.utc).replace(tzinfo=None)
    return parsed


def _serialize_utc_datetime(value: dt.datetime) -> str:
    """Render as ISO-8601 UTC with a ``Z`` suffix and microseconds, always."""
    if value.tzinfo is not None:
        value = value.astimezone(dt.timezone.utc).replace(tzinfo=None)
    return value.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


UtcDatetime = Annotated[
    dt.datetime,
    BeforeValidator(_parse_utc_datetime),
    PlainSerializer(_serialize_utc_datetime, return_type=str),
]


T = TypeVar("T")


class ListResponse(ApiModel, Generic[T]):
    """The shared list shape every list endpoint returns (§4.3): items + total."""

    items: list[T]
    total: int
