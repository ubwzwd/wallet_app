"""Structural tests locking down PROF-03 contract."""
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _load_source(relative: str) -> str:
    return (BACKEND_ROOT / relative).read_text()


def test_create_finance_source_assigns_default_when_first():
    src = _load_source("app/api/finance_sources.py")
    # D-09: post-commit count guard assigning default_source_id
    assert "default_source_id" in src, \
        "create_finance_source must assign default_source_id (D-09, PROF-03)"
    # Must count sources
    assert ".count()" in src, \
        "create_finance_source must count user's sources to guard auto-default (D-09)"
    # Guard must be count == 1 (post-commit)
    assert "== 1" in src, \
        "Auto-default must use count == 1 guard (D-09)"


def test_create_finance_source_auto_default_occurs_after_refresh():
    """Auto-default block must appear after db.refresh(new_source) in source order (D-09)."""
    src = _load_source("app/api/finance_sources.py")
    refresh_idx = src.find("db.refresh(new_source)")
    assign_idx = src.find("default_source_id = new_source.id")
    assert refresh_idx != -1, "db.refresh(new_source) must exist"
    assert assign_idx != -1, "default_source_id = new_source.id assignment must exist"
    assert assign_idx > refresh_idx, \
        "Auto-default assignment must happen AFTER db.refresh(new_source) (D-09)"
