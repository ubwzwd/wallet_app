"""
Database connection and session management.
Uses SQLAlchemy 2.0 async or sync engine.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings

# DIAGNOSIS RESULT (03-03 Task 1): Backend session lifecycle is correct.
# Root cause: Frontend 401 interceptor (client.ts) clears auth token on ANY 401,
#   including transient GET /auth/me failures under PostgreSQL connection pooling.
#   Isolation test confirmed PATCH -> GET -> GET sequence all return 200 in SQLite.
# Fix applied: Task 2 adds pool_recycle=3600 as defence-in-depth against stale
#   PostgreSQL connections; Task 3 hardens frontend interceptor to preserve token
#   on status-check (GET /auth/me) failures.

# SQLite doesn't support pool_size/max_overflow — detect by URL scheme
_is_sqlite = settings.DATABASE_URL.startswith("sqlite")
_engine_kwargs: dict = {
    "echo": settings.ENVIRONMENT == "development" and settings.DEBUG,
}
if not _is_sqlite:
    _engine_kwargs["pool_pre_ping"] = True   # Test connections before reusing them
    _engine_kwargs["pool_recycle"] = 3600    # Recycle connections every hour
    _engine_kwargs["pool_size"] = 5
    _engine_kwargs["max_overflow"] = 10
if _is_sqlite:
    # SQLite requires check_same_thread=False for multi-threaded FastAPI
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

# Create database engine
engine = create_engine(settings.DATABASE_URL, **_engine_kwargs)

# Session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

# Base class for all models
Base = declarative_base()


def get_db():
    """
    Dependency for getting database session.
    Usage in FastAPI routes:
        def my_route(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

