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

from app.core.clock import utcnow  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = BACKEND_DIR / "migrations"

# The quotation day the fake Frankfurter reports for /latest.
FAKE_RATE_DAY = "2026-09-11"


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


# ---------------------------------------------------------------------------
# API test infrastructure (03-backend-api.md §10.1)
# ---------------------------------------------------------------------------


@pytest.fixture()
def client(db):
    """``TestClient`` on the real app, wired to the ``db`` fixture's session."""
    from fastapi.testclient import TestClient

    from app.core.database import get_db
    from app.main import app

    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture()
def fresh_session():
    """Open a second ``Session`` on the test database, closed afterwards.

    Used where a case has to look at what a request *committed*: roll the
    ``db`` session back first, then read through a session that has no
    identity map of its own.
    """
    opened = []

    def make():
        session = _TestingSessionLocal()
        opened.append(session)
        return session

    try:
        yield make
    finally:
        for session in opened:
            session.close()


@pytest.fixture()
def user_factory(db):
    """Insert users straight into the table, bypassing ``POST /auth/register``.

    Emails are unique per call unless one is given, so a case can ask for
    several users without inventing addresses.
    """
    from app.core.security import get_password_hash
    from app.models.user import User

    created = 0

    def make(
        email: str | None = None,
        password: str = "correct horse battery",
        base_currency: str = "CNY",
        language: str | None = "zh",
        display_name: str | None = None,
    ) -> User:
        nonlocal created
        created += 1
        now = utcnow()
        user = User(
            email=email or f"user{created}-{uuid.uuid4().hex[:8]}@example.test",
            password_hash=get_password_hash(password),
            display_name=display_name,
            base_currency=base_currency.upper(),
            language=language,
            created_at=now,
            updated_at=now,
        )
        db.add(user)
        db.flush()
        return user

    return make


@pytest.fixture()
def auth_headers():
    """``{"Authorization": "Bearer <token>"}`` for a user built by the factory."""
    from app.core.security import create_access_token

    def make(user) -> dict[str, str]:
        return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}

    return make


@pytest.fixture()
def ledger_factory(db):
    """Insert a ledger plus its membership rows directly (decision §2).

    ``members`` takes users (joined as ``member``) or ``(user, role)`` pairs;
    ``owner`` always gets the single ``owner`` row.
    """
    from app.models.ledger import Ledger, LedgerMember

    def make(
        owner,
        name: str = "我的账本",
        base_currency: str | None = None,
        members=(),
    ) -> Ledger:
        now = utcnow()
        ledger = Ledger(
            name=name,
            base_currency=(base_currency or owner.base_currency).upper(),
            created_by=owner.id,
            created_at=now,
            updated_at=now,
        )
        db.add(ledger)
        db.flush()
        db.add(
            LedgerMember(ledger_id=ledger.id, user_id=owner.id, role="owner", joined_at=now)
        )
        for entry in members:
            member, role = entry if isinstance(entry, tuple) else (entry, "member")
            db.add(
                LedgerMember(
                    ledger_id=ledger.id, user_id=member.id, role=role, joined_at=now
                )
            )
        db.flush()
        return ledger

    return make


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """Empty every token bucket around each case (§10.1).

    Without this the *global* ``join`` bucket would carry tokens spent by one
    case into the next one.
    """
    from app.core import ratelimit

    ratelimit.reset_all()
    yield
    ratelimit.reset_all()


# Fixed cross rates for the fake upstream: the value of one USD in each currency.
FAKE_RATES_PER_USD = {
    "USD": 1.0,
    "CNY": 7.2,
    "EUR": 0.92,
    "GBP": 0.79,
    "JPY": 150.0,
    "SGD": 1.35,
}
FAKE_CURRENCY_NAMES = {
    "USD": "United States Dollar",
    "CNY": "Chinese Renminbi Yuan",
    "EUR": "Euro",
    "GBP": "British Pound",
    "JPY": "Japanese Yen",
    "SGD": "Singapore Dollar",
}


@pytest.fixture(autouse=True)
def fake_frankfurter(monkeypatch):
    """Serve every Frankfurter call from an ``httpx.MockTransport`` (§10.1).

    The test process must never reach the network, so ``fx.client_factory`` is
    replaced for *every* case; the cases that care about upstream behaviour
    install their own handler on top of this one.
    """
    import httpx

    from app.services import fx

    def quote(base: str, symbol: str) -> float:
        return FAKE_RATES_PER_USD[symbol] / FAKE_RATES_PER_USD[base]

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "currencies":
            return httpx.Response(200, json=FAKE_CURRENCY_NAMES)

        params = request.url.params
        base = (params.get("from") or "EUR").upper()
        symbols = [code.upper() for code in (params.get("to") or "").split(",") if code]
        known = [code for code in symbols if code in FAKE_RATES_PER_USD]
        if base not in FAKE_RATES_PER_USD or not known:
            return httpx.Response(404, json={"message": "not found"})
        rates = {symbol: quote(base, symbol) for symbol in known}

        if path == "latest":
            return httpx.Response(
                200,
                json={"amount": 1.0, "base": base, "date": FAKE_RATE_DAY, "rates": rates},
            )
        # "{start}..{end}": quote the end day, which is the day being asked about.
        start, _, end = path.partition("..")
        return httpx.Response(
            200,
            json={
                "amount": 1.0,
                "base": base,
                "start_date": start,
                "end_date": end,
                "rates": {end: rates},
            },
        )

    client = httpx.Client(
        transport=httpx.MockTransport(handler), base_url="https://frankfurter.test/v1"
    )
    fx.reset_state()
    monkeypatch.setattr(fx, "client_factory", lambda: client)
    try:
        yield handler
    finally:
        client.close()
        fx.reset_state()
