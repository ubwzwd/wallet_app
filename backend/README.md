# Wallet App Backend

FastAPI + SQLAlchemy 2 + Alembic. Python 3.12.

## Local setup

```bash
cd backend
# an isolated environment with uv (works everywhere) ...
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
# ... or the system Python 3.12 where it allows pip installs (Ubuntu 24.04 / Debian 12
# refuse this with "externally-managed-environment"; use the uv line there)
python3 -m pip install -r requirements-dev.txt

cp env.example .env        # set SECRET_KEY (required): python3 -c "import secrets; print(secrets.token_urlsafe(32))"
docker compose -f ../infra/docker-compose.dev.yml up -d db   # Postgres on :5432

alembic upgrade head
uvicorn app.main:app --reload
```

API on http://localhost:8000, Swagger UI on `/docs`.

## Tests

SQLite in memory; Postgres migration tests are skipped unless `TEST_POSTGRES_URL` is set.

```bash
cd backend && DEBUG=false SECRET_KEY=test-secret-key-for-tests-only python3 -m pytest -q
```

## Dependencies

- `requirements.txt` holds the runtime dependencies, each pinned with `==` to the version the test suite actually runs against.
- `constraints.txt` pins every transitive dependency as well (a `uv pip freeze` of a venv that passed the suite); the image and `requirements-dev.txt` install with `-c constraints.txt`, so a build on the VM resolves exactly the tested set. Regenerate it whenever `requirements.txt` changes.
- `requirements-dev.txt` adds pytest and pytest-asyncio; it is never copied into the image.
- `pyproject.toml` only carries project metadata and tool settings (pytest, black, ruff); nothing is packaged.
- Upgrading: edit the pin in `requirements.txt`, rebuild a fresh venv from it, run the whole test suite, then `uv pip freeze` that venv into `constraints.txt`.

## Migrations

```bash
alembic revision --autogenerate -m "Description"
alembic upgrade head
alembic downgrade -1
alembic current
```

## Production image

Build from the repository root (the context must include `skills/`):

```bash
docker build -f infra/Dockerfile.api -t wallet-app/api:local .
```

The full production stack (Postgres, migrate, api, Caddy) is `infra/docker-compose.prod.yml`; see `infra/RUNBOOK.md`.

## Resetting a password

There is no self-service password reset; an administrator does it from the shell. The script replaces the password hash and revokes every refresh token of that user, so all of their devices are signed out (an access token already issued stays valid for up to 30 minutes):

```bash
# in backend/ (prompts twice); --password-stdin reads one line from stdin instead
python scripts/reset_password.py user@example.com
# on the server
docker compose -p wallet exec api python scripts/reset_password.py user@example.com
```
