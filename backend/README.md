# Wallet App Backend

FastAPI + SQLAlchemy 2 + Alembic. Python 3.12.

## Local setup

```bash
cd backend
# system Python 3.12 ...
python3 -m pip install -r requirements-dev.txt
# ... or an isolated environment with uv
uv venv .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt

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
- `requirements-dev.txt` adds pytest and pytest-asyncio; it is never copied into the image.
- `pyproject.toml` only carries project metadata and tool settings (pytest, black, ruff); nothing is packaged.
- Upgrading: install the new version locally, run the whole test suite, then edit the pin.

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
