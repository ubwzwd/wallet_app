"""users base currency as ledger default

Revision ID: b1f3c2a10d46
Revises: b1f3c2a10d45
Create Date: 2026-09-12 00:00:00.000000

Step 6 of the v3.0 chain (02-database.md §5.6): users.base_currency keeps its
column but changes meaning — it is only the default for newly created ledgers
(decision §13 step 6), which on the schema side is one comment. The rest of the
users clean-up rides along: display_name (§14.40), language, updated_at, and
the removal of default_source_id (§14.6), which also breaks the
users <-> finance_sources foreign key cycle.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1f3c2a10d46"
down_revision: Union[str, Sequence[str], None] = "b1f3c2a10d45"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_BASE_CURRENCY_COMMENT = (
    "Default base currency for newly created ledgers (see ledgers.base_currency)"
)


def upgrade() -> None:
    """Finish the users table off and drop default_source_id."""
    # Before ck_users_base_currency_upper; a no-op on an empty database.
    op.execute("UPDATE users SET base_currency = upper(base_currency)")

    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("display_name", sa.String(40), nullable=True))  # §14.40
        b.add_column(sa.Column("language", sa.String(8), nullable=True))
        b.add_column(sa.Column("updated_at", sa.DateTime(), nullable=True))

    # display_name stays NULL everywhere: the information does not exist and the
    # UI falls back to the email local part (§1.1).
    op.execute("UPDATE users SET updated_at = created_at WHERE updated_at IS NULL")

    # fk_users_default_source only exists on databases built by Alembic on
    # Postgres; the SQLite branch of 76227e076393 never created it and a
    # create_all database has it unnamed. Writing A of §5.6: on SQLite the batch
    # rebuild simply leaves the column — and with it any key — behind.
    is_pg = op.get_bind().dialect.name == "postgresql"
    with op.batch_alter_table("users") as b:
        b.alter_column("updated_at", existing_type=sa.DateTime(), nullable=False)
        b.alter_column("base_currency", type_=sa.CHAR(3), existing_type=sa.String(3))
        b.alter_column("email", type_=sa.String(255), existing_type=sa.String())
        b.alter_column("password_hash", type_=sa.String(255), existing_type=sa.String())
        # CHECK names are suffixes only; the convention prepends ck_users_ (§5.0).
        b.create_check_constraint("base_currency_upper", "base_currency = upper(base_currency)")
        b.create_check_constraint("language", "language IS NULL OR language IN ('zh', 'en')")
        b.create_check_constraint(
            "display_name_not_blank",
            "display_name IS NULL OR length(trim(display_name)) > 0",
        )
        if is_pg:
            b.drop_constraint("fk_users_default_source", type_="foreignkey")
        b.drop_column("default_source_id")  # decision §14.6

    if is_pg:
        op.execute(
            f"COMMENT ON COLUMN users.base_currency IS '{_BASE_CURRENCY_COMMENT}'"
        )


def downgrade() -> None:
    """Development only (§5.7); lossy: display_name and default_source_id values."""
    is_pg = op.get_bind().dialect.name == "postgresql"
    if is_pg:
        op.execute("COMMENT ON COLUMN users.base_currency IS NULL")

    with op.batch_alter_table("users") as b:
        # Dropped by suffix, like every CHECK in this chain (see step 4).
        b.drop_constraint("base_currency_upper", type_="check")
        b.drop_constraint("language", type_="check")
        b.drop_constraint("display_name_not_blank", type_="check")
        b.alter_column("password_hash", type_=sa.String(), existing_type=sa.String(255))
        b.alter_column("email", type_=sa.String(), existing_type=sa.String(255))
        b.alter_column("base_currency", type_=sa.String(3), existing_type=sa.CHAR(3))
        b.add_column(sa.Column("default_source_id", sa.Uuid(), nullable=True))
        # Symmetric with writing A above: the named key is Postgres-only.
        if is_pg:
            b.create_foreign_key(
                "fk_users_default_source",
                "finance_sources",
                ["default_source_id"],
                ["id"],
                ondelete="SET NULL",
            )
        b.drop_column("display_name")
        b.drop_column("language")
        b.drop_column("updated_at")
