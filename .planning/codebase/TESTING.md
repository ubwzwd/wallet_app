# Testing Patterns

**Analysis Date:** 2026-04-05

## Test Framework

**Backend Runner:**
- pytest 7.4+ configured in `backend/pyproject.toml`
- pytest-asyncio 0.23+ for async test support
- `asyncio_mode = "auto"` — all async tests run automatically without `@pytest.mark.asyncio`
- Config: `backend/pyproject.toml` under `[tool.pytest.ini_options]`

**Backend Type Checking:**
- mypy 1.8+ for static type analysis
- No mypy config section detected in `pyproject.toml` (uses defaults)

**Frontend:**
- No test framework configured — no jest.config.*, vitest.config.*, or testing libraries found in `frontend/package.json` devDependencies
- TypeScript strict mode (`"strict": true` in `frontend/tsconfig.json`) provides compile-time type checking as a quality gate

**Run Commands (Backend):**
```bash
cd backend
poetry run pytest              # Run all tests
poetry run pytest -v           # Verbose output
poetry run pytest --tb=short   # Short traceback format
poetry run mypy app/           # Type check
poetry run ruff check app/     # Lint
poetry run black app/          # Format
```

**Run Commands (Frontend):**
```bash
cd frontend
# No test runner configured
npx tsc --noEmit               # Type check only
```

## Test File Organization

**Backend:**
- Test path configured as `tests/` in `backend/pyproject.toml`: `testpaths = ["tests"]`
- File naming convention: `test_*.py` prefix
- Class naming convention: `Test*` prefix
- Function naming convention: `test_*` prefix
- No test files found on disk — the `tests/` directory is configured but empty/missing

**Frontend:**
- No test directories found
- No co-located `*.test.tsx` or `*.spec.tsx` files found anywhere in `frontend/src/`

## Test Structure

**Backend (configured conventions — no implemented tests found):**
```python
# Expected pattern based on pytest config in backend/pyproject.toml
class TestTransactionAPI:
    def test_create_transaction(self):
        ...

    async def test_create_transaction_async(self):
        ...  # asyncio_mode = "auto" handles this automatically
```

**Frontend (no tests implemented):**
- No testing patterns to document — zero test files exist

## Mocking

**Not implemented.** No mock infrastructure, fixtures, or test helpers found in either codebase.

**Available tools for future use:**
- Backend: `httpx` 0.26+ is a dependency (listed in `backend/pyproject.toml`) and is commonly used with FastAPI's `TestClient` for integration tests
- Frontend: No mocking library installed

## Fixtures and Factories

**Not implemented.** No fixture files, factory functions, or test data builders found.

**Backend test data:**
- No `conftest.py` found
- No fixture directories found
- `httpx.AsyncClient` would be the expected approach for FastAPI integration tests

**Frontend test data:**
- None

## Coverage

**Requirements:** None enforced — no coverage thresholds configured.

**View Coverage:**
```bash
cd backend
poetry run pytest --cov=app --cov-report=html   # Requires pytest-cov (not in pyproject.toml)
```

Note: `pytest-cov` is not listed as a dev dependency. Coverage tooling would need to be added.

## Test Types

**Unit Tests:**
- Not implemented

**Integration Tests:**
- Not implemented
- FastAPI integration tests would use `httpx.AsyncClient` with app fixture (httpx already installed as backend dependency)

**E2E Tests:**
- Not implemented — no Playwright, Cypress, Detox, or similar framework found

## Current Quality Gates

Since no automated tests exist, the current quality assurance relies on:

1. **TypeScript strict mode** (`frontend/tsconfig.json`) — catches type errors at build time
2. **Pydantic v2 validation** (`backend/app/schemas/`) — validates all API input/output at runtime
3. **Ruff linting** (`backend/pyproject.toml`) — enforces code style and catches common errors
4. **Black formatting** (`backend/pyproject.toml`) — enforces consistent formatting
5. **mypy** (`backend/pyproject.toml`) — static type checking for Python

## Writing New Tests (Recommended Patterns)

**Backend integration test pattern (FastAPI + httpx):**
```python
# backend/tests/test_auth.py
import pytest
from httpx import AsyncClient
from app.main import app

@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac

async def test_register_user(client: AsyncClient):
    response = await client.post("/api/v1/auth/register", json={
        "email": "test@example.com",
        "password": "password123",
        "base_currency": "USD"
    })
    assert response.status_code == 201
    assert "access_token" in response.json()
```

**Database fixture pattern (would require SQLAlchemy test session):**
```python
# backend/tests/conftest.py
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.database import Base, get_db
from app.main import app

TEST_DATABASE_URL = "postgresql://..."

@pytest.fixture(scope="function")
def db():
    engine = create_engine(TEST_DATABASE_URL)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(engine)
```

**Frontend test pattern (would require Jest + React Native Testing Library):**
```typescript
// frontend/src/components/__tests__/Button.test.tsx
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '../Button';

describe('Button', () => {
  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button title="Submit" onPress={onPress} />);
    fireEvent.press(getByText('Submit'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disables interaction when loading', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<Button title="Submit" onPress={onPress} loading />);
    fireEvent.press(getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
```

---

*Testing analysis: 2026-04-05*
