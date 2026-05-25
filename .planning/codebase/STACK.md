# Technology Stack

**Analysis Date:** 2026-05-24

## Languages

**Primary:**
- Python 3.11+ - FastAPI backend, Alembic migrations, service layer
- TypeScript 5.9+ - Expo/React Native frontend, web platform
- Bash - Infrastructure scripts (`infra/scripts/env-coverage.sh`, `infra/scripts/smoke.sh`)

**Secondary:**
- Docker - Container orchestration
- Dockerfile - Multi-stage builder pattern for backend (`infra/Dockerfile.api`)

## Runtime

**Environment:**
- Python 3.11-slim - Backend runtime in Docker (builder + runtime stages)
- Node.js (via npm) - Frontend development and build
- Docker Engine - Local and production deployment

**Package Manager:**
- Poetry - Python dependency management (`backend/pyproject.toml`, `backend/poetry.lock`)
  - Lockfile: Present (`backend/poetry.lock`)
- npm - Node.js frontend dependencies (`frontend/package.json`)
  - Lockfile: Present via npm-lock

## Frameworks

**Core:**
- FastAPI ^0.109.0 - REST API framework, ASGI server
- Uvicorn 0.27.0+ with standard extras - ASGI server for FastAPI (production deployments)
- Expo ~54.0.20 - React Native + web platform framework
- React 19.1.0 - UI component framework
- React Native 0.81.5 - Cross-platform mobile runtime

**Database & ORM:**
- SQLAlchemy ^2.0.25 - SQL toolkit and ORM (`backend/app/core/database.py`)
- Alembic ^1.13.0 - Database schema migrations (`backend/alembic.ini`, `backend/migrations/`)
- PostgreSQL 15-alpine - Production database container (`infra/docker-compose.prod.yml`)
  - SQLite - Development fallback (supports check_same_thread, pool disabled)

**Authentication & Security:**
- python-jose ^3.3.0 with cryptography extras - JWT token creation/validation (`backend/app/core/security.py`)
- passlib ^1.7.4 with bcrypt extras - Password hashing and verification
- bcrypt ^5.0.0 - Cryptographic password hashing
- HTTPBearer - FastAPI HTTP Bearer token scheme (`backend/app/core/security.py`)

**HTTP Client:**
- httpx ^0.26.0 - Async HTTP client for external API calls (Frankfurter rates API, `backend/app/services/rates.py`)
- axios ^1.13.0 - Frontend HTTP client with request/response interceptors (`frontend/src/api/client.ts`)

**State Management & Caching:**
- TanStack React Query ^5.90.5 - Server state management, caching, background sync (`frontend/package.json`)
  - Query keys defined in `frontend/src/constants/config.dev.ts` and `config.prod.ts`
- AsyncStorage (@react-native-async-storage) ^2.2.0 - Local client-side token and user data persistence

**UI & Styling:**
- NativeWind ^4.2.1 - Tailwind CSS for React Native (`frontend/package.json`)
- Tailwind CSS ^3.4.18 - Utility-first CSS framework
- React Navigation - Navigation library for React Native
  - @react-navigation/native ^7.1.19
  - @react-navigation/native-stack ^7.6.1

**Forms & Validation:**
- react-hook-form ^7.65.0 - Form state and validation
- @hookform/resolvers ^5.2.2 - Schema integration for hook-form
- Zod ^3.25.76 - TypeScript-first schema validation

**Build & Dev:**
- Babel - JavaScript transpilation (babel-plugin-module-resolver)
- TypeScript ~5.9.2 - Type checking and compilation

**Testing:**
- pytest ^7.4.0 - Python testing framework (`backend/pyproject.toml`)
- pytest-asyncio ^0.23.0 - Async test support for FastAPI
- Jest ^30.3.0 - JavaScript testing framework (`frontend/package.json`)
- @testing-library/react-native ^13.3.3 - React Native component testing utilities

**Code Quality:**
- black ^24.0.0 - Python code formatter (100 char line length target)
- ruff ^0.1.0 - Python linter (rules: E, F, I; 100 char lines)
- mypy ^1.8.0 - Python static type checker

## Key Dependencies

**Critical:**
- PostgreSQL 15-alpine - Production relational database
  - Connection pooling: pool_size=5, max_overflow=10 (non-SQLite backends)
  - Pool recycling: pool_recycle=3600s for stale connection recovery
  - Pre-ping enabled for connection health checks
- FastAPI - RESTful API framework with automatic OpenAPI documentation
- Alembic - Declarative schema migrations, versioned (`backend/migrations/versions/`)
- JWT (python-jose) - Stateless authentication tokens with HS256 algorithm

**Infrastructure:**
- tenacity ^9.1.2 - Retry logic with exponential backoff (Frankfurter API calls, `backend/app/services/rates.py`)
  - 3 retries maximum, 1-10s exponential wait
- python-multipart ^0.0.6 - Multipart form data handling for FastAPI
- email-validator ^2.3.0 - Email validation for auth
- psycopg2-binary ^2.9.9 - PostgreSQL Python adapter
- pydantic ^2.5.0 - Data validation using Python type annotations
- pydantic-settings ^2.1.0 - Environment-based settings management (`backend/app/core/config.py`)

## Configuration

**Environment:**
- Environment-based via `pydantic-settings` (`backend/app/core/config.py`)
- Development: `.env` file in project root (git-ignored)
- Production: `infra/.env` template at `infra/.env.example` (committed sentinel, CHANGE_ME_* placeholders)
- Env vars required: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, DATABASE_URL, SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES, ALLOWED_ORIGINS, EXCHANGE_RATE_API_URL, ENVIRONMENT, DEBUG, CADDY_DOMAIN, CADDY_TLS_MODE

**Build:**
- Frontend build config: `frontend/config.dev.ts` (dev default, restored after build)
- Frontend build config: `frontend/config.prod.ts` (production with relative API URL)
- Backend build: Multi-stage Dockerfile (`infra/Dockerfile.api`)
  - Builder stage: Poetry export to requirements.txt, uv pip install to /usr/local
  - Runtime stage: python:3.11-slim + libpq5 + non-root appuser (uid 1000)
- Docker Compose: `infra/docker-compose.dev.yml` (db only), `infra/docker-compose.prod.yml` (api + migrate + caddy)

## Platform Requirements

**Development:**
- Python 3.11+ with Poetry
- Node.js + npm (frontend)
- Docker & Docker Compose (for containerized local dev)
- Optional: PostgreSQL server (or use compose db container)

**Production:**
- Docker & Docker Compose
- Oracle A1.Flex (Ampere ARM64) target platform (image built with `--platform linux/arm64`)
- Caddy reverse proxy for TLS termination (Let's Encrypt ACME or internal self-signed)
- PostgreSQL 15+ (shared_buffers=3GB, effective_cache_size=8GB, max_connections=50)

---

*Stack analysis: 2026-05-24*
