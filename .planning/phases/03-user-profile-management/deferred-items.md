# Deferred Items - Phase 03 Plan 01

## Pre-existing test failures (out of scope)

### test_config.py::test_debug_defaults_to_false
- **File:** backend/tests/test_config.py
- **Failure:** `Settings().DEBUG` defaults to `True` but test expects `False`
- **Status:** Pre-existing before any 03-01 changes (confirmed via git stash check)
- **Resolution:** Tracked in PROJECT.md as "DEBUG=False as default" active requirement; needs separate plan

### test_config.py::test_sql_echo_off_by_default
- **File:** backend/tests/test_config.py
- **Failure:** SQL echo not False by default
- **Status:** Same root cause as above
