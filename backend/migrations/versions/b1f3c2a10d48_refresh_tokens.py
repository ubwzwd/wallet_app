"""refresh tokens

Revision ID: b1f3c2a10d48
Revises: b1f3c2a10d47
Create Date: 2026-11-23 00:00:00.000000

Decision §14.67: short access tokens plus rotating, server-side revocable
refresh tokens. One new table (02-database.md §1.12) and its three indexes;
``users`` is untouched. Pure DDL, so it runs on an empty database as well as on
a populated one, and the downgrade simply drops the table (every signed-in
device then has to log in again once the old code is back).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1f3c2a10d48"
down_revision: Union[str, Sequence[str], None] = "b1f3c2a10d47"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create refresh_tokens with its unique hash index and two lookups."""
    # CHECK constraints carry the suffix only; the naming convention prepends
    # ck_<table>_ (02-database.md §5.0). fk / ix / pk take the full name.
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.CHAR(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_refresh_tokens"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name="fk_refresh_tokens_user_id_users",
        ),
        sa.CheckConstraint("expires_at > created_at", name="expiry"),
    )
    op.create_index(
        "ix_refresh_tokens_token_hash", "refresh_tokens", ["token_hash"], unique=True
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_index("ix_refresh_tokens_family_id", "refresh_tokens", ["family_id"])


def downgrade() -> None:
    """Drop the table; every refresh token ever issued is gone with it."""
    op.drop_index("ix_refresh_tokens_family_id", table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_token_hash", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
