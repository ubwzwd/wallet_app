"""Rename accounts.currency to default_currency

Revision ID: d671e51094c8
Revises: e533c88884b7
Create Date: 2025-10-28 17:12:27.892858

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd671e51094c8'
down_revision: Union[str, Sequence[str], None] = 'e533c88884b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Rename column instead of drop+add to preserve data
    op.alter_column('accounts', 'currency', new_column_name='default_currency')


def downgrade() -> None:
    """Downgrade schema."""
    # Rename column back
    op.alter_column('accounts', 'default_currency', new_column_name='currency')
