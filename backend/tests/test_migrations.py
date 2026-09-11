"""Migration tests (02-database.md §8.2).

Every case marked ``postgres`` drives the real Alembic chain against a
throwaway Postgres database (``migrated_db``, skipped without
TEST_POSTGRES_URL). The last case runs the same chain on a SQLite file
database and therefore stays in the default loop — the batch rebuilds of §5
only show their problems on SQLite.
"""
import contextlib
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from app.models import Base
from tests.conftest import alembic_config

# Last revision of the chain (§5.7) and the head this project migrated from.
HEAD_REVISION = "b1f3c2a10d46"
LEGACY_HEAD = "8a4f4d66d893"

TARGET_TABLES = {
    "users",
    "ledgers",
    "ledger_members",
    "ledger_invites",
    "finance_sources",
    "transactions",
    "transaction_events",
    "import_batches",
    "import_rows",
    "exchange_rates",
}

NOW = datetime(2026, 9, 12, 10, 0, 0)
TODAY = date(2026, 9, 12)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _upgrade(url: str, revision: str = "head") -> None:
    command.upgrade(alembic_config(url), revision)


def _downgrade(url: str, revision: str) -> None:
    command.downgrade(alembic_config(url), revision)


@contextlib.contextmanager
def _engine(url: str):
    """A disposable engine on ``url``."""
    engine = create_engine(url)
    try:
        yield engine
    finally:
        engine.dispose()


def _reject(engine, sql: str, params: dict, constraint: str | tuple[str, ...]) -> None:
    """The statement must fail on ``constraint``; each try gets its own tx.

    A tuple means the row breaks several constraints at once and the database
    is free to report whichever it checks first.
    """
    names = (constraint,) if isinstance(constraint, str) else constraint
    with pytest.raises(IntegrityError) as excinfo:
        with engine.begin() as conn:
            conn.execute(text(sql), params)
    assert any(name in str(excinfo.value) for name in names), str(excinfo.value)


_TX_INSERT = (
    "INSERT INTO transactions (id, ledger_id, source_id, amount, currency, occurred_at, "
    "kind, note, merchant, category_l1, category_l2, transfer_role, transfer_subtype, "
    "transfer_pair_id, counterparty, refund_of, import_batch_id, created_by, updated_by, "
    "created_at, updated_at) VALUES (:id, :ledger_id, :source_id, :amount, :currency, "
    ":occurred_at, :kind, :note, :merchant, :category_l1, :category_l2, :transfer_role, "
    ":transfer_subtype, :transfer_pair_id, :counterparty, :refund_of, :import_batch_id, "
    ":created_by, :updated_by, :created_at, :updated_at)"
)


def _tx(seed: dict, **overrides) -> dict:
    """Parameters for a legal expense row; overrides make it illegal."""
    params = {
        "id": uuid.uuid4(),
        "ledger_id": seed["ledger"],
        "source_id": seed["source"],
        "amount": Decimal("-12.34"),
        "currency": "SGD",
        "occurred_at": TODAY,
        "kind": "expense",
        "note": None,
        "merchant": None,
        "category_l1": "other",
        "category_l2": None,
        "transfer_role": None,
        "transfer_subtype": None,
        "transfer_pair_id": None,
        "counterparty": None,
        "refund_of": None,
        "import_batch_id": None,
        "created_by": seed["user"],
        "updated_by": seed["user"],
        "created_at": NOW,
        "updated_at": NOW,
    }
    params.update(overrides)
    return params


def _seed_at_head(engine) -> dict:
    """One user, one ledger with an owner membership and two accounts."""
    seed = {
        "user": uuid.uuid4(),
        "ledger": uuid.uuid4(),
        "source": uuid.uuid4(),
        "source2": uuid.uuid4(),
    }
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, email, password_hash, base_currency, "
                "created_at, updated_at) VALUES (:id, 'a@example.com', 'x', 'SGD', "
                ":now, :now)"
            ),
            {"id": seed["user"], "now": NOW},
        )
        conn.execute(
            text(
                "INSERT INTO ledgers (id, name, base_currency, created_by, created_at, "
                "updated_at) VALUES (:id, 'L', 'SGD', :uid, :now, :now)"
            ),
            {"id": seed["ledger"], "uid": seed["user"], "now": NOW},
        )
        conn.execute(
            text(
                "INSERT INTO ledger_members (ledger_id, user_id, role, joined_at) "
                "VALUES (:lid, :uid, 'owner', :now)"
            ),
            {"lid": seed["ledger"], "uid": seed["user"], "now": NOW},
        )
        conn.execute(
            text(
                "INSERT INTO finance_sources (id, ledger_id, name, type, default_currency, "
                "opening_balance, archived, archived_at, created_by, updated_by, created_at, "
                "updated_at) VALUES (:id, :lid, :name, :type, 'SGD', 0, FALSE, NULL, :uid, "
                ":uid, :now, :now)"
            ),
            [
                {
                    "id": seed["source"],
                    "lid": seed["ledger"],
                    "name": "Cash",
                    "type": "cash",
                    "uid": seed["user"],
                    "now": NOW,
                },
                {
                    "id": seed["source2"],
                    "lid": seed["ledger"],
                    "name": "Card",
                    "type": "credit",
                    "uid": seed["user"],
                    "now": NOW,
                },
            ],
        )
    return seed


def _seed_legacy_data(engine) -> dict:
    """Fill a database sitting on 8a4f4d66d893 with the rows §8.2 asks for."""
    ids = {
        key: uuid.uuid4()
        for key in (
            "u1",
            "u2",
            "s1",
            "s2",
            "s3",
            "s4",
            "t_expense",
            "t_income",
            "t_out",
            "t_in",
            "t_same_sign_a",
            "t_same_sign_b",
            "t_zero",
            "t_orphan",
            "t_u2",
        )
    }
    ids["pair_ok"] = uuid.uuid4()
    ids["pair_same_sign"] = uuid.uuid4()
    ids["deleted_source"] = uuid.uuid4()

    with engine.begin() as conn:
        # The orphan row of §8.2 (source_id pointing at an account that is
        # gone) cannot exist while the foreign key of the initial migration is
        # in place, so it is dropped here. The v3 chain never recreates that
        # key by name, which is why this database is only used for the
        # backfill assertions and never for compare_metadata.
        fk_name = conn.execute(
            text(
                "SELECT conname FROM pg_constraint "
                "WHERE conrelid = 'transactions'::regclass AND contype = 'f' "
                "AND confrelid = 'finance_sources'::regclass"
            )
        ).scalar_one()
        conn.execute(text(f'ALTER TABLE transactions DROP CONSTRAINT "{fk_name}"'))

        conn.execute(
            text(
                "INSERT INTO users (id, email, password_hash, base_currency, created_at) "
                "VALUES (:id, :email, 'x', :cur, :created_at)"
            ),
            [
                # lower case on purpose: step 6 normalises before the CHECK
                {
                    "id": ids["u1"],
                    "email": "one@example.com",
                    "cur": "usd",
                    "created_at": NOW,
                },
                {
                    "id": ids["u2"],
                    "email": "two@example.com",
                    "cur": "SGD",
                    "created_at": NOW + timedelta(seconds=1),
                },
            ],
        )
        conn.execute(
            text(
                "INSERT INTO finance_sources (id, user_id, name, type, default_currency, "
                "archived, created_at) VALUES (:id, :uid, :name, :type, :cur, :archived, :now)"
            ),
            [
                # u1: one live account, one archived account with a legacy type
                {
                    "id": ids["s1"],
                    "uid": ids["u1"],
                    "name": "Cash",
                    "type": "cash",
                    "cur": "usd",
                    "archived": False,
                    "now": NOW,
                },
                {
                    "id": ids["s2"],
                    "uid": ids["u1"],
                    "name": "Savings",
                    "type": "储蓄",
                    "cur": "USD",
                    "archived": True,
                    "now": NOW,
                },
                # u2: a made-up type and a type that survives untouched
                {
                    "id": ids["s3"],
                    "uid": ids["u2"],
                    "name": "Wallet",
                    "type": "savings_account",
                    "cur": "SGD",
                    "archived": False,
                    "now": NOW,
                },
                {
                    "id": ids["s4"],
                    "uid": ids["u2"],
                    "name": "Visa",
                    "type": "credit",
                    "cur": "SGD",
                    "archived": True,
                    "now": NOW,
                },
            ],
        )
        conn.execute(
            text("UPDATE users SET default_source_id = :sid WHERE id = :uid"),
            {"sid": ids["s1"], "uid": ids["u1"]},
        )
        conn.execute(
            text(
                "INSERT INTO transactions (id, user_id, source_id, amount, currency, "
                "occurred_at, description, merchant, created_at, transfer_pair_id) "
                "VALUES (:id, :uid, :sid, :amount, :cur, :day, :descr, NULL, :now, :pair)"
            ),
            [
                {
                    "id": ids["t_expense"],
                    "uid": ids["u1"],
                    "sid": ids["s1"],
                    "amount": Decimal("-12.34"),
                    "cur": "usd",
                    "day": TODAY,
                    "descr": "lunch",
                    "now": NOW,
                    "pair": None,
                },
                {
                    "id": ids["t_income"],
                    "uid": ids["u1"],
                    "sid": ids["s1"],
                    "amount": Decimal("100.00"),
                    "cur": "USD",
                    "day": TODAY,
                    "descr": "salary",
                    "now": NOW,
                    "pair": None,
                },
                # a well formed pair: opposite signs
                {
                    "id": ids["t_out"],
                    "uid": ids["u1"],
                    "sid": ids["s1"],
                    "amount": Decimal("-50.00"),
                    "cur": "USD",
                    "day": TODAY,
                    "descr": None,
                    "now": NOW,
                    "pair": ids["pair_ok"],
                },
                {
                    "id": ids["t_in"],
                    "uid": ids["u1"],
                    "sid": ids["s2"],
                    "amount": Decimal("50.00"),
                    "cur": "USD",
                    "day": TODAY,
                    "descr": None,
                    "now": NOW,
                    "pair": ids["pair_ok"],
                },
                # a broken pair: both legs negative, must be scattered
                {
                    "id": ids["t_same_sign_a"],
                    "uid": ids["u1"],
                    "sid": ids["s1"],
                    "amount": Decimal("-20.00"),
                    "cur": "USD",
                    "day": TODAY,
                    "descr": None,
                    "now": NOW,
                    "pair": ids["pair_same_sign"],
                },
                {
                    "id": ids["t_same_sign_b"],
                    "uid": ids["u1"],
                    "sid": ids["s2"],
                    "amount": Decimal("-20.00"),
                    "cur": "USD",
                    "day": TODAY,
                    "descr": None,
                    "now": NOW,
                    "pair": ids["pair_same_sign"],
                },
                # no sign fits ck_transactions_amount_sign: deleted by step 4
                {
                    "id": ids["t_zero"],
                    "uid": ids["u1"],
                    "sid": ids["s1"],
                    "amount": Decimal("0"),
                    "cur": "USD",
                    "day": TODAY,
                    "descr": "zero",
                    "now": NOW,
                    "pair": None,
                },
                # no account to take a ledger_id from: deleted by step 3
                {
                    "id": ids["t_orphan"],
                    "uid": ids["u1"],
                    "sid": ids["deleted_source"],
                    "amount": Decimal("-7.00"),
                    "cur": "USD",
                    "day": TODAY,
                    "descr": "orphan",
                    "now": NOW,
                    "pair": None,
                },
                {
                    "id": ids["t_u2"],
                    "uid": ids["u2"],
                    "sid": ids["s3"],
                    "amount": Decimal("-5.00"),
                    "cur": "sgd",
                    "day": TODAY,
                    "descr": None,
                    "now": NOW,
                    "pair": None,
                },
            ],
        )
        conn.execute(
            text("INSERT INTO transaction_tags (transaction_id, tag) VALUES (:tid, :tag)"),
            [
                {"tid": ids["t_expense"], "tag": "food"},
                {"tid": ids["t_income"], "tag": "work"},
            ],
        )
    return ids


@pytest.fixture()
def head_engine(migrated_db):
    """Engine on a fresh database already upgraded to head."""
    _upgrade(migrated_db)
    with _engine(migrated_db) as engine:
        yield engine


# ---------------------------------------------------------------------------
# the chain itself
# ---------------------------------------------------------------------------


@pytest.mark.postgres
def test_upgrade_head_on_empty_database(migrated_db):
    """All six steps run on an empty database and stamp the last revision."""
    _upgrade(migrated_db)

    with _engine(migrated_db) as engine:
        tables = set(inspect(engine).get_table_names())
        with engine.connect() as conn:
            stamped = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()

    assert stamped == HEAD_REVISION
    assert TARGET_TABLES <= tables
    # §5.5: tags are gone, and nothing of the pre-rename schema is left
    assert "transaction_tags" not in tables
    assert "accounts" not in tables
    assert tables - TARGET_TABLES == {"alembic_version"}


@pytest.mark.postgres
def test_downgrade_base_after_upgrade_head(migrated_db):
    """Every downgrade() is reachable and leaves an empty database behind."""
    _upgrade(migrated_db)
    _downgrade(migrated_db, "base")

    with _engine(migrated_db) as engine:
        tables = set(inspect(engine).get_table_names())

    assert tables <= {"alembic_version"}


@pytest.mark.postgres
def test_upgrade_with_existing_data(migrated_db):
    """The backfills of steps 2-6 on a populated database (§8.2, §5.2-§5.6)."""
    _upgrade(migrated_db, LEGACY_HEAD)
    with _engine(migrated_db) as engine:
        ids = _seed_legacy_data(engine)
    _upgrade(migrated_db)

    with _engine(migrated_db) as engine, engine.connect() as conn:
        # one ledger per user, owned by that user (§5.2)
        members = conn.execute(
            text(
                "SELECT m.user_id, m.role, l.base_currency FROM ledger_members m "
                "JOIN ledgers l ON l.id = m.ledger_id"
            )
        ).all()
        assert len(members) == 2
        assert {m.role for m in members} == {"owner"}
        assert {m.user_id for m in members} == {ids["u1"], ids["u2"]}
        by_user = {m.user_id: m for m in members}
        # the ledger inherits the user's base currency, upper cased
        assert by_user[ids["u1"]].base_currency == "USD"
        assert by_user[ids["u2"]].base_currency == "SGD"
        assert conn.execute(text("SELECT count(*) FROM ledgers")).scalar_one() == 2

        # every account and transaction now hangs off a ledger, consistently
        assert (
            conn.execute(
                text("SELECT count(*) FROM finance_sources WHERE ledger_id IS NULL")
            ).scalar_one()
            == 0
        )
        assert (
            conn.execute(
                text(
                    "SELECT count(*) FROM transactions t JOIN finance_sources s "
                    "ON s.id = t.source_id WHERE t.ledger_id IS NULL "
                    "OR t.ledger_id <> s.ledger_id"
                )
            ).scalar_one()
            == 0
        )

        sources = {
            row.id: row
            for row in conn.execute(
                text("SELECT id, type, archived, archived_at, ledger_id FROM finance_sources")
            ).all()
        }
        assert len(sources) == 4
        # §14.48: four values only, legacy ones rewritten to checking
        assert {s.type for s in sources.values()} <= {"checking", "credit", "cash", "other"}
        assert sources[ids["s2"]].type == "checking"
        assert sources[ids["s3"]].type == "checking"
        assert sources[ids["s1"]].type == "cash"
        assert sources[ids["s4"]].type == "credit"
        # §14.50: archived_at is set exactly for the archived accounts
        for key in ("s2", "s4"):
            assert sources[ids[key]].archived is True
            assert sources[ids[key]].archived_at is not None
        for key in ("s1", "s3"):
            assert sources[ids[key]].archived is False
            assert sources[ids[key]].archived_at is None
        # the two users' accounts landed in different ledgers
        assert sources[ids["s1"]].ledger_id == sources[ids["s2"]].ledger_id
        assert sources[ids["s1"]].ledger_id != sources[ids["s3"]].ledger_id

        # §14.40: nothing to backfill display_name from
        assert (
            conn.execute(
                text("SELECT count(*) FROM users WHERE display_name IS NOT NULL")
            ).scalar_one()
            == 0
        )
        assert (
            conn.execute(text("SELECT base_currency FROM users WHERE id = :id"), {"id": ids["u1"]})
            .scalar_one()
            .strip()
            == "USD"
        )

        txs = {
            row.id: row
            for row in conn.execute(
                text(
                    "SELECT id, kind, amount, currency, note, category_l1, category_l2, "
                    "transfer_role, transfer_subtype, transfer_pair_id FROM transactions"
                )
            ).all()
        }
        # the zero-amount row and the orphan row are gone (§5.3, §5.4)
        assert ids["t_zero"] not in txs
        assert ids["t_orphan"] not in txs
        assert len(txs) == 7

        # kind is backfilled from the sign and the pair (§5.4)
        assert txs[ids["t_expense"]].kind == "expense"
        assert txs[ids["t_expense"]].category_l1 == "other"
        assert txs[ids["t_expense"]].note == "lunch"
        assert txs[ids["t_expense"]].currency.strip() == "USD"
        assert txs[ids["t_income"]].kind == "income"
        assert txs[ids["t_income"]].category_l1 == "other_income"
        assert txs[ids["t_u2"]].currency.strip() == "SGD"

        # the well formed pair survives as a transfer with opposite roles
        for key, role in ((("t_out"), "out"), ("t_in", "in")):
            leg = txs[ids[key]]
            assert leg.kind == "transfer"
            assert leg.transfer_role == role
            assert leg.transfer_subtype == "plain"
            assert leg.category_l1 is None and leg.category_l2 is None
        assert txs[ids["t_out"]].transfer_pair_id == txs[ids["t_in"]].transfer_pair_id
        assert txs[ids["t_out"]].transfer_pair_id == ids["pair_ok"]

        # the same-sign pair is scattered into two ordinary expenses
        for key in ("t_same_sign_a", "t_same_sign_b"):
            leg = txs[ids[key]]
            assert leg.transfer_pair_id is None
            assert leg.kind == "expense"
            assert leg.transfer_role is None

        # §5.5
        assert "transaction_tags" not in set(inspect(engine).get_table_names())


@pytest.mark.postgres
def test_schema_matches_the_models(migrated_db):
    """The migrated schema and Base.metadata may not drift apart (§8.2)."""
    _upgrade(migrated_db)

    with _engine(migrated_db) as engine, engine.connect() as conn:
        context = MigrationContext.configure(conn, opts={"compare_type": True})
        diff = compare_metadata(context, Base.metadata)

    assert diff == []


# ---------------------------------------------------------------------------
# what the migrated schema actually enforces
# ---------------------------------------------------------------------------


@pytest.mark.postgres
def test_transaction_constraints_are_enforced(head_engine):
    """The eight constraints of §1.6.1, one illegal row each."""
    seed = _seed_at_head(head_engine)

    # a legal expense goes in
    legal = _tx(seed)
    with head_engine.begin() as conn:
        conn.execute(text(_TX_INSERT), legal)

    # An unknown kind matches no branch of the sign constraint either, so
    # Postgres may report whichever of the two it reaches first.
    _reject(
        head_engine,
        _TX_INSERT,
        _tx(seed, kind="bogus"),
        ("ck_transactions_kind", "ck_transactions_amount_sign"),
    )
    _reject(
        head_engine,
        _TX_INSERT,
        _tx(seed, kind="expense", amount=Decimal("100")),
        "ck_transactions_amount_sign",
    )
    _reject(
        head_engine,
        _TX_INSERT,
        _tx(seed, transfer_role="out"),
        "ck_transactions_transfer_role",
    )
    _reject(
        head_engine,
        _TX_INSERT,
        _tx(seed, transfer_subtype="plain"),
        "ck_transactions_transfer_subtype",
    )
    _reject(head_engine, _TX_INSERT, _tx(seed, category_l1=None), "ck_transactions_category")
    _reject(
        head_engine,
        _TX_INSERT,
        _tx(seed, refund_of=legal["id"]),
        "ck_transactions_refund_of",
    )
    _reject(
        head_engine,
        _TX_INSERT,
        _tx(
            seed,
            kind="transfer",
            transfer_role="out",
            transfer_subtype="plain",
            category_l1=None,
            transfer_pair_id=uuid.uuid4(),
            counterparty="spouse",
        ),
        "ck_transactions_counterparty",
    )

    # the eighth is the UNIQUE: two legs of one pair may not share a role
    pair = uuid.uuid4()
    out_leg = dict(
        kind="transfer",
        transfer_role="out",
        transfer_subtype="plain",
        category_l1=None,
        transfer_pair_id=pair,
    )
    with head_engine.begin() as conn:
        conn.execute(text(_TX_INSERT), _tx(seed, **out_leg))
    _reject(
        head_engine,
        _TX_INSERT,
        _tx(seed, source_id=seed["source2"], **out_leg),
        "uq_transactions_transfer_pair_role",
    )
    # the other direction is fine, which is what makes the pair a pair
    with head_engine.begin() as conn:
        conn.execute(
            text(_TX_INSERT),
            _tx(
                seed,
                source_id=seed["source2"],
                kind="transfer",
                transfer_role="in",
                transfer_subtype="plain",
                category_l1=None,
                transfer_pair_id=pair,
                amount=Decimal("12.34"),
            ),
        )


_SOURCE_INSERT = (
    "INSERT INTO finance_sources (id, ledger_id, name, type, default_currency, "
    "opening_balance, archived, archived_at, created_by, updated_by, created_at, updated_at) "
    "VALUES (:id, :lid, 'X', :type, 'SGD', 0, :archived, :archived_at, :uid, :uid, :now, :now)"
)


@pytest.mark.postgres
def test_account_type_and_archived_at_are_enforced(head_engine):
    """Decisions §14.48 and §14.50 are database rules, not app conventions."""
    seed = _seed_at_head(head_engine)
    base = {
        "id": uuid.uuid4(),
        "lid": seed["ledger"],
        "type": "checking",
        "archived": False,
        "archived_at": None,
        "uid": seed["user"],
        "now": NOW,
    }

    _reject(
        head_engine,
        _SOURCE_INSERT,
        {**base, "type": "savings"},
        "ck_finance_sources_type",
    )
    _reject(
        head_engine,
        _SOURCE_INSERT,
        {**base, "archived": True, "archived_at": None},
        "ck_finance_sources_archived_at",
    )
    _reject(
        head_engine,
        _SOURCE_INSERT,
        {**base, "archived": False, "archived_at": NOW},
        "ck_finance_sources_archived_at",
    )

    # both halves of the equivalence are allowed
    with head_engine.begin() as conn:
        conn.execute(text(_SOURCE_INSERT), base)
        conn.execute(
            text(_SOURCE_INSERT),
            {**base, "id": uuid.uuid4(), "archived": True, "archived_at": NOW},
        )


@pytest.mark.postgres
def test_legacy_account_types_are_rewritten(migrated_db):
    """Anything outside the four values becomes checking (§5.3, §14.48)."""
    _upgrade(migrated_db, LEGACY_HEAD)
    user_id, kept_id, legacy_id, invented_id = (uuid.uuid4() for _ in range(4))
    with _engine(migrated_db) as engine:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO users (id, email, password_hash, base_currency, created_at) "
                    "VALUES (:id, 'legacy@example.com', 'x', 'SGD', :now)"
                ),
                {"id": user_id, "now": NOW},
            )
            conn.execute(
                text(
                    "INSERT INTO finance_sources (id, user_id, name, type, default_currency, "
                    "archived, created_at) VALUES (:id, :uid, :name, :type, 'SGD', FALSE, :now)"
                ),
                [
                    {
                        "id": legacy_id,
                        "uid": user_id,
                        "name": "Savings",
                        "type": "储蓄",
                        "now": NOW,
                    },
                    {
                        "id": invented_id,
                        "uid": user_id,
                        "name": "Mystery",
                        "type": "brokerage-2019",
                        "now": NOW,
                    },
                    {
                        "id": kept_id,
                        "uid": user_id,
                        "name": "Visa",
                        "type": "credit",
                        "now": NOW,
                    },
                ],
            )

    _upgrade(migrated_db)

    with _engine(migrated_db) as engine, engine.connect() as conn:
        types = {
            row.id: row.type
            for row in conn.execute(text("SELECT id, type FROM finance_sources")).all()
        }
        assert types[legacy_id] == "checking"
        assert types[invented_id] == "checking"
        assert types[kept_id] == "credit"
        # and the CHECK really did get attached afterwards
        attached = conn.execute(
            text(
                "SELECT count(*) FROM pg_constraint WHERE conname = "
                "'ck_finance_sources_type' AND conrelid = 'finance_sources'::regclass"
            )
        ).scalar_one()
        assert attached == 1


@pytest.mark.postgres
def test_invite_code_has_no_unique_index(head_engine):
    """Decision §14.29: uniqueness is a generator retry, not a database rule."""
    seed = _seed_at_head(head_engine)
    insert = (
        "INSERT INTO ledger_invites (id, ledger_id, code, created_by, created_at, expires_at) "
        "VALUES (:id, :lid, :code, :uid, :now, :expires)"
    )
    with head_engine.begin() as conn:
        conn.execute(
            text(insert),
            [
                {
                    "id": uuid.uuid4(),
                    "lid": seed["ledger"],
                    "code": "123456",
                    "uid": seed["user"],
                    "now": NOW,
                    "expires": NOW + timedelta(minutes=10),
                },
                {
                    "id": uuid.uuid4(),
                    "lid": seed["ledger"],
                    "code": "123456",
                    "uid": seed["user"],
                    "now": NOW,
                    "expires": NOW + timedelta(minutes=20),
                },
            ],
        )
    with head_engine.connect() as conn:
        assert (
            conn.execute(
                text("SELECT count(*) FROM ledger_invites WHERE code = '123456'")
            ).scalar_one()
            == 2
        )
        indexes = {
            row[0]
            for row in conn.execute(
                text("SELECT indexname FROM pg_indexes WHERE tablename = 'ledger_invites'")
            ).all()
        }
    assert indexes == {"pk_ledger_invites", "ix_ledger_invites_ledger_id"}

    # the digits CHECK is not a formality either (§1.4)
    _reject(
        head_engine,
        insert,
        {
            "id": uuid.uuid4(),
            "lid": seed["ledger"],
            "code": "12a456",
            "uid": seed["user"],
            "now": NOW,
            "expires": NOW + timedelta(minutes=10),
        },
        "ck_ledger_invites_code_digits",
    )


@pytest.mark.postgres
def test_transaction_events_cascade_with_the_transaction(head_engine):
    """Decision §14.51: append-only, and it dies with its transaction."""
    seed = _seed_at_head(head_engine)
    tx = _tx(seed)
    event_insert = (
        "INSERT INTO transaction_events (id, ledger_id, transaction_id, actor_id, at, event, "
        "changes, import_batch_id, client) VALUES (:id, :lid, :tid, :uid, :at, :event, NULL, "
        "NULL, 'web')"
    )
    events = [
        {
            "id": uuid.uuid4(),
            "lid": seed["ledger"],
            "tid": tx["id"],
            "uid": seed["user"],
            "at": NOW,
            "event": name,
        }
        for name in ("created", "updated", "refund_linked")
    ]
    with head_engine.begin() as conn:
        conn.execute(text(_TX_INSERT), tx)
        conn.execute(text(event_insert), events)

    with head_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM transaction_events")).scalar_one() == 3

    _reject(
        head_engine,
        event_insert,
        {**events[0], "id": uuid.uuid4(), "event": "archived"},
        "ck_transaction_events_event",
    )

    with head_engine.begin() as conn:
        conn.execute(text("DELETE FROM transactions WHERE id = :id"), {"id": tx["id"]})
    with head_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM transaction_events")).scalar_one() == 0


@pytest.mark.postgres
def test_legacy_indexes_are_dropped(migrated_db):
    """§5.3 and §5.4 drop the indexes the old shape needed."""
    _upgrade(migrated_db, LEGACY_HEAD)
    with _engine(migrated_db) as engine:
        _seed_legacy_data(engine)
    _upgrade(migrated_db)

    with _engine(migrated_db) as engine, engine.connect() as conn:
        indexes = {
            row[0]
            for row in conn.execute(
                text(
                    "SELECT indexname FROM pg_indexes "
                    "WHERE tablename IN ('transactions', 'finance_sources')"
                )
            ).all()
        }

    for gone in (
        "ix_transactions_user_id",
        "ix_accounts_user_id",
        "ix_transactions_account_id",
        "ix_transactions_occurred_at",
        "idx_transactions_transfer_pair",
    ):
        assert gone not in indexes
    # and the ones §4 asks for are there instead
    assert {
        "ix_transactions_ledger_occurred",
        "ix_transactions_ledger_source",
        "ix_transactions_ledger_kind_cat",
        "ix_finance_sources_ledger_id",
    } <= indexes


@pytest.mark.postgres
def test_exchange_rates_upsert(head_engine):
    """§1.10: the cache row is replaced in place, and rate / self checks bite."""
    upsert = (
        "INSERT INTO exchange_rates (date, base, symbol, rate, fetched_at) "
        "VALUES (:date, :base, :symbol, :rate, :fetched_at) "
        "ON CONFLICT (date, base, symbol) DO UPDATE SET rate = EXCLUDED.rate, "
        "fetched_at = EXCLUDED.fetched_at"
    )
    first = {
        "date": TODAY,
        "base": "SGD",
        "symbol": "USD",
        "rate": Decimal("0.74000000"),
        "fetched_at": NOW,
    }
    second = {**first, "rate": Decimal("0.75000000"), "fetched_at": NOW + timedelta(hours=2)}
    with head_engine.begin() as conn:
        conn.execute(text(upsert), first)
        conn.execute(text(upsert), second)

    with head_engine.connect() as conn:
        rows = conn.execute(
            text("SELECT date, base, symbol, rate, fetched_at FROM exchange_rates")
        ).all()
    assert len(rows) == 1
    assert rows[0].rate == Decimal("0.75000000")
    assert rows[0].fetched_at == NOW + timedelta(hours=2)

    _reject(head_engine, upsert, {**first, "rate": Decimal("0")}, "ck_exchange_rates_rate_positive")
    _reject(head_engine, upsert, {**first, "symbol": "SGD"}, "ck_exchange_rates_not_self")


# ---------------------------------------------------------------------------
# the SQLite half of §8.2 — no marker, runs in the default loop
# ---------------------------------------------------------------------------


def test_upgrade_head_on_sqlite_drops_legacy_indexes(sqlite_migrated_db):
    """A batch rebuild trips over any legacy index that was not dropped."""
    _upgrade(sqlite_migrated_db)

    with _engine(sqlite_migrated_db) as engine, engine.connect() as conn:
        tx_indexes = {row[1] for row in conn.exec_driver_sql("PRAGMA index_list('transactions')")}
        all_indexes = {
            row[0]
            for row in conn.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='index'")
        }
        tables = set(inspect(engine).get_table_names())

    assert "ix_transactions_user_id" not in tx_indexes
    # Both names on purpose: the Alembic path really builds ix_accounts_user_id
    # (the initial migration's name), while ix_finance_sources_user_id only
    # shows up in a create_all database (the naming fork of §5.3).
    for name in (
        "ix_transactions_user_id",
        "ix_accounts_user_id",
        "ix_finance_sources_user_id",
    ):
        assert name not in all_indexes
    assert TARGET_TABLES <= tables
    assert "transaction_tags" not in tables
