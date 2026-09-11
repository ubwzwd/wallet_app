"""
Pytest configuration for backend tests.

Default path: a SQLite in-memory database built from the models
(02-database.md §8.1). Migration tests get a throwaway Postgres database
(§8.2, skipped without TEST_POSTGRES_URL) or a SQLite file database.
"""
import os
import uuid

# Set env vars before any app imports so settings picks them up
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-tests-only")

from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import create_engine, event, make_url  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = BACKEND_DIR / "migrations"


def alembic_config(url: str) -> Config:
    """Build an Alembic config pointed at this repo's migrations and ``url``."""
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


# ---------------------------------------------------------------------------
# SQLite in-memory engine + session fixture
# ---------------------------------------------------------------------------

SQLITE_URL = "sqlite:///:memory:"

# StaticPool keeps one connection, so every session sees the same memory db.
_test_engine = create_engine(
    SQLITE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_TestingSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=_test_engine,
)


@event.listens_for(_test_engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
    """SQLite ignores foreign keys unless asked (02-database.md §8.1 rule 3)."""
    dbapi_connection.execute("PRAGMA foreign_keys=ON")


@pytest.fixture()
def db():
    """A session on a freshly created in-memory schema; dropped afterwards."""
    from app.models import Base  # noqa: F401  (registers every model)

    Base.metadata.create_all(bind=_test_engine)
    session = _TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=_test_engine)


@pytest.fixture()
def client(db):
    """FastAPI TestClient with get_db overridden to use the test session."""
    from fastapi.testclient import TestClient

    from app.core.database import get_db
    from app.main import app

    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Migration fixtures (02-database.md §8.2)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def postgres_url() -> str:
    """URL of a real Postgres superuser connection, or skip the test."""
    url = os.environ.get("TEST_POSTGRES_URL")
    if not url:
        pytest.skip("TEST_POSTGRES_URL is not set")
    return url


@pytest.fixture()
def migrated_db(postgres_url):
    """Yield the URL of a brand new, empty Postgres database.

    Tests run the migrations themselves with ``alembic_config(url)``; the
    database is dropped afterwards, so cases never share state.
    """
    db_name = f"wallet_test_{uuid.uuid4().hex[:12]}"
    admin_engine = create_engine(postgres_url, isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as conn:
            conn.exec_driver_sql(f'CREATE DATABASE "{db_name}"')
        try:
            yield make_url(postgres_url).set(database=db_name).render_as_string(
                hide_password=False
            )
        finally:
            with admin_engine.connect() as conn:
                conn.exec_driver_sql(f'DROP DATABASE IF EXISTS "{db_name}" WITH (FORCE)')
    finally:
        admin_engine.dispose()


@pytest.fixture()
def sqlite_migrated_db(tmp_path):
    """Yield the URL of an empty SQLite file database for migration tests."""
    return f"sqlite:///{tmp_path}/mig.db"
