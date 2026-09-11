"""The models must match 02-database.md §1 column for column, name for name."""
import pytest
from sqlalchemy import CheckConstraint, Index, UniqueConstraint, inspect

from app.models import Base, Transaction

EXPECTED_TABLES = {
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

# §1.1 - §1.10, in DDL order.
EXPECTED_COLUMNS = {
    "users": [
        "id",
        "email",
        "password_hash",
        "display_name",
        "base_currency",
        "language",
        "created_at",
        "updated_at",
    ],
    "ledgers": ["id", "name", "base_currency", "created_by", "created_at", "updated_at"],
    "ledger_members": ["ledger_id", "user_id", "role", "joined_at"],
    "ledger_invites": ["id", "ledger_id", "code", "created_by", "created_at", "expires_at"],
    "finance_sources": [
        "id",
        "ledger_id",
        "name",
        "type",
        "default_currency",
        "opening_balance",
        "archived",
        "archived_at",
        "created_by",
        "updated_by",
        "created_at",
        "updated_at",
    ],
    "transactions": [
        "id",
        "ledger_id",
        "source_id",
        "amount",
        "currency",
        "occurred_at",
        "kind",
        "note",
        "merchant",
        "category_l1",
        "category_l2",
        "transfer_role",
        "transfer_subtype",
        "transfer_pair_id",
        "counterparty",
        "refund_of",
        "import_batch_id",
        "created_by",
        "updated_by",
        "created_at",
        "updated_at",
    ],
    "transaction_events": [
        "id",
        "ledger_id",
        "transaction_id",
        "actor_id",
        "at",
        "event",
        "changes",
        "import_batch_id",
        "client",
    ],
    "import_batches": [
        "id",
        "ledger_id",
        "source_id",
        "created_by",
        "source",
        "filename",
        "size_bytes",
        "skill_version",
        "status",
        "row_count",
        "warnings",
        "created_at",
        "updated_at",
        "committed_at",
    ],
    "import_rows": [
        "id",
        "batch_id",
        "row_no",
        "status",
        "occurred_at",
        "amount",
        "currency",
        "kind",
        "transfer_role",
        "transfer_subtype",
        "merchant",
        "note",
        "category_l1",
        "category_l2",
        "source_ref",
        "hint",
        "flags",
        "matched_transaction_id",
        "counterpart_source_id",
        "counterparty",
        "transaction_id",
        "created_at",
        "updated_at",
    ],
    "exchange_rates": ["date", "base", "symbol", "rate", "fetched_at"],
}

# Final constraint names as they land in the database (§1, §5.0): the ck rule
# prefixes whatever name the model passes, so a full name here would show up as
# ck_transactions_ck_transactions_kind.
EXPECTED_CHECKS = {
    "users": {
        "ck_users_base_currency_upper",
        "ck_users_language",
        "ck_users_display_name_not_blank",
    },
    "ledgers": {"ck_ledgers_name_not_blank", "ck_ledgers_base_currency_upper"},
    "ledger_members": {"ck_ledger_members_role"},
    "ledger_invites": {"ck_ledger_invites_code_digits", "ck_ledger_invites_expiry"},
    "finance_sources": {
        "ck_finance_sources_type",
        "ck_finance_sources_currency_upper",
        "ck_finance_sources_name_not_blank",
        "ck_finance_sources_archived_at",
    },
    "transactions": {
        "ck_transactions_kind",
        "ck_transactions_amount_sign",
        "ck_transactions_transfer_role",
        "ck_transactions_transfer_subtype",
        "ck_transactions_category",
        "ck_transactions_refund_of",
        "ck_transactions_counterparty",
        "ck_transactions_transfer_role_values",
        "ck_transactions_transfer_subtype_values",
        "ck_transactions_category_l2_needs_l1",
        "ck_transactions_currency_upper",
        "ck_transactions_not_self_refund",
    },
    "transaction_events": {"ck_transaction_events_event"},
    "import_batches": {
        "ck_import_batches_source",
        "ck_import_batches_status",
        "ck_import_batches_filename",
        "ck_import_batches_size",
        "ck_import_batches_row_count",
        "ck_import_batches_committed_at",
    },
    "import_rows": {
        "ck_import_rows_status",
        "ck_import_rows_kind",
        "ck_import_rows_transfer_role",
        "ck_import_rows_transfer_subtype",
        "ck_import_rows_row_no",
    },
    "exchange_rates": {
        "ck_exchange_rates_rate_positive",
        "ck_exchange_rates_base_upper",
        "ck_exchange_rates_symbol_upper",
        "ck_exchange_rates_not_self",
    },
}

EXPECTED_INDEXES = {
    "users": {"ix_users_email"},
    "ledgers": {"ix_ledgers_created_by"},
    "ledger_members": {"ix_ledger_members_user_id"},
    "ledger_invites": {"ix_ledger_invites_ledger_id"},
    "finance_sources": {"ix_finance_sources_ledger_id"},
    "transactions": {
        "ix_transactions_ledger_occurred",
        "ix_transactions_ledger_source",
        "ix_transactions_ledger_kind_cat",
        "ix_transactions_refund_of",
        "ix_transactions_import_batch_id",
    },
    "transaction_events": {"ix_transaction_events_transaction_at"},
    "import_batches": {"ix_import_batches_ledger_created"},
    "import_rows": {"uq_import_rows_batch_row", "ix_import_rows_transaction_id"},
    "exchange_rates": {"ix_exchange_rates_pair_date"},
}

# §1: table -> {fk constraint name: ON DELETE action}
EXPECTED_FOREIGN_KEYS = {
    "users": {},
    "ledgers": {"fk_ledgers_created_by_users": None},
    "ledger_members": {
        "fk_ledger_members_ledger_id_ledgers": "CASCADE",
        "fk_ledger_members_user_id_users": "CASCADE",
    },
    "ledger_invites": {
        "fk_ledger_invites_ledger_id_ledgers": "CASCADE",
        "fk_ledger_invites_created_by_users": None,
    },
    "finance_sources": {
        "fk_finance_sources_ledger_id_ledgers": "CASCADE",
        "fk_finance_sources_created_by_users": None,
        "fk_finance_sources_updated_by_users": None,
    },
    "transactions": {
        "fk_transactions_ledger_id_ledgers": "CASCADE",
        "fk_transactions_source_id_finance_sources": None,
        "fk_transactions_refund_of_transactions": "SET NULL",
        "fk_transactions_import_batch_id_import_batches": "SET NULL",
        "fk_transactions_created_by_users": None,
        "fk_transactions_updated_by_users": None,
    },
    "transaction_events": {
        "fk_transaction_events_ledger_id_ledgers": "CASCADE",
        "fk_transaction_events_transaction_id_transactions": "CASCADE",
        "fk_transaction_events_actor_id_users": None,
        "fk_transaction_events_import_batch_id_import_batches": "SET NULL",
    },
    "import_batches": {
        "fk_import_batches_ledger_id_ledgers": "CASCADE",
        "fk_import_batches_source_id_finance_sources": None,
        "fk_import_batches_created_by_users": None,
    },
    "import_rows": {
        "fk_import_rows_batch_id_import_batches": "CASCADE",
        "fk_import_rows_matched_transaction_id_transactions": "SET NULL",
        "fk_import_rows_counterpart_source_id_finance_sources": "SET NULL",
        "fk_import_rows_transaction_id_transactions": "SET NULL",
    },
    "exchange_rates": {},
}


def test_create_all_builds_exactly_the_ten_tables(db):
    assert set(inspect(db.get_bind()).get_table_names()) == EXPECTED_TABLES
    assert set(Base.metadata.tables) == EXPECTED_TABLES


@pytest.mark.parametrize("table_name", sorted(EXPECTED_COLUMNS))
def test_columns_match_the_ddl(table_name):
    table = Base.metadata.tables[table_name]
    assert [c.name for c in table.columns] == EXPECTED_COLUMNS[table_name]


@pytest.mark.parametrize("table_name", sorted(EXPECTED_CHECKS))
def test_check_constraint_names_match_the_ddl(table_name):
    table = Base.metadata.tables[table_name]
    names = {c.name for c in table.constraints if isinstance(c, CheckConstraint)}
    assert names == EXPECTED_CHECKS[table_name]


@pytest.mark.parametrize("table_name", sorted(EXPECTED_INDEXES))
def test_index_names_match_the_ddl(table_name):
    table = Base.metadata.tables[table_name]
    assert {i.name for i in table.indexes} == EXPECTED_INDEXES[table_name]


@pytest.mark.parametrize("table_name", sorted(EXPECTED_FOREIGN_KEYS))
def test_foreign_key_names_and_ondelete_match_the_ddl(table_name):
    table = Base.metadata.tables[table_name]
    actual = {fk.name: fk.ondelete for fk in table.foreign_key_constraints}
    assert actual == EXPECTED_FOREIGN_KEYS[table_name]


def test_check_constraints_land_in_sqlite_under_the_documented_names(db):
    """The ck prefix is added by the convention, so nothing may be double-prefixed."""
    inspector = inspect(db.get_bind())
    for table_name, expected in EXPECTED_CHECKS.items():
        names = {c["name"] for c in inspector.get_check_constraints(table_name)}
        assert names == expected, table_name


def test_primary_key_names(db):
    for table_name, table in Base.metadata.tables.items():
        assert table.primary_key.name == f"pk_{table_name}"


def test_ledger_invites_code_has_no_unique_index_or_constraint(db):
    table = Base.metadata.tables["ledger_invites"]
    assert not [i for i in table.indexes if i.unique]
    assert not [c for c in table.constraints if isinstance(c, UniqueConstraint)]
    assert {i.name for i in table.indexes} == {"ix_ledger_invites_ledger_id"}

    inspector = inspect(db.get_bind())
    indexes = inspector.get_indexes("ledger_invites")
    assert [i["name"] for i in indexes] == ["ix_ledger_invites_ledger_id"]
    assert not any(i["unique"] for i in indexes)
    assert not inspector.get_unique_constraints("ledger_invites")


def test_transactions_has_the_transfer_pair_unique_constraint():
    table = Transaction.__table__
    uniques = {
        c.name: [col.name for col in c.columns]
        for c in table.constraints
        if isinstance(c, UniqueConstraint)
    }
    assert uniques == {"uq_transactions_transfer_pair_role": ["transfer_pair_id", "transfer_role"]}


def test_import_rows_batch_row_is_unique():
    table = Base.metadata.tables["import_rows"]
    unique = {i.name: i for i in table.indexes if i.unique}
    assert set(unique) == {"uq_import_rows_batch_row"}
    assert [c.name for c in unique["uq_import_rows_batch_row"].columns] == ["batch_id", "row_no"]


def test_exchange_rates_primary_key_is_date_base_symbol():
    table = Base.metadata.tables["exchange_rates"]
    assert [c.name for c in table.primary_key.columns] == ["date", "base", "symbol"]
    assert table.primary_key.name == "pk_exchange_rates"
    assert not table.foreign_key_constraints


def test_partial_indexes_are_declared_for_both_dialects():
    for index_name, table_name in (
        ("ix_transactions_refund_of", "transactions"),
        ("ix_transactions_import_batch_id", "transactions"),
        ("ix_import_rows_transaction_id", "import_rows"),
    ):
        index = next(i for i in Base.metadata.tables[table_name].indexes if i.name == index_name)
        assert index.dialect_options["postgresql"]["where"] is not None
        assert index.dialect_options["sqlite"]["where"] is not None


def test_amount_and_rate_precision():
    transactions = Base.metadata.tables["transactions"]
    assert (transactions.c.amount.type.precision, transactions.c.amount.type.scale) == (18, 4)
    rates = Base.metadata.tables["exchange_rates"]
    assert (rates.c.rate.type.precision, rates.c.rate.type.scale) == (18, 8)


def test_transfer_pair_id_has_no_foreign_key():
    assert not Transaction.__table__.c.transfer_pair_id.foreign_keys


def test_json_columns_compile_to_jsonb_on_postgres_and_json_on_sqlite():
    from sqlalchemy.dialects import postgresql, sqlite

    for table_name, column_name in (
        ("import_rows", "flags"),
        ("import_batches", "warnings"),
        ("transaction_events", "changes"),
    ):
        column_type = Base.metadata.tables[table_name].c[column_name].type
        assert column_type.compile(postgresql.dialect()) == "JSONB"
        assert column_type.compile(sqlite.dialect()) == "JSON"


def test_index_objects_are_reachable_from_metadata():
    """Every documented index must be attached to a table, not just declared."""
    declared = {i.name for t in Base.metadata.tables.values() for i in t.indexes}
    expected = set().union(*EXPECTED_INDEXES.values())
    assert declared == expected
    assert all(isinstance(i, Index) for t in Base.metadata.tables.values() for i in t.indexes)


def test_alembic_config_targets_the_given_url(tmp_path):
    """The helper must migrate the URL it is handed, not settings.DATABASE_URL.

    migrations/env.py falls back to settings only when an alembic.ini is in
    play, so a programmatic Config() keeps the URL the caller set.
    """
    from alembic import command

    from tests.conftest import alembic_config

    url = f"sqlite:///{tmp_path}/probe.db"
    cfg = alembic_config(url)
    command.stamp(cfg, "head")

    assert (tmp_path / "probe.db").exists()
    assert cfg.get_main_option("sqlalchemy.url") == url
