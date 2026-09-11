"""`/me` schemas (03-backend-api.md §5.3-§5.4)."""
import uuid
from typing import Literal

from pydantic import Field, field_validator

from app.schemas.common import CURRENCY_PATTERN, ApiModel, ApiRequestModel, UtcDatetime


class MeResponse(ApiModel):
    """§5.3 response."""

    id: uuid.UUID
    email: str
    display_name: str | None
    base_currency: str
    language: Literal["zh", "en"] | None
    created_at: UtcDatetime
    ledger_count: int


class MePatch(ApiRequestModel):
    """§5.4 request body: three optional fields with ``exclude_unset`` semantics.

    ``base_currency`` is annotated ``str | None`` because that is what the
    attribute really holds when the field is omitted; the "does not accept
    null" rule of §5.4 is enforced where it belongs, by a ``mode="before"``
    validator that turns an *explicit* ``null`` into a 422. An *omitted* field
    keeps the default untouched (defaults are not validated) and stays out of
    ``model_fields_set``, which is what makes it mean "leave it alone".
    ``language`` and ``display_name`` are the two fields where explicit
    ``null`` is legal (reset to "follow system" / clear the name).
    """

    base_currency: str | None = Field(default=None, pattern=CURRENCY_PATTERN)
    language: Literal["zh", "en"] | None = None
    display_name: str | None = None

    @field_validator("base_currency", mode="before")
    @classmethod
    def _reject_null_currency(cls, value: object) -> object:
        if value is None:
            raise ValueError("base_currency does not accept null")
        return value

    @field_validator("base_currency")
    @classmethod
    def _uppercase_currency(cls, value: str | None) -> str | None:
        return value.upper() if value is not None else value

    @field_validator("display_name")
    @classmethod
    def _normalize_display_name(cls, value: str | None) -> str | None:
        """``strip()`` then 1..40 chars; ``None`` or blank means "clear" (§5.4)."""
        if value is None:
            return None
        stripped = value.strip()
        if stripped == "":
            return None
        if len(stripped) > 40:
            raise ValueError("display_name must be at most 40 characters after stripping")
        return stripped
