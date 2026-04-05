"""BUG-01/CONV-02 static analysis: structural checks on transactions.py via AST."""
import ast
from pathlib import Path

TRANSACTIONS_FILE = Path(__file__).parent.parent / "app" / "api" / "transactions.py"


def test_exactly_one_delete_transaction_handler():
    """BUG-01: Exactly one delete_transaction route handler must exist (no duplicate)."""
    source = TRANSACTIONS_FILE.read_text()
    tree = ast.parse(source)
    delete_defs = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "delete_transaction"
    ]
    assert len(delete_defs) == 1, (
        f"Expected exactly 1 delete_transaction definition, found {len(delete_defs)}"
    )


def test_build_conversion_fields_helper_exists():
    """CONV-02: _build_conversion_fields helper must be defined at module level."""
    source = TRANSACTIONS_FILE.read_text()
    tree = ast.parse(source)
    helper_defs = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "_build_conversion_fields"
    ]
    assert len(helper_defs) == 1, (
        f"Expected exactly 1 _build_conversion_fields definition, found {len(helper_defs)}"
    )


def test_build_conversion_fields_called_in_all_single_tx_endpoints():
    """CONV-02: _build_conversion_fields must be called in create, get, and update endpoints (>=3 call sites)."""
    source = TRANSACTIONS_FILE.read_text()
    # 1 def + at least 3 call sites = at least 4 occurrences of the name
    count = source.count("_build_conversion_fields")
    assert count >= 4, (
        f"Expected >=4 occurrences of _build_conversion_fields (1 def + 3 calls in create/get/update), "
        f"found {count}"
    )


def test_list_endpoint_uses_batch_rates():
    """CONV-02: list_transactions must use a batch_rates variable for efficient batched fetch."""
    source = TRANSACTIONS_FILE.read_text()
    assert "batch_rates" in source, (
        "list_transactions must use batch_rates for batch currency conversion (not N individual calls)"
    )


def test_no_todo_conversion_placeholders():
    """Regression: no TODO placeholders left in conversion logic."""
    source = TRANSACTIONS_FILE.read_text()
    assert "TODO: Add conversion logic" not in source, (
        "Placeholder TODO comment found — conversion logic was never implemented"
    )


def test_delete_uses_router_delete_decorator():
    """BUG-01: delete_transaction must be decorated with @router.delete."""
    source = TRANSACTIONS_FILE.read_text()
    tree = ast.parse(source)

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "delete_transaction":
            # Check that at least one decorator is a router.delete call
            for dec in node.decorator_list:
                if (
                    isinstance(dec, ast.Call)
                    and isinstance(dec.func, ast.Attribute)
                    and dec.func.attr == "delete"
                ):
                    return  # Found the expected decorator
            pytest.fail(
                "delete_transaction is defined but not decorated with @router.delete"
            )
    pytest.fail("delete_transaction function not found")
