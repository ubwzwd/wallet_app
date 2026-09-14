"""Types shared by the import modules: drafts, context, errors (05 §0.3).

``validation.py`` re-exports everything here, so the contract of §0.3 reads the
way the design writes it (``from ...importing.validation import RowDraft``).
They live in their own module only because ``reading.py`` needs the error class
and ``rules.py`` needs the draft, and neither should have to import the other.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from uuid import UUID

from app.core.errors import ApiError, ErrorCode

#: The fixed header, in order, case-sensitive (§1.1). No aliases, no fuzzy
#: matching: a mismatch means an outdated skill or a hand-edited file (§2.2).
COLUMNS: tuple[str, ...] = (
    "date",
    "amount",
    "currency",
    "kind",
    "transfer_role",
    "transfer_subtype",
    "merchant",
    "note",
    "category_l1",
    "category_l2",
    "source_ref",
)

KINDS: tuple[str, ...] = ("expense", "income", "refund", "transfer")
TRANSFER_ROLES: tuple[str, ...] = ("out", "in")
TRANSFER_SUBTYPES: tuple[str, ...] = ("plain", "repayment")

#: Matches the first line when it is a version comment; group 1 is the value.
VERSION_RE = re.compile(r"^\s*#\s*version\s*:\s*(\S.*?)\s*$")

#: Where the app's import guide lives, as a **path template**; carried by
#: ``skill_outdated`` (§2.3). The real route is ledger-scoped
#: (``/l/:ledgerId/imports/guide``, 04 §4.10) and the frontend pushes whatever
#: the response hands it verbatim, so the value that goes on the wire can only
#: be built where the ledger is known — the endpoint layer fills
#: ``{ledger_id}`` in (``app/api/imports.py``). Nothing in ``services/importing``
#: formats it: the service layer must not depend on the route shape.
GUIDE_URL = "/l/{ledger_id}/imports/guide"

MAX_ERRORS = 50  # §2.2: list at most this many, count the rest in `detail`
MAX_MERCHANT = 200
MAX_NOTE = 500
MAX_SOURCE_REF = 100
MAX_HINT = 500  # import_rows.hint is VARCHAR(500) (02 §1.8)

MIN_DATE = date(2000, 1, 1)
AMOUNT_LIMIT = Decimal("100000000")  # §2.4 ②: flag anything larger
AMOUNT_QUANT = Decimal("0.0001")

DECODE_MESSAGE = "文件不是 UTF-8 文本，请让 ChatGPT / Claude 重新导出为 UTF-8 的 CSV"
MISSING_VERSION_MESSAGE = '第 1 行应为 "# version: <日期串>"，请用导入指南页的 skill 重新导出'
MISSING_HEADER_MESSAGE = f"第 2 行应为 {len(COLUMNS)} 列固定表头：{','.join(COLUMNS)}"


class ImportFormatInvalid(ApiError):
    """400 ``import_format_invalid`` with the per-line list of §2.2.

    ``errors`` is an extension field on this one code (03 §5.37): the standard
    ``{detail, code}`` body still applies, so a client may ignore it. The
    shared error handler only serialises ``detail`` and ``code``, so the import
    endpoint renders :meth:`body` itself.
    """

    def __init__(
        self,
        errors: list[dict],
        detail: str | None = None,
        total: int | None = None,
    ) -> None:
        count = len(errors) if total is None else total
        if detail is None:
            detail = f"CSV structure is invalid: {count} problem(s)"
            if count > len(errors):
                detail += f", {count - len(errors)} more not listed"
        super().__init__(400, ErrorCode.IMPORT_FORMAT_INVALID, detail)
        self.errors = errors

    def body(self) -> dict:
        """The full response body, ``errors`` included (03 §5.37)."""
        return {"detail": self.detail, "code": self.code, "errors": self.errors}


class SkillOutdated(ApiError):
    """400 ``skill_outdated``: the file's version is not the current one (§2.3)."""

    def __init__(
        self, file_version: str, current_version: str, guide_url: str = GUIDE_URL
    ) -> None:
        super().__init__(
            400,
            ErrorCode.SKILL_OUTDATED,
            "Import file was produced by an outdated skill "
            f"(file: {file_version}, current: {current_version})",
        )
        self.file_version = file_version
        self.current_version = current_version
        self.guide_url = guide_url

    def body(self) -> dict:
        """The full response body, version fields included (03 §5.37)."""
        return {
            "detail": self.detail,
            "code": self.code,
            "current_version": self.current_version,
            "file_version": self.file_version,
            "guide_url": self.guide_url,
        }


@dataclass(frozen=True)
class ImportContext:
    """Read-only context assembled once per upload (§0.3).

    This object **is logged**, so it carries no statement content whatsoever —
    only ids, the two currencies and the account type (§6.3).
    """

    ledger_id: UUID
    source_id: UUID
    source_currency: str
    source_type: str  # checking / credit / cash / other (decision §14.48)
    base_currency: str
    actor_id: UUID
    category_version: str


@dataclass
class RowDraft:
    """One draft row in memory; fields mirror ``import_rows`` (02 §1.8)."""

    row_no: int
    occurred_at: date | None  # the file column is `date` (decision §14.41 02-D-3)
    amount: Decimal
    currency: str
    kind: str
    transfer_role: str | None
    transfer_subtype: str | None
    merchant: str | None
    note: str | None
    category_l1: str | None
    category_l2: str | None
    source_ref: str | None
    counterparty: str | None = None  # always None; filled in review (decision §14.16)
    matched_transaction_id: UUID | None = None
    counterpart_source_id: UUID | None = None
    hint: str | None = None
    flags: set[str] = field(default_factory=set)
    # No candidate list field: multiple candidates are neither pre-filled nor
    # stored nor returned (decision §14.53b); matched_transaction_id is the
    # only carrier of "which one was picked".


def add_hint(row: RowDraft, message: str) -> None:
    """Append, never overwrite: one row can trip several rules (§2.5)."""
    text = message if not row.hint else f"{row.hint}；{message}"
    if len(text) > MAX_HINT:
        text = text[: MAX_HINT - 1] + "…"
    row.hint = text
