"""
Pytest configuration for backend tests.
Uses SQLite in-memory for tests that need a real database session,
and mocks heavy native dependencies for structural/unit tests.
"""
import os
import sys

# Set env vars before any app imports so settings picks them up
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-tests-only")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


# ---------------------------------------------------------------------------
# Optional mocks for environments where native packages are not installed.
# Only mock if not already importable so real packages take precedence.
# ---------------------------------------------------------------------------

def _mock_module(name: str, **attrs):
    from unittest.mock import MagicMock
    m = MagicMock()
    for k, v in attrs.items():
        setattr(m, k, v)
    sys.modules[name] = m
    return m


if "psycopg2" not in sys.modules:
    try:
        import psycopg2  # noqa: F401
    except ImportError:
        _mock_module("psycopg2")
        _mock_module("psycopg2.extensions", UNICODE=0)
        _mock_module("psycopg2.extras")


# ---------------------------------------------------------------------------
# SQLite in-memory engine + session fixture
# ---------------------------------------------------------------------------

SQLITE_URL = "sqlite:///:memory:"

_test_engine = create_engine(
    SQLITE_URL,
    connect_args={"check_same_thread": False},
)
_TestingSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=_test_engine,
)


@pytest.fixture(scope="session", autouse=True)
def create_tables():
    """Create all tables once per test session."""
    from app.core.database import Base
    # Ensure all models are registered on Base.metadata
    import app.models.user  # noqa
    import app.models.finance_source  # noqa
    import app.models.transaction  # noqa
    import app.models.transaction_tag  # noqa
    Base.metadata.create_all(bind=_test_engine)
    yield
    Base.metadata.drop_all(bind=_test_engine)


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
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.database import get_db

    def override_get_db():
        try:
            yield db_session
        finally:
            pass  # transaction managed by db_session fixture

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
