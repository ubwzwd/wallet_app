"""Structure, version and row checks for a standard import CSV (05 §2).

Three jobs, in the order §2.1 fixes:

* ``check_shape()`` — the ``# version:`` line, the 11-column header and every
  record's width. It reports **all** problems at once (§2.2): the user should
  be able to fix a file in one pass.
* ``check_version()`` — the version string must equal ``CATEGORY_VERSION``
  exactly (§2.3). A missing version *line* is not judged here; ``check_shape()``
  has already rejected it as a structure error (decision §14.53d).
* ``normalize_rows()`` — §2.4's per-row rules (in ``rules.py``) plus §2.7's
  intra-batch duplicate check. These never reject a file and never drop a row:
  a bad date, a non-numeric amount or an unknown ``kind`` are corrected, written
  into the row's ``hint`` and flagged ``needs_review`` so the user settles them
  in the review table (decision §5).

Nothing in this module touches the database: text in, drafts out.
"""
from __future__ import annotations

from collections import defaultdict
from itertools import zip_longest
from typing import TYPE_CHECKING

from app.core.clock import utcnow
from app.core.config import settings
from app.core.errors import ApiError, ErrorCode
from app.services.importing.drafts import (
    AMOUNT_LIMIT,
    COLUMNS,
    DECODE_MESSAGE,
    GUIDE_URL,
    KINDS,
    MAX_ERRORS,
    MAX_HINT,
    MAX_MERCHANT,
    MAX_NOTE,
    MAX_SOURCE_REF,
    MIN_DATE,
    MISSING_HEADER_MESSAGE,
    MISSING_VERSION_MESSAGE,
    TRANSFER_ROLES,
    TRANSFER_SUBTYPES,
    VERSION_RE,
    ImportContext,
    ImportFormatInvalid,
    RowDraft,
    SkillOutdated,
    add_hint,
)
from app.services.importing.rules import (
    mask_pan,
    normalize_row,
    parse_amount,
    sanitize_category,
)

if TYPE_CHECKING:  # pragma: no cover - only needed for annotations
    from app.services.importing.reading import RawFile

# The names of §0.3 live here even though a few are defined next door, so that
# every other module can import the whole contract from one place.
__all__ = [
    "AMOUNT_LIMIT",
    "COLUMNS",
    "DECODE_MESSAGE",
    "GUIDE_URL",
    "KINDS",
    "MAX_ERRORS",
    "MAX_HINT",
    "MAX_MERCHANT",
    "MAX_NOTE",
    "MAX_SOURCE_REF",
    "MIN_DATE",
    "MISSING_HEADER_MESSAGE",
    "MISSING_VERSION_MESSAGE",
    "TRANSFER_ROLES",
    "TRANSFER_SUBTYPES",
    "VERSION_RE",
    "ImportContext",
    "ImportFormatInvalid",
    "RowDraft",
    "SkillOutdated",
    "add_hint",
    "check_row_limit",
    "check_shape",
    "check_version",
    "flag_intra_batch_duplicates",
    "mask_pan",
    "normalize_rows",
    "parse_amount",
    "sanitize_category",
]


def check_shape(raw: "RawFile") -> None:
    """Structure check: version line, 11-column header, per-record width (§2.2).

    Raises ``ImportFormatInvalid`` carrying a per-line list. The width check
    reports every offending line at once (capped at ``MAX_ERRORS``, with the
    rest counted in ``detail``) — stopping at the first one would make the user
    re-upload once per bad row.
    """
    if raw.version_line is None:
        raise _missing_version_error()
    if raw.header is None:
        raise ImportFormatInvalid(
            [{"line": 2, "message": MISSING_HEADER_MESSAGE}],
            detail="CSV structure is invalid: missing header line",
        )

    errors: list[dict] = []
    header = [name.strip() for name in raw.header]
    if tuple(header) != COLUMNS:
        errors.append({"line": 2, "message": _header_message(header)})
    for line, row in zip(raw.row_numbers, raw.rows):
        if len(row) != len(COLUMNS):
            errors.append(
                {"line": line, "message": f"该行有 {len(row)} 列，应为 {len(COLUMNS)} 列"}
            )
    if errors:
        raise ImportFormatInvalid(errors[:MAX_ERRORS], total=len(errors))


def check_version(raw: "RawFile", current: str) -> str:
    """Compare the ``# version:`` value with ``current`` and return it (§2.3).

    Equality is exact and there is no "continue with a warning": a changed
    category table means the old skill can emit codes that no longer exist
    (decision §14.30).
    """
    file_version = _version_value(raw.version_line)
    if file_version is None:
        raise _missing_version_error()
    if file_version != current:
        raise SkillOutdated(file_version, current)
    return file_version


def check_row_limit(raw: "RawFile") -> None:
    """§2.6: at most ``IMPORT_MAX_ROWS`` data rows, never truncated.

    The 2 MB ceiling is the endpoint's to enforce (413 ``file_too_large``): it
    is a property of the request, not of the parsed file.
    """
    count = len(raw.rows)
    if count > settings.IMPORT_MAX_ROWS:
        raise ApiError(
            400,
            ErrorCode.ROWS_EXCEED_LIMIT,
            f"文件有 {count} 行，超过单批 {settings.IMPORT_MAX_ROWS} 行上限，请拆成多份",
        )


def normalize_rows(raw: "RawFile", ctx: ImportContext) -> list[RowDraft]:
    """§2.4's per-row rules plus §2.7's intra-batch duplicate check.

    Corrects, never drops: the result has exactly one draft per data row, in
    file order, and ``row_no`` is the 1-based **data** row number (02 §1.8),
    not the physical line ``RawFile.row_numbers`` carries.
    """
    check_row_limit(raw)
    today = utcnow().date()
    rows = [
        normalize_row(row_no, fields, ctx, today)
        for row_no, fields in enumerate(raw.rows, start=1)
    ]
    flag_intra_batch_duplicates(rows)
    return rows


def flag_intra_batch_duplicates(rows: list[RowDraft]) -> None:
    """§2.7: rows identical in all 11 columns are kept, flagged and cross-named.

    Merging them would be a silent loss: two identical coffees on the same day
    really happen (decision §14.31). The user decides in review.
    """
    groups: dict[tuple, list[RowDraft]] = defaultdict(list)
    for row in rows:
        groups[
            (
                row.occurred_at,
                row.amount,
                row.currency,
                row.kind,
                row.transfer_role,
                row.transfer_subtype,
                row.merchant,
                row.note,
                row.category_l1,
                row.category_l2,
                row.source_ref,
            )
        ].append(row)
    for same in groups.values():
        if len(same) < 2:
            continue
        numbers = "、".join(str(row.row_no) for row in same)
        for row in same:
            row.flags.add("needs_review")
            add_hint(row, f"本批内有相同的行（第 {numbers} 行）")


def _missing_version_error() -> ImportFormatInvalid:
    return ImportFormatInvalid(
        [{"line": 1, "message": MISSING_VERSION_MESSAGE}],
        detail="CSV structure is invalid: missing '# version:' line",
    )


def _version_value(version_line: str | None) -> str | None:
    if version_line is None:
        return None
    match = VERSION_RE.match(version_line)
    return match.group(1) if match else None


def _header_message(header: list[str]) -> str:
    """Name what is missing, what is extra, and the first position that differs."""
    parts: list[str] = []
    missing = [name for name in COLUMNS if name not in header]
    extra = [name for name in header if name not in COLUMNS]
    if missing:
        parts.append("缺少 " + "、".join(missing))
    if extra:
        parts.append("多出 " + "、".join(extra))
    for index, (want, got) in enumerate(zip_longest(COLUMNS, header), start=1):
        if want != got:
            parts.append(f"第 {index} 列应为 {want or '（无）'}，实际为 {got or '（无）'}")
            break
    return "第 2 行表头不对：" + "；".join(parts)
