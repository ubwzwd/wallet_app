"""`/me` schemas (03-backend-api.md §5.3-§5.4)."""
import uuid
from typing import Literal

from pydantic import Field, field_validator

from app.schemas.common import ApiModel, ApiRequestModel, UtcDatetime

CURRENCY_PATTERN = r"^[A-Za-z]{3}$"


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

    ``base_currency`` deliberately keeps a plain ``str`` annotation with a
    ``None`` default: an *omitted* field keeps that default untouched (never
    validated, per pydantic's ``validate_default=False``), while an
    *explicit* ``null`` fails the ``str`` type check and becomes a 422 —
    exactly the "does not accept null" rule in §5.4. ``language`` and
    ``display_name`` are the two fields where explicit ``null`` is legal
    (reset to "follow system" / clear the name), so they are plain
    ``Optional`` fields instead.
    """

    base_currency: str = Field(default=None, pattern=CURRENCY_PATTERN)
    language: Literal["zh", "en"] | None = None
    display_name: str | None = None

    @field_validator("base_currency")
    @classmethod
    def _uppercase_currency(cls, value: str) -> str:
        return value.upper()

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
