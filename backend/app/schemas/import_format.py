"""Response schema for ``GET /import-format`` (04-frontend.md §3.3, 05 §5.5).

The shape here follows the frontend's ``ImportFormat`` interface exactly
(04-frontend.md §3.3), which is the source of truth this task was pointed at:
``version`` / ``headers`` / ``columns`` / ``sample_csv`` / ``skill_text`` /
``skill_markdown`` / ``instructions_zh`` / ``instructions_en``. It is a public,
identity-free endpoint (decision §6, §11) so this schema carries no ledger or
user data.
"""
from __future__ import annotations

from app.schemas.common import ApiModel


class ImportFormatColumn(ApiModel):
    """One row of the 11-column reference table (05 §1.2)."""

    name: str
    required: bool
    desc_zh: str
    desc_en: str


class ImportFormat(ApiModel):
    """The whole body of ``GET /import-format`` (04 §3.3)."""

    version: str
    headers: list[str]
    columns: list[ImportFormatColumn]
    sample_csv: str
    skill_text: str
    skill_markdown: str
    instructions_zh: str
    instructions_en: str
