# Wallet App Backend

FastAPI backend for multi-currency expense tracking application.

## Prerequisites

- Python 3.11+
- Docker & Docker Compose
- Poetry (will be installed with instructions below)

## Quick Start

### 1. Install Poetry

```bash
curl -sSL https://install.python-poetry.org | python3 -
```

Or on Ubuntu/Debian:
```bash
pipx install poetry
```

### 2. Install Dependencies

```bash
cd backend
poetry install
```

This will:
- Create a virtual environment
- Install all dependencies from `pyproject.toml`
- Generate `poetry.lock` file

### 3. Setup Environment Variables

```bash
cp env.example .env
# Edit .env and update SECRET_KEY and other values
```

Generate a secure SECRET_KEY:
```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 4. Start PostgreSQL

```bash
docker-compose up -d db
```

This starts PostgreSQL on port 5432.

### 5. Run Database Migrations

(Will be added in Phase 1.2)

```bash
poetry run alembic upgrade head
```

### 6. Run the Development Server

```bash
poetry run uvicorn app.main:app --reload
```

Or enter the Poetry shell first:
```bash
poetry shell
uvicorn app.main:app --reload
```

API will be available at:
- **API**: http://localhost:8000
- **Docs**: http://localhost:8000/docs (Swagger UI)
- **ReDoc**: http://localhost:8000/redoc

## Poetry Cheat Sheet

```bash
# Add a new dependency
poetry add package-name

# Add a dev dependency
poetry add --group dev package-name

# Update dependencies
poetry update

# Show installed packages
poetry show

# Enter virtual environment
poetry shell

# Run command in poetry env
poetry run python script.py

# Export requirements.txt (for deployment without Poetry)
poetry export -f requirements.txt --output requirements.txt --without-hashes
```

## Project Structure

```
backend/
├── app/
│   ├── api/          # API route handlers
│   ├── core/         # Core functionality (security, config)
│   ├── models/       # SQLAlchemy models
│   ├── schemas/      # Pydantic schemas
│   ├── services/     # Business logic (rates, etc.)
│   └── main.py       # FastAPI app initialization
├── migrations/       # Alembic database migrations
├── tests/            # Test files
├── docker-compose.yml
├── Dockerfile
├── pyproject.toml    # Poetry dependencies and config
└── README.md
```

## Development Workflow

1. Make code changes
2. Run tests: `poetry run pytest`
3. Format code: `poetry run black .`
4. Lint code: `poetry run ruff check .`
5. Type check: `poetry run mypy app/`
6. Commit changes

## Docker Development (Alternative)

If you prefer to run everything in Docker:

```bash
# Uncomment the 'api' service in docker-compose.yml first
docker-compose up --build
```

## Testing

```bash
# Run all tests
poetry run pytest

# Run with coverage
poetry run pytest --cov=app --cov-report=html

# Run specific test file
poetry run pytest tests/test_auth.py -v
```

## Database Management

```bash
# Create a new migration
poetry run alembic revision --autogenerate -m "Description"

# Apply migrations
poetry run alembic upgrade head

# Rollback one migration
poetry run alembic downgrade -1

# Show current revision
poetry run alembic current

# Show migration history
poetry run alembic history
```

## Production Deployment

See main [SPEC.md](../SPEC.md) and [PLAN.md](../PLAN.md) for AWS deployment instructions.

## Troubleshooting

### Poetry not found after installation
```bash
# Add to ~/.bashrc or ~/.zshrc
export PATH="$HOME/.local/bin:$PATH"
source ~/.bashrc  # or source ~/.zshrc
```

### Database connection errors
```bash
# Check PostgreSQL is running
docker-compose ps

# Check logs
docker-compose logs db

# Reset database
docker-compose down -v
docker-compose up -d db
```

### Port 5432 already in use
```bash
# Check what's using the port
sudo lsof -i :5432

# Stop system PostgreSQL if running
sudo systemctl stop postgresql
```

## Next Steps

- [ ] Complete Phase 1.2: Database Models & Migrations
- [ ] Complete Phase 1.3: Core Security & Auth
- [ ] See [PLAN.md](../PLAN.md) for full roadmap

