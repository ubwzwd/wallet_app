"""create ledger, import and event tables

Revision ID: b1f3c2a10d41
Revises: 8a4f4d66d893
Create Date: 2026-09-12 00:00:00.000000

Step 1 of the v3.0 chain (02-database.md §5.1): create the seven new tables
(ledgers / ledger_members / ledger_invites / import_batches / import_rows /
transaction_events / exchange_rates) and their indexes (§4). Pure DDL, so it
runs on an empty database as well as on a populated one.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b1f3c2a10d41"
down_revision: Union[str, Sequence[str], None] = "8a4f4d66d893"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# JSON columns: JSONB on Postgres, plain JSON elsewhere (§1.11).
_JSON = sa.JSON().with_variant(postgresql.JSONB, "postgresql")

# 6 digits without a regex: strip every digit, the rest must be empty (§1.4).
_CODE_DIGITS = (
    "length(code) = 6 AND replace(replace(replace(replace(replace("
    "replace(replace(replace(replace(replace(code, "
    "'0',''),'1',''),'2',''),'3',''),'4',''), "
    "'5',''),'6',''),'7',''),'8',''),'9','') = ''"
)


def upgrade() -> None:
    """Create the seven new tables in dependency order."""
    # CHECK constraints carry the suffix only; the naming convention prepends
    # ck_<table>_ (02-database.md §5.0). fk / uq / ix / pk take the full name.
    op.create_table(
        "ledgers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("base_currency", sa.CHAR(3), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_ledgers"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="fk_ledgers_created_by_users"),
        sa.CheckConstraint("length(trim(name)) > 0", name="name_not_blank"),
        sa.CheckConstraint("base_currency = upper(base_currency)", name="base_currency_upper"),
    )
    op.create_index("ix_ledgers_created_by", "ledgers", ["created_by"])

    op.create_table(
        "ledger_members",
        sa.Column("ledger_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(16), nullable=False, server_default="member"),
        sa.Column("joined_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("ledger_id", "user_id", name="pk_ledger_members"),
        sa.ForeignKeyConstraint(
            ["ledger_id"],
            ["ledgers.id"],
            ondelete="CASCADE",
            name="fk_ledger_members_ledger_id_ledgers",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE", name="fk_ledger_members_user_id_users"
        ),
        sa.CheckConstraint("role IN ('owner', 'member')", name="role"),
    )
    op.create_index("ix_ledger_members_user_id", "ledger_members", ["user_id"])

    # Only currently valid codes live here, so `code` gets no unique index
    # (decision §14.29).
    op.create_table(
        "ledger_invites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ledger_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.CHAR(6), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_ledger_invites"),
        sa.ForeignKeyConstraint(
            ["ledger_id"],
            ["ledgers.id"],
            ondelete="CASCADE",
            name="fk_ledger_invites_ledger_id_ledgers",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name="fk_ledger_invites_created_by_users"
        ),
        sa.CheckConstraint(_CODE_DIGITS, name="code_digits"),
        sa.CheckConstraint("expires_at > created_at", name="expiry"),
    )
    op.create_index("ix_ledger_invites_ledger_id", "ledger_invites", ["ledger_id"])

    # import_batches.source_id points at finance_sources, which already exists.
    op.create_table(
        "import_batches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ledger_id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(8), nullable=False),
        sa.Column("filename", sa.String(255), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("skill_version", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="ready"),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("warnings", _JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("committed_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_import_batches"),
        sa.ForeignKeyConstraint(
            ["ledger_id"],
            ["ledgers.id"],
            ondelete="CASCADE",
            name="fk_import_batches_ledger_id_ledgers",
        ),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["finance_sources.id"],
            name="fk_import_batches_source_id_finance_sources",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name="fk_import_batches_created_by_users"
        ),
        sa.CheckConstraint("source IN ('csv', 'paste')", name="source"),
        sa.CheckConstraint("status IN ('ready', 'committed')", name="status"),
        sa.CheckConstraint("(source = 'csv') = (filename IS NOT NULL)", name="filename"),
        sa.CheckConstraint("size_bytes > 0 AND size_bytes <= 2097152", name="size"),
        sa.CheckConstraint("row_count >= 0 AND row_count <= 2000", name="row_count"),
        sa.CheckConstraint(
            "(status = 'committed') = (committed_at IS NOT NULL)", name="committed_at"
        ),
    )
    op.create_index(
        "ix_import_batches_ledger_created",
        "import_batches",
        ["ledger_id", sa.text("created_at DESC")],
    )

    # Draft rows: every business column stays nullable so invalid rows survive.
    op.create_table(
        "import_rows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("row_no", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("occurred_at", sa.Date(), nullable=True),
        sa.Column("amount", sa.Numeric(18, 4), nullable=True),
        sa.Column("currency", sa.CHAR(3), nullable=True),
        sa.Column("kind", sa.String(16), nullable=True),
        sa.Column("transfer_role", sa.String(8), nullable=True),
        sa.Column("transfer_subtype", sa.String(16), nullable=True),
        sa.Column("merchant", sa.String(200), nullable=True),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("category_l1", sa.String(32), nullable=True),
        sa.Column("category_l2", sa.String(32), nullable=True),
        sa.Column("source_ref", sa.String(200), nullable=True),
        sa.Column("hint", sa.String(500), nullable=True),
        sa.Column("flags", _JSON, nullable=True),
        sa.Column("matched_transaction_id", sa.Uuid(), nullable=True),
        sa.Column("counterpart_source_id", sa.Uuid(), nullable=True),
        sa.Column("counterparty", sa.String(100), nullable=True),
        sa.Column("transaction_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_import_rows"),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["import_batches.id"],
            ondelete="CASCADE",
            name="fk_import_rows_batch_id_import_batches",
        ),
        sa.ForeignKeyConstraint(
            ["matched_transaction_id"],
            ["transactions.id"],
            ondelete="SET NULL",
            name="fk_import_rows_matched_transaction_id_transactions",
        ),
        sa.ForeignKeyConstraint(
            ["counterpart_source_id"],
            ["finance_sources.id"],
            ondelete="SET NULL",
            name="fk_import_rows_counterpart_source_id_finance_sources",
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["transactions.id"],
            ondelete="SET NULL",
            name="fk_import_rows_transaction_id_transactions",
        ),
        sa.CheckConstraint("status IN ('pending', 'edited', 'skipped')", name="status"),
        sa.CheckConstraint(
            "kind IS NULL OR kind IN ('expense', 'income', 'refund', 'transfer')", name="kind"
        ),
        sa.CheckConstraint(
            "transfer_role IS NULL OR transfer_role IN ('out', 'in')", name="transfer_role"
        ),
        sa.CheckConstraint(
            "transfer_subtype IS NULL OR transfer_subtype IN ('plain', 'repayment')",
            name="transfer_subtype",
        ),
        sa.CheckConstraint("row_no >= 1", name="row_no"),
    )
    op.create_index("uq_import_rows_batch_row", "import_rows", ["batch_id", "row_no"], unique=True)
    op.create_index(
        "ix_import_rows_transaction_id",
        "import_rows",
        ["transaction_id"],
        postgresql_where=sa.text("transaction_id IS NOT NULL"),
        sqlite_where=sa.text("transaction_id IS NOT NULL"),
    )

    # Transaction audit trail (decision §14.51), append-only; the two CASCADEs
    # let it disappear together with its transaction / ledger.
    op.create_table(
        "transaction_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ledger_id", sa.Uuid(), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("at", sa.DateTime(), nullable=False),
        sa.Column("event", sa.String(24), nullable=False),
        sa.Column("changes", _JSON, nullable=True),
        sa.Column("import_batch_id", sa.Uuid(), nullable=True),
        sa.Column("client", sa.String(16), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_transaction_events"),
        sa.ForeignKeyConstraint(
            ["ledger_id"],
            ["ledgers.id"],
            ondelete="CASCADE",
            name="fk_transaction_events_ledger_id_ledgers",
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["transactions.id"],
            ondelete="CASCADE",
            name="fk_transaction_events_transaction_id_transactions",
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"], ["users.id"], name="fk_transaction_events_actor_id_users"
        ),
        sa.ForeignKeyConstraint(
            ["import_batch_id"],
            ["import_batches.id"],
            ondelete="SET NULL",
            name="fk_transaction_events_import_batch_id_import_batches",
        ),
        sa.CheckConstraint(
            "event IN ('created', 'updated', 'imported', 'paired', 'unpaired', "
            "'refund_linked', 'refund_unlinked')",
            name="event",
        ),
    )
    op.create_index(
        "ix_transaction_events_transaction_at",
        "transaction_events",
        ["transaction_id", sa.text("at DESC")],
    )

    # Rate cache (decision §14.1). The old table of the same name was dropped by
    # 5ca7fe6e37db; this one is new, with a new shape (§1.10).
    op.create_table(
        "exchange_rates",
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("base", sa.CHAR(3), nullable=False),
        sa.Column("symbol", sa.CHAR(3), nullable=False),
        sa.Column("rate", sa.Numeric(18, 8), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("date", "base", "symbol", name="pk_exchange_rates"),
        sa.CheckConstraint("rate > 0", name="rate_positive"),
        sa.CheckConstraint("base = upper(base)", name="base_upper"),
        sa.CheckConstraint("symbol = upper(symbol)", name="symbol_upper"),
        sa.CheckConstraint("base <> symbol", name="not_self"),
        comment="Frankfurter daily rate cache; see 00-decisions.md 14.1",
    )
    op.create_index(
        "ix_exchange_rates_pair_date",
        "exchange_rates",
        ["base", "symbol", sa.text("date DESC")],
    )


def downgrade() -> None:
    """Drop the seven tables in reverse order; indexes go with them (§5.7)."""
    op.drop_table("exchange_rates")
    op.drop_table("transaction_events")
    op.drop_table("import_rows")
    op.drop_table("import_batches")
    op.drop_table("ledger_invites")
    op.drop_table("ledger_members")
    op.drop_table("ledgers")
