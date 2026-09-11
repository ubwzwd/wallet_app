"""scope sources and transactions to ledger

Revision ID: b1f3c2a10d43
Revises: b1f3c2a10d42
Create Date: 2026-09-12 00:00:00.000000

Step 3 of the v3.0 chain (02-database.md §5.3): finance_sources and
transactions move from "owned by a user" to "owned by a ledger". New columns
are added nullable, backfilled from the default ledgers of step 2, then
tightened; finance_sources.type collapses to four values (decision §14.48) and
archived_at is filled in for archived rows (decision §14.50).
"""
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1f3c2a10d43"
down_revision: Union[str, Sequence[str], None] = "b1f3c2a10d42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def delete_and_warn(table: str, where: str, why: str) -> None:
    """Delete rows, but count and log them first (§5.0) — never silently."""
    bind = op.get_bind()
    n = bind.execute(sa.text(f"SELECT count(*) FROM {table} WHERE {where}")).scalar_one()
    if n:
        logging.getLogger("alembic.runtime.migration").warning(
            "backfill: deleting %d rows from %s (%s)", n, table, why
        )
    bind.execute(sa.text(f"DELETE FROM {table} WHERE {where}"))


def upgrade() -> None:
    """Attach both tables to a ledger and drop their user_id."""
    # --- finance_sources ---
    with op.batch_alter_table("finance_sources") as b:
        b.add_column(sa.Column("ledger_id", sa.Uuid(), nullable=True))
        b.add_column(
            sa.Column(
                "opening_balance", sa.Numeric(18, 4), nullable=False, server_default=sa.text("0")
            )
        )
        b.add_column(sa.Column("archived_at", sa.DateTime(), nullable=True))  # decision §14.50
        b.add_column(sa.Column("created_by", sa.Uuid(), nullable=True))
        b.add_column(sa.Column("updated_by", sa.Uuid(), nullable=True))
        b.add_column(sa.Column("updated_at", sa.DateTime(), nullable=True))

    # Correlated subqueries throughout: UPDATE ... FROM is Postgres-only.
    op.execute(
        """
        UPDATE finance_sources
           SET ledger_id = (SELECT l.id FROM ledgers l
                             WHERE l.created_by = finance_sources.user_id
                             ORDER BY l.created_at LIMIT 1)
        """
    )
    op.execute(
        "UPDATE finance_sources SET created_by = user_id, updated_by = user_id "
        "WHERE created_by IS NULL"
    )
    op.execute("UPDATE finance_sources SET updated_at = created_at WHERE updated_at IS NULL")
    # Before ck_finance_sources_currency_upper.
    op.execute("UPDATE finance_sources SET default_currency = upper(default_currency)")
    # Account types collapse to four (decision §14.48). Written as NOT IN rather
    # than naming the old values: the column never had a CHECK, so whatever was
    # written into it cannot be enumerated.
    op.execute(
        "UPDATE finance_sources SET type = 'checking' "
        "WHERE type IS NULL OR type NOT IN ('checking', 'credit', 'cash', 'other')"
    )
    # Archival time (decision §14.50): existing archived rows have no such
    # information, so updated_at (just backfilled) stands in — otherwise
    # ck_finance_sources_archived_at would reject "archived but no archived_at".
    op.execute(
        "UPDATE finance_sources SET archived_at = updated_at "
        "WHERE archived = TRUE AND archived_at IS NULL"
    )
    op.execute("UPDATE finance_sources SET archived_at = NULL WHERE archived = FALSE")
    # Symmetric with the transactions case below: a local SQLite dev database
    # runs without PRAGMA foreign_keys, so it may hold rows whose user_id points
    # at a deleted user; those get no ledger_id and would break the NOT NULL
    # below. On Postgres this is always 0 rows (users.id is a foreign key).
    delete_and_warn("finance_sources", "ledger_id IS NULL", "no resolvable ledger_id")

    # The index on user_id must go before the batch block: batch rebuilds the
    # table from the reflected index list, and drop_column does not remove the
    # index from that list, so the rebuild would run
    # CREATE INDEX ... (user_id) against a table that no longer has the column.
    # Two names because Alembic-built and create_all-built databases diverge.
    for _idx in ("ix_accounts_user_id", "ix_finance_sources_user_id"):
        op.execute(sa.text(f"DROP INDEX IF EXISTS {_idx}"))

    with op.batch_alter_table("finance_sources") as b:
        b.alter_column("ledger_id", nullable=False)
        b.alter_column("created_by", nullable=False)
        b.alter_column("updated_by", nullable=False)
        b.alter_column("updated_at", nullable=False)
        b.alter_column("default_currency", type_=sa.CHAR(3), existing_type=sa.String(3))
        b.create_foreign_key(
            "fk_finance_sources_ledger_id_ledgers",
            "ledgers",
            ["ledger_id"],
            ["id"],
            ondelete="CASCADE",
        )
        b.create_foreign_key(
            "fk_finance_sources_created_by_users", "users", ["created_by"], ["id"]
        )
        b.create_foreign_key(
            "fk_finance_sources_updated_by_users", "users", ["updated_by"], ["id"]
        )
        # CHECK names are suffixes only; the convention prepends
        # ck_finance_sources_ (§5.0).
        b.create_check_constraint("type", "type IN ('checking', 'credit', 'cash', 'other')")
        b.create_check_constraint(
            "currency_upper", "default_currency = upper(default_currency)"
        )
        b.create_check_constraint("name_not_blank", "length(trim(name)) > 0")
        b.create_check_constraint("archived_at", "archived = (archived_at IS NOT NULL)")
        b.drop_column("user_id")
    op.create_index("ix_finance_sources_ledger_id", "finance_sources", ["ledger_id"])

    # --- transactions ---
    with op.batch_alter_table("transactions") as b:
        b.add_column(sa.Column("ledger_id", sa.Uuid(), nullable=True))
        b.add_column(sa.Column("created_by", sa.Uuid(), nullable=True))
        b.add_column(sa.Column("updated_by", sa.Uuid(), nullable=True))
        b.add_column(sa.Column("updated_at", sa.DateTime(), nullable=True))

    op.execute(
        """
        UPDATE transactions
           SET ledger_id = (SELECT fs.ledger_id FROM finance_sources fs
                             WHERE fs.id = transactions.source_id)
        """
    )
    op.execute(
        "UPDATE transactions SET created_by = user_id, updated_by = user_id "
        "WHERE created_by IS NULL"
    )
    op.execute("UPDATE transactions SET updated_at = created_at WHERE updated_at IS NULL")
    # Only orphan rows of a dev SQLite database can match; 0 rows on Postgres.
    delete_and_warn("transactions", "ledger_id IS NULL", "no resolvable ledger_id")

    # Same reason as above: transactions.user_id carries an index in both the
    # Alembic chain and the model, and it must go before the batch block.
    for _idx in ("ix_transactions_user_id",):
        op.execute(sa.text(f"DROP INDEX IF EXISTS {_idx}"))

    with op.batch_alter_table("transactions") as b:
        b.alter_column("ledger_id", nullable=False)
        b.alter_column("created_by", nullable=False)
        b.alter_column("updated_by", nullable=False)
        b.alter_column("updated_at", nullable=False)
        b.alter_column("currency", type_=sa.CHAR(3), existing_type=sa.String(3))
        b.create_foreign_key(
            "fk_transactions_ledger_id_ledgers",
            "ledgers",
            ["ledger_id"],
            ["id"],
            ondelete="CASCADE",
        )
        b.create_foreign_key("fk_transactions_created_by_users", "users", ["created_by"], ["id"])
        b.create_foreign_key("fk_transactions_updated_by_users", "users", ["updated_by"], ["id"])
        b.drop_column("user_id")
    # Same name from both sources, so a plain drop_index is safe.
    op.drop_index("ix_transactions_occurred_at", table_name="transactions")
    # This one is not: the initial migration named it ix_transactions_account_id
    # and 026ee0aecb66 renamed only the column, while create_all builds
    # ix_transactions_source_id. Try both names.
    for _idx in ("ix_transactions_account_id", "ix_transactions_source_id"):
        op.execute(sa.text(f"DROP INDEX IF EXISTS {_idx}"))
    op.create_index(
        "ix_transactions_ledger_occurred",
        "transactions",
        ["ledger_id", sa.text("occurred_at DESC"), sa.text("created_at DESC")],
    )
    op.create_index("ix_transactions_ledger_source", "transactions", ["ledger_id", "source_id"])


def downgrade() -> None:
    """Development only (§5.7); lossy: rows deleted above cannot come back.

    user_id comes back from created_by and the old indexes are recreated under
    the names the Alembic chain built them with.
    """
    # --- transactions ---
    op.drop_index("ix_transactions_ledger_source", table_name="transactions")
    op.drop_index("ix_transactions_ledger_occurred", table_name="transactions")

    with op.batch_alter_table("transactions") as b:
        b.add_column(sa.Column("user_id", sa.Uuid(), nullable=True))
    op.execute("UPDATE transactions SET user_id = created_by WHERE user_id IS NULL")

    with op.batch_alter_table("transactions") as b:
        b.alter_column("user_id", nullable=False)
        b.alter_column("currency", type_=sa.String(3), existing_type=sa.CHAR(3))
        b.create_foreign_key("fk_transactions_user_id_users", "users", ["user_id"], ["id"])
        # Dropping a column drops the foreign keys that hang off it, on both
        # Postgres and the SQLite batch rebuild, so they need no explicit drop.
        b.drop_column("ledger_id")
        b.drop_column("created_by")
        b.drop_column("updated_by")
        b.drop_column("updated_at")
    op.create_index("ix_transactions_user_id", "transactions", ["user_id"])
    op.create_index("ix_transactions_occurred_at", "transactions", ["occurred_at"])
    op.create_index("ix_transactions_account_id", "transactions", ["source_id"])

    # --- finance_sources ---
    op.drop_index("ix_finance_sources_ledger_id", table_name="finance_sources")

    with op.batch_alter_table("finance_sources") as b:
        b.add_column(sa.Column("user_id", sa.Uuid(), nullable=True))
    op.execute("UPDATE finance_sources SET user_id = created_by WHERE user_id IS NULL")

    with op.batch_alter_table("finance_sources") as b:
        # CHECKs are dropped by suffix, not by the full name §5.0 suggests:
        # Alembic rebuilds the constraint object through the naming convention
        # on the way out too, so a full name would look for
        # ck_finance_sources_ck_finance_sources_type.
        b.drop_constraint("type", type_="check")
        b.drop_constraint("currency_upper", type_="check")
        b.drop_constraint("name_not_blank", type_="check")
        b.drop_constraint("archived_at", type_="check")
        b.alter_column("user_id", nullable=False)
        b.alter_column("default_currency", type_=sa.String(3), existing_type=sa.CHAR(3))
        b.create_foreign_key("fk_finance_sources_user_id_users", "users", ["user_id"], ["id"])
        b.drop_column("ledger_id")
        b.drop_column("opening_balance")
        b.drop_column("archived_at")
        b.drop_column("created_by")
        b.drop_column("updated_by")
        b.drop_column("updated_at")
    op.create_index("ix_accounts_user_id", "finance_sources", ["user_id"])
