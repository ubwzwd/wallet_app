# Coding Conventions

**Analysis Date:** 2026-05-24

## Naming Patterns

**Files:**
- Backend Python modules: snake_case (`auth.py`, `transactions.py`, `finance_source.py`)
- Frontend TypeScript/TSX components: PascalCase (`LoginScreen.tsx`, `Button.tsx`, `TransactionFormScreen.tsx`)
- Frontend utilities: camelCase (`queryClient.ts`, `config.ts`)
- Frontend API modules: camelCase (`client.ts`, `auth.ts`, `financeSources.ts`)

**Functions:**
- Backend: snake_case, with docstrings describing purpose and exceptions
  - Example: `def get_current_user()`, `def create_access_token()`
- Frontend: camelCase (utilities/helpers), PascalCase (React components as exported functions)
  - Example: `const register = async ()`, `export function Button()`

**Variables:**
- Backend: snake_case throughout
  - Example: `user_id`, `hashed_password`, `base_currency`
- Frontend: camelCase for state and local variables
  - Example: `isLoading`, `setEmail`, `destinationSourceId`, `errorMessage`

**Types:**
- Backend Pydantic schemas (pydantic.BaseModel): PascalCase
  - Example: `TransactionCreate`, `UserUpdate`, `FinanceSourceResponse`
- Frontend TypeScript interfaces: PascalCase
  - Example: `User`, `Transaction`, `LoginRequest`, `ButtonProps`
- Enums/constants: UPPER_SNAKE_CASE
  - Example: `STORAGE_KEYS`, `ALLOWED_ORIGINS`, `SECRET_KEY`

## Code Style

**Formatting:**
- Backend (Python):
  - Tool: Black (configured in `backend/pyproject.toml`)
  - Line length: 100 characters
  - Target: Python 3.11
  - Settings: `[tool.black]` in pyproject.toml
  
- Frontend (TypeScript/JavaScript):
  - No Prettier config detected (default formatting)
  - Uses Jest/Babel for testing and transpilation
  - TypeScript strict mode enabled (`"strict": true` in `frontend/tsconfig.json`)

**Linting:**
- Backend:
  - Tool: Ruff (configured in `backend/pyproject.toml`)
  - Rules: `select = ["E", "F", "I"]` (errors, pyflakes, isort imports)
  - Line length: 100 characters
  
- Frontend:
  - No ESLint config file detected
  - Uses TypeScript compiler for type checking

## Import Organization

**Order (Backend - Python):**
1. Standard library imports (e.g., `import os`, `from datetime import`)
2. Third-party imports (e.g., `from fastapi import`, `from sqlalchemy import`)
3. Local application imports (e.g., `from app.core.config import`, `from app.models`)

**Order (Frontend - TypeScript):**
1. Third-party imports (e.g., `import React from 'react'`, `import axios`)
2. React Native/Expo imports (e.g., `import { View, Text } from 'react-native'`)
3. Local imports using @ alias (e.g., `import { Button } from '@/components'`, `import { apiClient } from '@/api/client'`)

**Path Aliases:**
- Frontend: `@/*` maps to `src/*` (configured in `frontend/tsconfig.json` and `frontend/babel.config.js`)
- Backend: No path aliases used (direct relative imports)

## Error Handling

**Patterns:**
- Backend:
  - HTTP errors raised as `HTTPException(status_code=..., detail="...")` from FastAPI
  - Database errors logged with structured DIAG_ prefixes for diagnostics
  - Example from `app/core/security.py`: `logger.error(f"DIAG_CREDENTIALS_EXCEPTION reason=jwt_decode_failed")`
  - Specific exception types caught first, then generic `Exception` as fallback
  - Use `try/except` blocks to log and re-raise HTTPException for auth endpoints

- Frontend:
  - Errors captured in `try/catch` blocks with `.message` extraction
  - User-facing errors shown via `Alert.alert(title, errorMessage)`
  - API client errors extracted from response `.data?.detail` or `.message`
  - Special handling for 401 errors to avoid clearing tokens on transient failures (see `frontend/src/api/client.ts:48-64`)
  - State-based error storage for form validation (e.g., `errors` object in `LoginScreen.tsx:11`)

## Logging

**Framework:** 
- Backend: Python `logging` module with `logger = logging.getLogger(__name__)` per module
- Frontend: Browser `console.error()`, `console.log()` (no structured logging library)

**Patterns:**
- Backend uses diagnostic (DIAG_) prefixes to categorize log messages:
  - `DIAG_CREDENTIALS_EXCEPTION` for auth failures
  - `DIAG_DB_ERROR` for database-related issues
  - `DIAG_TOKEN_DECODE` for JWT processing
  - `DIAG_USER_LOOKUP` for user queries
  - Example: `logger.error(f"DIAG_USER_LOOKUP found={user is not None} user_id={user_id}")`
  
- Frontend logs API errors with context:
  - Example from `client.ts:26`: `console.error('Error reading auth token:', error)`
  - Errors include full message from backend detail field

## Comments

**When to Comment:**
- Backend: Module-level docstrings with triple quotes (`"""..."""`)
- Every function has a docstring describing purpose, args, returns, and raises
- Inline comments explain non-obvious logic (e.g., case-insensitive currency comparison)
- Example from `security.py`: docstring with Args, Returns, Raises sections

- Frontend: File-level JSDoc comments for complex logic
- Component comments explain wizard steps or conditional rendering
- Example from `TransactionFormScreen.test.ts:3-8`: multi-line comment explaining test scope

## JSDoc/TSDoc

**Usage Pattern:**
- Backend (Python): Full docstrings with description, Args, Returns, Raises sections
  ```python
  def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
      """
      Create a JWT access token.
      
      Args:
          data: Dictionary containing the claims to encode in the token
          expires_delta: Optional expiration time delta
      
      Returns:
          Encoded JWT token string
      """
  ```

- Frontend: Block comments for complex test cases and file headers
  ```typescript
  /**
   * XFER-01/02/03: Transfer creation wizard static analysis tests.
   *
   * Verifies that TransactionFormScreen.tsx implements the full two-step transfer
   * wizard...
   */
  ```

## Function Design

**Size:** 
- Backend: Functions generally 20-50 lines; complex logic (e.g., `_build_conversion_fields`) extracted to module-level helpers
- Frontend: Components 60-100 lines; hooks for shared logic

**Parameters:**
- Backend: Use Pydantic models for complex data (`UserCreate`, `TransactionCreate`)
- Frontend: Props interfaces (e.g., `ButtonProps`) passed to components as single parameter

**Return Values:**
- Backend: Explicit type hints on all functions
- Frontend: Explicit return types on async functions (`Promise<T>`)

## Module Design

**Exports:**
- Backend: Routers created with `APIRouter(prefix="/...", tags=[...])` and included in main app
- Frontend: Named exports for components and utilities
  - Example: `export function Button({...}: ButtonProps)`
  - Example: `export const apiClient = axios.create({...})`

**Barrel Files:**
- Frontend uses index files for clean imports:
  - `frontend/src/components/index.ts` (if exists) would export `{ Button, Card, Input, ... }`
  - `frontend/src/screens/index.ts` exports all screen components
  - Actual import: `import { Screen, Card, Button } from '@/components'`

- Backend does not use barrel files; imports are direct from modules

## Shell Script Conventions

**Location:** `infra/scripts/`

**Naming:** lowercase with hyphens (`smoke.sh`, `env-coverage.sh`)

**Header Format:**
- Shebang: `#!/usr/bin/env bash`
- Description: Comment with file path and purpose
- Example from `smoke.sh:2`: `# infra/scripts/smoke.sh — Phase 4 end-to-end verification`

**Mode/Usage Documentation:**
- Scripts document modes as comments near top
- Example: `# Modes: bash infra/scripts/smoke.sh up # compose up --wait only`

**Error Handling:**
- Use `set -euo pipefail` for strict error handling
- All tests documented with row numbers (e.g., `# row 04-06-01`)
- Exit codes: 0 for success, non-zero for failure
- Teardown via `trap` cleanup functions

**Logging:**
- Use `echo "==> [step description]"` for progress
- Use `echo "FAIL: [message]"` for errors
- Pipe logs to `/tmp/` for long operations (e.g., `/tmp/smoke-build.log`)

## Key Conventions Summary

| Aspect | Backend (Python) | Frontend (TypeScript/TSX) |
|--------|------------------|--------------------------|
| File naming | snake_case | PascalCase (components), camelCase (utils) |
| Function naming | snake_case | camelCase (utils), PascalCase (components) |
| Variable naming | snake_case | camelCase |
| Type naming | PascalCase | PascalCase |
| Constant naming | UPPER_SNAKE_CASE | UPPER_SNAKE_CASE |
| Line length | 100 | No enforced limit |
| Formatter | Black | Default (no Prettier) |
| Linter | Ruff | None detected |
| Docstrings | Required (full) | Used for complex logic |
| Error handling | HTTPException + logging | try/catch + Alert |
| Logging prefix | DIAG_* for diagnostics | console.* (unstructured) |

---

*Convention analysis: 2026-05-24*
