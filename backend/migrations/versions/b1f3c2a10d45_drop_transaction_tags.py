"""drop transaction_tags

Revision ID: b1f3c2a10d45
Revises: b1f3c2a10d44
Create Date: 2026-09-12 00:00:00.000000

Step 5 of the v3.0 chain (02-database.md §5.5): categories are a fixed
constant table, tags are gone (decisions §1.3, §13 step 5). Tag rows are not
migrated anywhere — there is nothing they map onto.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1f3c2a10d45"
down_revision: Union[str, Sequence[str], None] = "b1f3c2a10d44"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop the table; its index and foreign key go with it."""
    op.drop_table("transaction_tags")


def downgrade() -> None:
    """Development only (§5.7); lossy: the tag rows themselves are gone."""
    op.create_table(
        "transaction_tags",
        sa.Column("transaction_id", sa.Uuid(), nullable=False),
        sa.Column("tag", sa.String(64), nullable=False),
        sa.ForeignKeyConstraint(["transaction_id"], ["transactions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("transaction_id", "tag"),
        comment="Transaction tags for flexible categorization",
    )
