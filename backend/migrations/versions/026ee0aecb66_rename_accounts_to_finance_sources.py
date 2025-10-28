"""rename_accounts_to_finance_sources

Revision ID: 026ee0aecb66
Revises: 5ca7fe6e37db
Create Date: 2025-10-28 18:44:18.015106

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '026ee0aecb66'
down_revision: Union[str, Sequence[str], None] = '5ca7fe6e37db'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Step 1: Rename table accounts to finance_sources
    op.rename_table('accounts', 'finance_sources')
    
    # Step 2: Rename column in transactions table
    op.alter_column('transactions', 'account_id', new_column_name='source_id')


def downgrade() -> None:
    """Downgrade schema."""
    # Reverse Step 2: Rename column back
    op.alter_column('transactions', 'source_id', new_column_name='account_id')
    
    # Reverse Step 1: Rename table back
    op.rename_table('finance_sources', 'accounts')
