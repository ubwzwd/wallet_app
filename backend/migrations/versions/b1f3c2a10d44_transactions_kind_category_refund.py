"""transactions kind, category and refund

Revision ID: b1f3c2a10d44
Revises: b1f3c2a10d43
Create Date: 2026-09-12 00:00:00.000000

Step 4 of the v3.0 chain (02-database.md §5.4): transactions gain kind, the
transfer columns, the category pair, refund_of and import_batch_id, plus the
twelve CHECKs and the transfer-pair UNIQUE of §1.6. description becomes note
(decision §1.4). Three cleanup statements make the constraints attachable on a
populated database; they are no-ops on an empty one.
"""
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1f3c2a10d44"
down_revision: Union[str, Sequence[str], None] = "b1f3c2a10d43"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The twelve CHECKs of §1.6, expression for expression. Names are suffixes
# only: the naming convention prepends ck_transactions_ (§5.0). The eighth
# constraint of §1.6.1 is the UNIQUE below, not a CHECK.
TRANSACTION_CHECKS: list[tuple[str, str]] = [
    ("kind", "kind IN ('expense', 'income', 'refund', 'transfer')"),
    (
        "amount_sign",
        "(kind = 'expense'  AND amount < 0) OR "
        "(kind = 'income'   AND amount > 0) OR "
        "(kind = 'refund'   AND amount > 0) OR "
        "(kind = 'transfer' AND transfer_role = 'out' AND amount < 0) OR "
        "(kind = 'transfer' AND transfer_role = 'in'  AND amount > 0)",
    ),
    ("transfer_role", "(kind = 'transfer') = (transfer_role IS NOT NULL)"),
    ("transfer_subtype", "(kind = 'transfer') = (transfer_subtype IS NOT NULL)"),
    (
        "category",
        "(kind = 'transfer' AND category_l1 IS NULL AND category_l2 IS NULL) OR "
        "(kind <> 'transfer' AND category_l1 IS NOT NULL)",
    ),
    ("refund_of", "refund_of IS NULL OR kind = 'refund'"),
    ("counterparty", "transfer_pair_id IS NULL OR counterparty IS NULL"),
    ("transfer_role_values", "transfer_role IS NULL OR transfer_role IN ('out', 'in')"),
    (
        "transfer_subtype_values",
        "transfer_subtype IS NULL OR transfer_subtype IN ('plain', 'repayment')",
    ),
    ("category_l2_needs_l1", "category_l2 IS NULL OR category_l1 IS NOT NULL"),
    ("currency_upper", "currency = upper(currency)"),
    ("not_self_refund", "refund_of IS NULL OR refund_of <> id"),
]


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
    """Add the direction / category / refund / import columns and lock them down."""
    with op.batch_alter_table("transactions") as b:
        # decision §1.4: description -> note, capped at 500 characters
        b.alter_column(
            "description",
            new_column_name="note",
            existing_type=sa.String(),
            type_=sa.String(500),
        )
        b.alter_column("merchant", existing_type=sa.String(), type_=sa.String(200))
        b.add_column(sa.Column("kind", sa.String(16), nullable=True))
        b.add_column(sa.Column("transfer_role", sa.String(8), nullable=True))
        b.add_column(sa.Column("transfer_subtype", sa.String(16), nullable=True))
        b.add_column(sa.Column("counterparty", sa.String(100), nullable=True))
        b.add_column(sa.Column("refund_of", sa.Uuid(), nullable=True))
        b.add_column(sa.Column("category_l1", sa.String(32), nullable=True))
        b.add_column(sa.Column("category_l2", sa.String(32), nullable=True))
        b.add_column(sa.Column("import_batch_id", sa.Uuid(), nullable=True))

    # --- backfill (decision §13 step 4) --------------------------------------
    # Order matters: normalise the currency case, drop the zero-amount rows,
    # scatter the conflicting pairs, only then assign kind — every CHECK below
    # is added last, when the data already satisfies it.

    # (0) before ck_transactions_currency_upper
    op.execute("UPDATE transactions SET currency = upper(currency)")

    # (a) amount = 0 cannot satisfy the new sign constraint. The column never
    #     had a sign or non-zero CHECK, so such rows can only be test data
    #     (§5.4, 待决 D-9). Counted and logged before deletion (§5.0).
    delete_and_warn("transactions", "amount = 0", "zero amount")

    # (b) two legs of one pair with the same sign would collide on
    #     uq_transactions_transfer_pair_role; break them into single legs.
    op.execute(
        """
        UPDATE transactions SET transfer_pair_id = NULL
         WHERE transfer_pair_id IN (
               SELECT transfer_pair_id FROM transactions
                WHERE transfer_pair_id IS NOT NULL
                GROUP BY transfer_pair_id
               HAVING COUNT(DISTINCT CASE WHEN amount < 0 THEN 'out' ELSE 'in' END) < COUNT(*)
         )
        """
    )

    # (c) kind is the single source of direction (decision §1)
    op.execute(
        """
        UPDATE transactions
           SET kind = CASE WHEN transfer_pair_id IS NOT NULL THEN 'transfer'
                           WHEN amount < 0 THEN 'expense'
                           ELSE 'income' END
        """
    )
    # (d) transfer role and subtype
    op.execute(
        "UPDATE transactions SET transfer_role = "
        "CASE WHEN amount < 0 THEN 'out' ELSE 'in' END WHERE kind = 'transfer'"
    )
    op.execute("UPDATE transactions SET transfer_subtype = 'plain' WHERE kind = 'transfer'")
    # (e) categories: the catch-all codes of decision §1.3
    op.execute("UPDATE transactions SET category_l1 = 'other'        WHERE kind = 'expense'")
    op.execute("UPDATE transactions SET category_l1 = 'other_income' WHERE kind = 'income'")

    with op.batch_alter_table("transactions") as b:
        b.alter_column("kind", existing_type=sa.String(16), nullable=False)
        b.create_foreign_key(
            "fk_transactions_refund_of_transactions",
            "transactions",
            ["refund_of"],
            ["id"],
            ondelete="SET NULL",
        )
        b.create_foreign_key(
            "fk_transactions_import_batch_id_import_batches",
            "import_batches",
            ["import_batch_id"],
            ["id"],
            ondelete="SET NULL",
        )
        b.create_unique_constraint(
            "uq_transactions_transfer_pair_role", ["transfer_pair_id", "transfer_role"]
        )
        for _suffix, _expr in TRANSACTION_CHECKS:
            b.create_check_constraint(_suffix, _expr)

    # Superseded by the index behind uq_transactions_transfer_pair_role. Two
    # names: the Alembic chain built idx_transactions_transfer_pair
    # (8a4f4d66d893), create_all built the ORM name (§5.3 naming fork).
    for _idx in ("idx_transactions_transfer_pair", "ix_transactions_transfer_pair_id"):
        op.execute(sa.text(f"DROP INDEX IF EXISTS {_idx}"))

    op.create_index(
        "ix_transactions_ledger_kind_cat", "transactions", ["ledger_id", "kind", "category_l1"]
    )
    op.create_index(
        "ix_transactions_refund_of",
        "transactions",
        ["refund_of"],
        postgresql_where=sa.text("refund_of IS NOT NULL"),
        sqlite_where=sa.text("refund_of IS NOT NULL"),
    )
    op.create_index(
        "ix_transactions_import_batch_id",
        "transactions",
        ["import_batch_id"],
        postgresql_where=sa.text("import_batch_id IS NOT NULL"),
        sqlite_where=sa.text("import_batch_id IS NOT NULL"),
    )


def downgrade() -> None:
    """Development only (§5.7); lossy: deleted and scattered rows stay gone."""
    op.drop_index("ix_transactions_import_batch_id", table_name="transactions")
    op.drop_index("ix_transactions_refund_of", table_name="transactions")
    op.drop_index("ix_transactions_ledger_kind_cat", table_name="transactions")

    with op.batch_alter_table("transactions") as b:
        # CHECKs are dropped by suffix, not by the full name: Alembic rebuilds
        # the constraint object through the naming convention on the way out
        # too, so a full name would look for ck_transactions_ck_transactions_*.
        for _suffix, _expr in TRANSACTION_CHECKS:
            b.drop_constraint(_suffix, type_="check")
        b.drop_constraint("uq_transactions_transfer_pair_role", type_="unique")
        # Dropping a column drops the foreign keys hanging off it, on Postgres
        # and on the SQLite batch rebuild alike, so the two new keys need no
        # explicit drop.
        b.drop_column("kind")
        b.drop_column("transfer_role")
        b.drop_column("transfer_subtype")
        b.drop_column("counterparty")
        b.drop_column("refund_of")
        b.drop_column("category_l1")
        b.drop_column("category_l2")
        b.drop_column("import_batch_id")
        b.alter_column("merchant", existing_type=sa.String(200), type_=sa.String())
        b.alter_column(
            "note",
            new_column_name="description",
            existing_type=sa.String(500),
            type_=sa.String(),
        )

    op.create_index("idx_transactions_transfer_pair", "transactions", ["transfer_pair_id"])
