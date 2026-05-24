# Testing Patterns

**Analysis Date:** 2026-05-24

## Test Framework

**Backend (Python):**

**Runner:**
- Framework: pytest
- Version: ^7.4.0 (in `backend/pyproject.toml`)
- Config: Configured in `backend/pyproject.toml` under `[tool.pytest.ini_options]`

**Async Support:**
- pytest-asyncio ^0.23.0
- asyncio_mode: "auto" (enables async test functions without explicit marker)

**Run Commands:**
```bash
pytest                      # Run all tests in backend/tests/
pytest backend/tests/ -v    # Verbose output
pytest -k "test_conversion" # Run specific test by name
pytest --tb=short           # Short traceback format
```

**Frontend (TypeScript/JavaScript):**

**Runner:**
- Framework: Jest
- Version: ^30.3.0 (in `frontend/package.json`)
- Expo support: jest-expo ^55.0.13
- Config: `frontend/jest.config.js`

**Run Commands:**
```bash
npm test                    # Run all tests in frontend/__tests__/
npm test -- --watch        # Watch mode (auto-rerun on changes)
npm test -- --coverage     # Coverage report
npm test TransactionForm   # Run specific test file
```

## Test File Organization

**Backend:**
- Location: `backend/tests/` (separate from source)
- Naming: `test_*.py` (pytest convention)
- Structure:
  ```
  backend/tests/
  ├── __init__.py           # Package marker
  ├── conftest.py           # Shared fixtures and configuration
  ├── test_config.py        # Configuration tests
  ├── test_conversion.py    # Exchange rate conversion unit tests
  ├── test_profile_structure.py       # Schema validation tests
  ├── test_session_persistence.py     # Integration tests
  ├── test_transactions_structure.py  # Transaction model tests
  └── test_auto_default_source.py     # Default finance source tests
  ```

**Frontend:**
- Location: `frontend/__tests__/` (separate from source)
- Naming: `*.test.ts` (Jest convention)
- Structure:
  ```
  frontend/__tests__/
  ├── CurrencyPicker.test.ts        # Static analysis for rates.ts
  ├── FinanceSourcesScreen.test.ts  # Financial source features
  ├── TransactionFormScreen.test.ts # Transfer wizard tests
  └── TransactionsScreen.test.ts    # Transaction list features
  ```

## Test Structure

**Backend - Test Class Organization:**
```python
class TestBuildConversionFieldsSameCurrency:
    """Returns (None, None, None) when tx_currency matches base_currency."""
    
    def test_same_currency_uppercase_returns_nulls(self):
        """CONV-01: same currency produces no conversion fields."""
        result = _build_conversion_fields("USD", Decimal("100.00"), "USD")
        assert result == (None, None, None)
```

**Backend Patterns:**
- Test classes group related scenarios with descriptive class names
- Test methods use descriptive names with docstrings linking to requirements (e.g., `"""CONV-01: ...."""`)
- Each test typically has: Setup → Action → Assert structure
- Docstrings reference feature codes (CONV-01, XFER-02, etc.)

**Frontend - Test Suite Organization:**
```typescript
describe('XFER-03: Transfer button enabled', () => {
  it('does not contain hardcoded "Transfer support coming soon" text', () => {
    expect(SOURCE).not.toContain('Transfer support coming soon');
  });
});
```

**Frontend Patterns:**
- Static analysis tests using `fs.readFileSync()` to verify implementation details
- Tests check for specific strings/patterns in source code rather than runtime behavior
- describe/it structure with feature codes in descriptions
- Each test is a single assertion checking for expected implementation pattern

## Mocking

**Backend:**
- Framework: `unittest.mock` (standard library)
- Usage: `@patch` decorator and `MagicMock` objects
- Example from `test_conversion.py:45-47`:
  ```python
  with patch("app.api.transactions.rates_service") as mock_svc:
      mock_svc.convert_amount.return_value = mock_converted
      mock_svc.fetch_latest_rates.return_value = {"EUR": mock_rate}
  ```

**Optional Mocking for Native Packages:**
- conftest.py provides fallback mocks for psycopg2 and related packages
- Uses `_mock_module()` helper to create MagicMock placeholders when packages unavailable
- Ensures tests can run even if PostgreSQL client not installed

**Frontend:**
- No traditional mocks detected (tests are static analysis)
- Uses `fs.readFileSync()` to read source code and verify patterns
- No dependency injection or jest.mock() patterns in existing tests

## What to Mock

**Backend:**
- External API calls: Use `patch` to mock `rates_service`, `httpx` calls
- Database queries: Test database layer uses real SQLite in-memory engine (not mocked)
- Heavy native dependencies: Optional psycopg2 mocked in conftest when unavailable

**What NOT to Mock:**
- Database session fixtures: Use real in-memory SQLite (`backend/tests/conftest.py:47-54`)
- Core FastAPI app: Test client initialized with real app instance
- Pydantic schema validation: Tested with real validation rules

## Fixtures and Factories

**Backend - Fixtures:**
```python
@pytest.fixture()
def db_session(create_tables):
    """
    Provide a transactional database session that rolls back after each test.
    """
    connection = _test_engine.connect()
    transaction = connection.begin()
    session = _TestingSessionLocal(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()

@pytest.fixture()
def client(db_session):
    """
    FastAPI TestClient with get_db overridden to use the test session.
    """
```

**Backend Fixtures Location:** `backend/tests/conftest.py`

**Backend - Session Scope:**
- `create_tables()` fixture: session scope (once per test run)
  - Creates and tears down all database tables
  - Imports all model modules to register on `Base.metadata`
  
- `db_session()` fixture: function scope (once per test)
  - Begins transaction, yields session, rolls back after test
  - Isolates database changes per test

- `client()` fixture: function scope (once per test)
  - FastAPI TestClient with overridden `get_db` dependency
  - Uses test `db_session` for all database operations

**Test Data:**
- Minimal factories (inline data creation in test functions)
- Example: `User(email=user_data.email, password_hash=hashed_password, ...)`
- No factory library (e.g., factory_boy) detected

**Frontend:**
- No fixtures or factories (static analysis tests read source code directly)
- Global `SOURCE = fs.readFileSync(...)` loads target file once per test file

## Coverage

**Backend:**
- Requirements: Not enforced in configuration
- Target: Aim for 80%+ coverage on core modules
- View coverage: `pytest --cov=app backend/tests/`

**Frontend:**
- Requirements: Not configured
- View coverage: `npm test -- --coverage`

## Test Types

**Unit Tests:**
- Backend: Tests pure functions with mocked dependencies
  - Example: `test_conversion.py` tests `_build_conversion_fields()` helper directly
  - Scope: Single function, isolated business logic
  - Uses: `patch` for external service calls
  
- Frontend: Static source code analysis (verify implementation patterns)
  - Example: `TransactionFormScreen.test.ts` searches for expected strings/patterns
  - Scope: Component structure and feature implementation
  - Uses: fs.readFileSync + expect().toContain()

**Integration Tests:**
- Backend: Tests full request/response cycle with real database
  - Example: `test_session_persistence.py`, `test_profile_structure.py`
  - Scope: Auth flow, model persistence, endpoint behavior
  - Uses: Test client with real database session
  - Setup: POST /register → verify response → query database

**E2E Tests:**
- Backend smoke test: `infra/scripts/smoke.sh`
  - Verifies compose stack, migrations, service health
  - Tests: Docker build, compose up, HTTP endpoints, Postgres config
  - Exit code: 0 for all success criteria, logs failing step on error
  
- Frontend: Not detected (static analysis tests are closest equivalent)

## Common Patterns

**Async Testing (Backend):**
```python
@pytest.mark.asyncio
async def test_async_operation():
    """Test async function directly."""
    result = await some_async_function()
    assert result is not None
```

**Async Testing (Frontend):**
```typescript
it('calls deleteTransaction for rollback on partial failure', () => {
  expect(SOURCE).toContain('deleteTransaction');
  expect(SOURCE).toContain('rollback');
});
```

**Error Testing (Backend):**
```python
def test_invalid_token_raises_exception():
    """Test that invalid JWT raises credentials exception."""
    with patch("app.api.transactions.rates_service"):
        with pytest.raises(HTTPException) as exc_info:
            get_current_user(invalid_token, db)
        assert exc_info.value.status_code == 401
```

**Error Testing (Frontend):**
- Static analysis: check for error messages in source
- Example from `TransactionFormScreen.test.ts:81-83`:
  ```typescript
  it('shows "Transfer created successfully!" on success', () => {
    expect(SOURCE).toContain('Transfer created successfully!');
  });
  ```

## Database Testing

**Configuration:**
- SQLite in-memory engine: `sqlite:///:memory:`
- Connection pooling disabled: `check_same_thread=False` (required for SQLite)
- Session isolation: Each test gets a transaction, rolled back after
- Schema creation: All models registered and created once per session via `create_tables()` fixture

**Pattern (from `conftest.py`):**
1. Session scope: Create tables once
2. Function scope: Begin transaction → yield session → rollback
3. Test: Use session for queries/mutations, changes roll back automatically
4. Isolation: Tests don't interfere with each other (clean slate each test)

## Test Naming Convention

**Backend:**
- Format: `test_<what_is_being_tested>`
- Example: `test_same_currency_uppercase_returns_nulls`
- Documentation: Docstring with requirement code (CONV-01, XFER-02, etc.)

**Frontend:**
- Format: `it('<description matching requirement code>')`
- Example: `it('does not contain hardcoded "Transfer support coming soon" text')`
- Descriptions are requirement-driven, linked to feature codes (XFER-01, D-10, etc.)

## Test File Template

**Backend:**
```python
"""[Feature name]: Unit tests for [module]."""
import pytest
from unittest.mock import patch, MagicMock

class Test[Feature]:
    """[Group description]."""
    
    def test_case_description(self):
        """[FEATURE-CODE]: [What is being tested]."""
        # Setup
        # Action
        # Assert
```

**Frontend:**
```typescript
/**
 * [FEATURE-CODE]: [Test description].
 * 
 * [Details about what is being verified and why].
 */
import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(
  path.join(__dirname, '../src/...'),
  'utf8'
);

describe('[FEATURE-CODE]: [Group title]', () => {
  it('description', () => {
    expect(SOURCE).toContain('expected_pattern');
  });
});
```

---

*Testing analysis: 2026-05-24*
