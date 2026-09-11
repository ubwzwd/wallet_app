"""
Database connection and session management.

Holds the engine, the session factory, the declarative ``Base`` (carrying the
shared naming convention of 02-database.md §5.0) and the ``get_db`` dependency.
"""
from sqlalchemy import MetaData, create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

# Shared constraint naming convention (02-database.md §5.0). The same
# convention is used by ``create_all`` and by Alembic, so ``batch_alter_table``
# can drop constraints by name. Note the ``ck`` rule expands the *whole* name
# passed to ``CheckConstraint(name=...)``, so models must pass the suffix only.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

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
else:
    # SQLite requires check_same_thread=False for multi-threaded FastAPI
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

# Create database engine
engine = create_engine(settings.DATABASE_URL, **_engine_kwargs)

if _is_sqlite:
    # SQLite ignores foreign keys unless they are switched on per connection
    # (02-database.md §8.1 rule 3), which would hide every ON DELETE rule.
    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
        dbapi_connection.execute("PRAGMA foreign_keys=ON")


# Session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


class Base(DeclarativeBase):
    """Declarative base for all models; carries the shared naming convention."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


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
