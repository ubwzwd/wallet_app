"""Tests for ``scripts/gen_import_skill.py`` (05-import-and-llm.md §5.4).

Covers the two acceptance criteria the task calls out explicitly:

- ``--check`` exits 0 when the committed deliverables are up to date with the
  templates + ``core/categories.py``, and non-zero (naming the stale file)
  the moment one byte drifts — this is what CI relies on to catch "changed
  categories.py, forgot to re-run the generator".
- The rules list and the delivery blurb are genuinely the *same file* read
  twice, not two texts a human is expected to keep in sync by eye (§5.1's
  "逐字相同" claim) — proven by asserting the literal content of
  ``_rules.md`` shows up unchanged inside both generated wrappers.
"""
import importlib.util
import pathlib
import subprocess
import sys

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "gen_import_skill.py"
TPL_DIR = REPO_ROOT / "scripts" / "templates"
OUT_DIR = REPO_ROOT / "skills" / "wallet-import"


def _run_check() -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--check"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )


def _run_generate() -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )


@pytest.fixture()
def restore_generated_files():
    """Regenerate the real deliverables after a test that deliberately dirties them.

    These files live in the actual repo tree (the generator has no output-dir
    override), so a test that corrupts one to prove ``--check`` catches it
    must put the tree back exactly as ``gen_import_skill.py`` would leave it,
    or it would bleed into every other test/commit in this worktree.
    """
    originals = {p: p.read_text(encoding="utf-8") for p in OUT_DIR.iterdir() if p.is_file()}
    try:
        yield
    finally:
        result = _run_generate()
        assert result.returncode == 0, f"failed to restore generated files: {result.stderr}"
        for path, text in originals.items():
            # Sanity: regeneration reproduces byte-identical content to what was
            # there before the test touched anything (nothing else raced us).
            if path.name in ("SKILL.md", "chatgpt-instructions.md", "example.csv"):
                assert path.read_text(encoding="utf-8") == text


# ---------------------------------------------------------------------------
# --check on an up-to-date tree
# ---------------------------------------------------------------------------


def test_check_passes_when_generated_files_are_current():
    # Make sure the tree is actually current first (idempotent — same content in, same out).
    generate = _run_generate()
    assert generate.returncode == 0, generate.stderr

    result = _run_check()
    assert result.returncode == 0, f"stdout={result.stdout!r} stderr={result.stderr!r}"


def test_generation_is_idempotent():
    """Running the generator twice in a row must produce byte-identical output."""
    _run_generate()
    before = {p.name: p.read_text(encoding="utf-8") for p in OUT_DIR.iterdir() if p.is_file()}
    result = _run_generate()
    assert result.returncode == 0
    after = {p.name: p.read_text(encoding="utf-8") for p in OUT_DIR.iterdir() if p.is_file()}
    assert before == after


# ---------------------------------------------------------------------------
# --check catches drift
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("target", ["SKILL.md", "chatgpt-instructions.md", "example.csv"])
def test_check_fails_when_a_generated_file_drifts(target, restore_generated_files):
    _run_generate()
    path = OUT_DIR / target
    original = path.read_text(encoding="utf-8")
    path.write_text(original + "x", encoding="utf-8")

    result = _run_check()

    assert result.returncode != 0
    assert target in result.stdout or target in result.stderr


def test_check_fails_when_a_deliverable_is_entirely_missing(restore_generated_files):
    _run_generate()
    path = OUT_DIR / "SKILL.md"
    path.unlink()

    result = _run_check()

    assert result.returncode != 0
    assert "SKILL.md" in result.stdout or "SKILL.md" in result.stderr


# ---------------------------------------------------------------------------
# "逐字相同" (§5.1/§5.3): _rules.md / _delivery.md are one shared source
# ---------------------------------------------------------------------------


def test_rules_file_content_appears_verbatim_in_both_wrappers():
    _run_generate()
    rules_text = (TPL_DIR / "_rules.md").read_text(encoding="utf-8").rstrip("\n")
    skill_md = (OUT_DIR / "SKILL.md").read_text(encoding="utf-8")
    chatgpt_md = (OUT_DIR / "chatgpt-instructions.md").read_text(encoding="utf-8")

    assert rules_text in skill_md
    assert rules_text in chatgpt_md


def test_delivery_file_content_appears_verbatim_in_both_wrappers():
    _run_generate()
    delivery_text = (TPL_DIR / "_delivery.md").read_text(encoding="utf-8").rstrip("\n")
    skill_md = (OUT_DIR / "SKILL.md").read_text(encoding="utf-8")
    chatgpt_md = (OUT_DIR / "chatgpt-instructions.md").read_text(encoding="utf-8")

    assert delivery_text in skill_md
    assert delivery_text in chatgpt_md


# ---------------------------------------------------------------------------
# render_group() — the per-category table row shape (§5.4)
# ---------------------------------------------------------------------------


def _load_gen_module():
    spec = importlib.util.spec_from_file_location("gen_import_skill", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_render_group_uses_desc_zh_as_the_classification_criterion():
    module = _load_gen_module()
    from app.core.categories import EXPENSE_CATEGORIES

    table = module.render_group(EXPENSE_CATEGORIES)
    groceries = next(c for c in EXPENSE_CATEGORIES if c.code == "groceries")

    assert "| `groceries` |" in table
    assert groceries.desc_zh in table
    # Every child code must show up, backtick-quoted, in the same row.
    for child in groceries.children:
        assert f"`{child.code}`" in table


def test_render_group_uses_em_dash_for_leaf_without_children():
    module = _load_gen_module()
    from app.core.categories import INCOME_CATEGORIES

    table = module.render_group(INCOME_CATEGORIES)
    side_income = next(c for c in INCOME_CATEGORIES if c.code == "side_income")
    assert side_income.children == ()

    lines = [line for line in table.splitlines() if line.startswith("| `side_income`")]
    assert len(lines) == 1
    assert lines[0].endswith("| — |")


def test_generated_skill_version_matches_category_version():
    _run_generate()
    from app.core.categories import CATEGORY_VERSION

    skill_md = (OUT_DIR / "SKILL.md").read_text(encoding="utf-8")
    example_csv = (OUT_DIR / "example.csv").read_text(encoding="utf-8")
    chatgpt_md = (OUT_DIR / "chatgpt-instructions.md").read_text(encoding="utf-8")

    assert f"# version: {CATEGORY_VERSION}" in skill_md
    assert example_csv.startswith(f"# version: {CATEGORY_VERSION}")
    assert f"# version: {CATEGORY_VERSION}" in chatgpt_md
