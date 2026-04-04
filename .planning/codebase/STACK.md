# Technology Stack

**Analysis Date:** 2026-04-05

## Languages

**Primary (Backend):**
- Python 3.11 - All backend API code in `backend/app/`

**Primary (Frontend):**
- TypeScript ~5.9.2 - All frontend code in `frontend/src/`

**Secondary:**
- JavaScript - Config files (`frontend/babel.config.js`, `frontend/tailwind.config.js`)

## Runtime

**Backend Environment:**
- Python 3.11 (minimum ^3.11)
- Uvicorn 0.27+ as ASGI server

**Frontend Environment:**
- Node.js (via Expo/React Native toolchain)
- Expo SDK ~54.0.20

**Package Managers:**
- Backend: Poetry 1.7.1 - Lockfile: `backend/poetry.lock` (present)
- Frontend: npm - Lockfile: `frontend/package-lock.json` (present)

## Frameworks

**Backend Core:**
- FastAPI ^0.109.0 - REST API framework; entry point at `backend/app/main.py`
- SQLAlchemy ^2.0.25 - ORM; engine configured in `backend/app/core/database.py`
- Alembic ^1.13.0 - Database migrations; config at `backend/alembic.ini`, migrations in `backend/migrations/versions/`
- Pydantic ^2.5.0 - Data validation and serialization; schemas in `backend/app/schemas/`
- pydantic-settings ^2.1.0 - Settings management; used in `backend/app/core/config.py`

**Frontend Core:**
- React 19.1.0 - UI rendering
- React Native 0.81.5 - Mobile app framework
- Expo ~54.0.20 - React Native toolchain and build system; configured via `frontend/app.json`

**Navigation:**
- @react-navigation/native ^7.1.19 - Navigation container
- @react-navigation/native-stack ^7.6.1 - Stack navigator

**State & Data Fetching:**
- @tanstack/react-query ^5.90.5 - Server state management; client configured in `frontend/src/utils/queryClient.ts`

**Forms:**
- react-hook-form ^7.65.0 - Form state management
- @hookform/resolvers ^5.2.2 - Validation resolver bridge
- zod ^3.25.76 - Schema validation integrated with react-hook-form

**Styling:**
- NativeWind ^4.2.1 - Tailwind CSS for React Native
- Tailwind CSS ^3.4.18 - Utility-first CSS; configured in `frontend/tailwind.config.js`

**Testing (Backend):**
- pytest ^7.4.0 - Test runner; configured in `backend/pyproject.toml` under `[tool.pytest.ini_options]`
- pytest-asyncio ^0.23.0 - Async test support

**Build/Dev (Backend):**
- black ^24.0.0 - Code formatter (line length 100)
- ruff ^0.1.0 - Linter (E, F, I rules; line length 100)
- mypy ^1.8.0 - Static type checker

**Build/Dev (Frontend):**
- babel-preset-expo ^54.0.6 - Babel preset for Expo
- babel-plugin-module-resolver ^5.0.2 - Path alias resolution; `@/` maps to `src/`

## Key Dependencies

**Critical:**
- `psycopg2-binary` ^2.9.9 - PostgreSQL adapter; connects backend to database
- `python-jose[cryptography]` ^3.3.0 - JWT encoding/decoding in `backend/app/core/security.py`
- `passlib[bcrypt]` ^1.7.4 + `bcrypt` ^5.0.0 - Password hashing in `backend/app/core/security.py`
- `httpx` ^0.26.0 - HTTP client for external API calls in `backend/app/services/rates.py`
- `tenacity` ^9.1.2 - Retry logic with exponential backoff for external API calls
- `axios` ^1.13.0 - HTTP client for frontend API calls in `frontend/src/api/client.ts`
- `@react-native-async-storage/async-storage` ^2.2.0 - Persistent token storage; used in `frontend/src/api/client.ts` and `frontend/src/store/AuthContext.tsx`

**Animation/Gestures:**
- react-native-reanimated ^4.1.3 - Animations
- react-native-gesture-handler ~2.28.0 - Gesture system
- react-native-screens ~4.16.0 - Native screen containers
- react-native-safe-area-context ^5.6.1 - Safe area insets

**Web Support:**
- react-native-web ^0.21.0 - React Native rendering for web
- react-dom 19.1.0 - React DOM renderer

## Configuration

**Backend Environment:**
- Loaded via pydantic-settings from `.env` file and environment variables
- Settings class defined in `backend/app/core/config.py`
- Example config at `backend/env.example`
- Key settings: `DATABASE_URL`, `SECRET_KEY`, `ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `EXCHANGE_RATE_API_URL`, `ALLOWED_ORIGINS`

**Frontend Configuration:**
- TypeScript paths configured in `frontend/tsconfig.json` (extends `expo/tsconfig.base`, strict mode enabled)
- Babel alias in `frontend/babel.config.js` (`@/` → `./src`)
- App metadata in `frontend/app.json` (Expo config; new architecture enabled)
- Runtime constants in `frontend/src/constants/config.ts`

**Build:**
- Backend: `backend/Dockerfile` (multi-stage; Python 3.11-slim; Poetry install)
- Backend: `backend/docker-compose.yml` (Postgres 15-alpine; API container commented out)

## Platform Requirements

**Development:**
- Python ^3.11 with Poetry for backend
- Node.js with npm for frontend
- PostgreSQL 15 (via Docker Compose at `backend/docker-compose.yml`)
- Expo CLI for mobile development

**Production:**
- Backend: Docker container; Uvicorn listening on port 8000
- Frontend: Expo build targets iOS, Android, and Web
- Database: PostgreSQL (connection via `DATABASE_URL` env var)

---

*Stack analysis: 2026-04-05*
