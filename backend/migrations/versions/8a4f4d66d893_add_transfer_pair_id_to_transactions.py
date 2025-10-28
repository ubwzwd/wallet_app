"""add_transfer_pair_id_to_transactions

Revision ID: 8a4f4d66d893
Revises: 76227e076393
Create Date: 2025-10-28 20:22:43.070613

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = '8a4f4d66d893'
down_revision: Union[str, Sequence[str], None] = '76227e076393'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add transfer_pair_id column to transactions table
    op.add_column('transactions', 
        sa.Column('transfer_pair_id', UUID(as_uuid=True), nullable=True)
    )
    
    # Add index for efficient queries
    op.create_index(
        'idx_transactions_transfer_pair',
        'transactions',
        ['transfer_pair_id']
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Drop index
    op.drop_index('idx_transactions_transfer_pair', 'transactions')
    
    # Drop column
    op.drop_column('transactions', 'transfer_pair_id')
