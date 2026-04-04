# Coding Conventions

**Analysis Date:** 2026-04-05

## Naming Patterns

**Files:**
- React components and screens: PascalCase `.tsx` — e.g., `Button.tsx`, `LoginScreen.tsx`, `TransactionFormScreen.tsx`
- Utility modules, API clients, constants: camelCase `.ts` — e.g., `queryClient.ts`, `client.ts`, `config.ts`
- Barrel exports: `index.ts` in every major directory
- Python modules: snake_case `.py` — e.g., `finance_sources.py`, `transaction_tag.py`

**Functions (TypeScript/React):**
- React components: PascalCase named exports — `export function LoginScreen()`, `export function Button()`
- Event handlers: `handle` prefix — `handleLogin`, `handleDelete`, `handleSubmit`
- Async API functions: verb + noun camelCase — `getTransactions`, `createTransaction`, `deleteTransaction`, `updateTransaction`
- Custom hooks: `use` prefix — `useAuth`
- Helper/utility functions: camelCase — `formatAmount`, `formatDate`

**Functions (Python/FastAPI):**
- Route handlers: snake_case — `create_transaction`, `delete_transaction`, `list_transactions`
- Utility functions: snake_case — `verify_password`, `get_password_hash`, `create_access_token`, `authenticate_user`
- Dependency functions: `get_` prefix — `get_db`, `get_current_user`

**Variables:**
- TypeScript: camelCase — `isLoading`, `currentView`, `selectedSource`, `queryClient`
- Python: snake_case — `new_transaction`, `hashed_password`, `access_token`, `current_user`
- Constants (TypeScript): UPPER_SNAKE_CASE — `QUERY_KEYS`, `STORAGE_KEYS`, `API_BASE_URL`
- Settings (Python): UPPER_SNAKE_CASE — `DATABASE_URL`, `SECRET_KEY`, `ACCESS_TOKEN_EXPIRE_MINUTES`

**Types/Interfaces:**
- TypeScript interfaces: PascalCase with descriptive name — `AuthContextType`, `ButtonProps`, `InputProps`, `TransactionFormScreenProps`
- Type aliases: PascalCase — `HomeView`, `TransactionType`
- Python Pydantic models: PascalCase suffixed with role — `TransactionCreate`, `TransactionUpdate`, `TransactionResponse`, `UserCreate`, `UserLogin`, `Token`
- Python SQLAlchemy models: PascalCase, singular noun — `Transaction`, `User`, `FinanceSource`, `TransactionTag`

## Code Style

**Formatting (Frontend):**
- No explicit Prettier config detected; follows Expo/TypeScript defaults
- TypeScript strict mode enabled in `frontend/tsconfig.json`
- `baseUrl: "."` with `@/*` path alias mapping to `src/*`

**Formatting (Backend):**
- Black with `line-length = 100` configured in `backend/pyproject.toml`
- Ruff linter: rules `E` (pycodestyle), `F` (pyflakes), `I` (isort), `line-length = 100`
- Target: Python 3.11

**Linting:**
- Frontend: No eslint config detected; TypeScript compiler enforces type safety via `strict: true`
- Backend: Ruff (`ruff`) + Black (`black`) + mypy for type checking, all in `backend/pyproject.toml`

## Import Organization

**TypeScript order (consistent throughout codebase):**
1. React and React Native core — `import React from 'react'`, `import { View, Text } from 'react-native'`
2. Third-party packages — `import { useQuery } from '@tanstack/react-query'`, `import axios from 'axios'`
3. Internal path-aliased imports — `import { Screen, Card } from '@/components'`, `import { useAuth } from '@/store/AuthContext'`
4. Type-only imports last — `import type { Transaction } from '@/types/api'`

**Python order (ruff isort enforced):**
1. Standard library — `from typing import List`, `from datetime import datetime`
2. Third-party — `from fastapi import APIRouter, Depends`, `from sqlalchemy.orm import Session`
3. Internal app — `from app.core.database import get_db`, `from app.models.transaction import Transaction`

**Path Aliases:**
- Frontend: `@/` maps to `frontend/src/` — configured in both `tsconfig.json` and `babel.config.js`

## Error Handling

**Frontend pattern — API calls in context/hooks:**
```typescript
try {
  setIsLoading(true);
  const result = await someApiCall();
  // handle success
} catch (error) {
  console.error('Descriptive message:', error);
  throw error; // re-throw so callers can handle UI
} finally {
  setIsLoading(false);
}
```
- Used consistently in `frontend/src/store/AuthContext.tsx` for all auth operations
- `console.error` for all caught errors in context/infrastructure code
- Errors re-thrown from context so screen components can show UI feedback

**Frontend pattern — screen-level error display:**
```typescript
catch (error: any) {
  const errorMessage = error.message || 'Login failed. Please try again.';
  Alert.alert('Login Failed', errorMessage);
  setErrors({ password: errorMessage });
}
```
- Used in `frontend/src/screens/LoginScreen.tsx` and similar screens
- `Alert.alert` on mobile, `window.alert` on web (Platform.OS check) — see `frontend/src/screens/TransactionFormScreen.tsx`

**Frontend pattern — TanStack Query mutations:**
```typescript
const createMutation = useMutation({
  mutationFn: (data: TransactionCreate) => transactionsApi.createTransaction(data),
  onSuccess: () => { queryClient.invalidateQueries(...); onSuccess(); },
  onError: (error: any) => {
    const errorMessage = error.message || 'Failed to create transaction';
    if (Platform.OS === 'web') { window.alert(`Error\n\n${errorMessage}`); }
  },
});
```
- `onError` always extracts `error.message` with fallback string
- `onSuccess` always invalidates relevant query keys

**Backend pattern — route error handling:**
```python
if not resource:
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Resource {resource_id} not found"
    )
```
- All route handlers use `HTTPException` with explicit `status_code` constants from `fastapi.status`
- `detail` field uses f-strings with resource ID for debuggability
- Database integrity errors caught at registration endpoint with `IntegrityError` rollback pattern — `backend/app/api/auth.py`

**API client error normalization:**
- Axios interceptor in `frontend/src/api/client.ts` normalizes all errors to `new Error(message)` before rejection
- Extracts `errorData?.detail` (FastAPI format) or `errorData?.message` as fallback

## Logging

**Frontend:**
- `console.error` exclusively — used for all caught exceptions in infrastructure code
- No structured logging or log levels beyond error

**Backend:**
- No logging framework detected; errors surfaced via HTTP exception responses
- No `logging` module usage found in app code

## Comments

**TypeScript style:**
- JSDoc `/** */` blocks for module-level groupings — `/** Authentication API endpoints */`, `/** Authentication Context Type */`
- Inline `//` comments explaining non-obvious logic — e.g., `// Backend doesn't have a logout endpoint (stateless JWT)`, `// Security: owner check`
- Section dividers with `/* Header */`, `/* Amount Input */` style comments in JSX-heavy screen files

**Python style:**
- Module-level docstring `"""..."""` on every file — `"""API routes for transaction management."""`
- Function docstrings with `- **param**:` formatting for route endpoint parameters (FastAPI docs integration)
- Inline `# Comment` for security annotations — `# Security: owner check`, `# Normalize tags`

## Function Design

**Size:** Screen functions are large (100–400 lines) due to co-located state, effects, mutations, validation, and JSX. Component functions are concise (30–70 lines).

**Parameters:**
- React components: single typed props interface — `interface ButtonProps { title: string; onPress: () => void; ... }`
- Optional props use `?` with documented defaults — `variant?: 'primary' | 'secondary' | 'danger'`
- API functions accept typed request objects from `@/types/api`
- FastAPI routes use `Depends()` injection for `db` and `current_user`

**Return Values:**
- API functions always return typed promises: `Promise<Transaction>`, `Promise<void>`
- FastAPI routes use `response_model=` for automatic serialization
- React components return `JSX.Element`

## Module Design

**Exports (TypeScript):**
- Named exports only — no default exports except `App.tsx` root component
- Barrel `index.ts` files for `components/` and `screens/` directories
- API modules use namespace import at call sites: `import * as transactionsApi from '@/api/transactions'`

**Barrel Files:**
- `frontend/src/components/index.ts` — exports all UI components
- `frontend/src/screens/index.ts` — exports all screen components
- `frontend/index.ts` — root entry point

**Python packages:**
- `__init__.py` present in all app directories: `app/`, `app/api/`, `app/models/`, `app/schemas/`, `app/services/`, `app/core/`
- `app/api/__init__.py` content not inspected but present for package recognition

---

*Convention analysis: 2026-04-05*
