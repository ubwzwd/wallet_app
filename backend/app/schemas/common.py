"""Shared schema base classes and serialization conventions (03-backend-api.md §4.5).

``ApiModel`` is the base every response schema inherits from (builds from ORM
attributes). ``ApiRequestModel`` is the base every request schema inherits
from (rejects unknown fields, per §10.2). ``UtcDatetime`` is the annotated
datetime type every timestamp field (``created_at``, ``updated_at``,
``expires_at``, ...) uses, so serialization is always
``"2026-09-08T11:20:31.442000Z"`` regardless of how the value is stored.
"""
from __future__ import annotations

import datetime as dt
from typing import Annotated, Generic, TypeVar

from pydantic import BaseModel, BeforeValidator, ConfigDict, PlainSerializer


# ISO 4217 codes are accepted in either case and upper-cased server side
# (§4.5). Defined here once; every schema that takes a currency imports it.
CURRENCY_PATTERN = r"^[A-Za-z]{3}$"


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
