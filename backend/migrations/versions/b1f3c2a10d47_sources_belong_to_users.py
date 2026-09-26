"""sources belong to users

Revision ID: b1f3c2a10d47
Revises: b1f3c2a10d46
Create Date: 2026-09-27 00:00:00.000000

Phase 8 (decision §14.62): an account stops belonging to a ledger and starts
belonging to a person, who shares it into the ledgers they choose.

Upgrade, in five steps:

1. create ``ledger_sources`` — one row per (ledger, account) share;
2. share every account into the ledger it used to live in, so every member who
   could use it before still can (behaviour is unchanged by the migration);
3. add ``finance_sources.owner_id``, backfilled from ``created_by``;
4. drop ``finance_sources.ledger_id`` with its index and foreign key;
5. index ``transactions (source_id, occurred_at)`` for the cross-ledger balance.

The downgrade puts every account back into one ledger: the earliest share, or
failing that the owner's earliest ledger. Development only (§5.7).
"""
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1f3c2a10d47"
down_revision: Union[str, Sequence[str], None] = "b1f3c2a10d46"
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
    """Move finance_sources from "owned by a ledger" to "owned by a user"."""
    bind = op.get_bind()

    # 1. the share table
    op.create_table(
        "ledger_sources",
        sa.Column("ledger_id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("shared_by", sa.Uuid(), nullable=False),
        sa.Column("shared_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["ledger_id"],
            ["ledgers.id"],
            name="fk_ledger_sources_ledger_id_ledgers",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["finance_sources.id"],
            name="fk_ledger_sources_source_id_finance_sources",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["shared_by"], ["users.id"], name="fk_ledger_sources_shared_by_users"
        ),
        sa.PrimaryKeyConstraint("ledger_id", "source_id", name="pk_ledger_sources"),
    )
    op.create_index("ix_ledger_sources_source_id", "ledger_sources", ["source_id"])

    # 2. every account was usable by everyone in its ledger; a share row per
    # account keeps exactly that after the move.
    bind.execute(
        sa.text(
            "INSERT INTO ledger_sources (ledger_id, source_id, shared_by, shared_at) "
            "SELECT ledger_id, id, created_by, created_at FROM finance_sources"
        )
    )

    # 3. the owner is whoever created the account
    with op.batch_alter_table("finance_sources") as b:
        b.add_column(sa.Column("owner_id", sa.Uuid(), nullable=True))
    bind.execute(sa.text("UPDATE finance_sources SET owner_id = created_by"))

    # 4. ledger_id goes. Its index must be dropped before the batch block: the
    # SQLite rebuild recreates every reflected index, and one on a dropped
    # column would fail (same reason as in b1f3c2a10d43).
    op.drop_index("ix_finance_sources_ledger_id", table_name="finance_sources")
    with op.batch_alter_table("finance_sources") as b:
        b.alter_column("owner_id", existing_type=sa.Uuid(), nullable=False)
        b.create_foreign_key("fk_finance_sources_owner_id_users", "users", ["owner_id"], ["id"])
        b.drop_constraint("fk_finance_sources_ledger_id_ledgers", type_="foreignkey")
        b.drop_column("ledger_id")
    op.create_index("ix_finance_sources_owner_id", "finance_sources", ["owner_id"])

    # 5. balances now read an account's entries across every ledger (§14.62 f):
    # the query filters on source_id alone, which ix_transactions_ledger_source
    # (ledger_id first) cannot serve (02 §4).
    op.create_index(
        "ix_transactions_source_occurred", "transactions", ["source_id", "occurred_at"]
    )


def downgrade() -> None:
    """Development only (§5.7); lossy: every account keeps a single ledger.

    ledger_id comes back from the earliest share of the account; an account
    that is shared nowhere goes to the earliest ledger its owner belongs to,
    then to any ledger whose transactions or import batches use it. Whatever
    still has no ledger after that cannot be placed and is deleted (logged).
    Other shares than the chosen one are lost with the table.
    """
    bind = op.get_bind()

    op.drop_index("ix_transactions_source_occurred", table_name="transactions")

    with op.batch_alter_table("finance_sources") as b:
        b.add_column(sa.Column("ledger_id", sa.Uuid(), nullable=True))

    # Correlated subqueries throughout: UPDATE ... FROM is Postgres-only.
    bind.execute(
        sa.text(
            """
            UPDATE finance_sources
               SET ledger_id = (SELECT ls.ledger_id FROM ledger_sources ls
                                 WHERE ls.source_id = finance_sources.id
                                 ORDER BY ls.shared_at, ls.ledger_id LIMIT 1)
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE finance_sources
               SET ledger_id = (SELECT l.id FROM ledgers l
                                  JOIN ledger_members m ON m.ledger_id = l.id
                                 WHERE m.user_id = finance_sources.owner_id
                                 ORDER BY l.created_at, l.id LIMIT 1)
             WHERE ledger_id IS NULL
            """
        )
    )
    for table in ("transactions", "import_batches"):
        bind.execute(
            sa.text(
                f"""
                UPDATE finance_sources
                   SET ledger_id = (SELECT t.ledger_id FROM {table} t
                                     WHERE t.source_id = finance_sources.id
                                     ORDER BY t.created_at LIMIT 1)
                 WHERE ledger_id IS NULL
                """
            )
        )
    delete_and_warn("finance_sources", "ledger_id IS NULL", "no ledger to go back to")

    op.drop_index("ix_finance_sources_owner_id", table_name="finance_sources")
    with op.batch_alter_table("finance_sources") as b:
        b.alter_column("ledger_id", existing_type=sa.Uuid(), nullable=False)
        b.create_foreign_key(
            "fk_finance_sources_ledger_id_ledgers",
            "ledgers",
            ["ledger_id"],
            ["id"],
            ondelete="CASCADE",
        )
        b.drop_constraint("fk_finance_sources_owner_id_users", type_="foreignkey")
        b.drop_column("owner_id")
    op.create_index("ix_finance_sources_ledger_id", "finance_sources", ["ledger_id"])

    op.drop_index("ix_ledger_sources_source_id", table_name="ledger_sources")
    op.drop_table("ledger_sources")
