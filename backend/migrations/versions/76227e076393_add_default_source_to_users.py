"""add_default_source_to_users

Revision ID: 76227e076393
Revises: 026ee0aecb66
Create Date: 2025-10-28 19:02:50.273200

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = '76227e076393'
down_revision: Union[str, Sequence[str], None] = '026ee0aecb66'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add default_source_id column to users table
    op.add_column('users', 
        sa.Column('default_source_id', UUID(as_uuid=True), nullable=True)
    )
    
    # Add foreign key constraint. SQLite cannot ALTER a constraint into an
    # existing table and a batch rebuild of `users` here would recreate the
    # users <-> finance_sources cycle, so the constraint is Postgres-only —
    # the same Postgres-only branch 02-database.md §5.6 uses for this key.
    if op.get_bind().dialect.name != 'sqlite':
        op.create_foreign_key(
            'fk_users_default_source',
            'users', 'finance_sources',
            ['default_source_id'], ['id'],
            ondelete='SET NULL'
        )


def downgrade() -> None:
    """Downgrade schema."""
    # Drop foreign key constraint (only created outside SQLite, see upgrade)
    if op.get_bind().dialect.name != 'sqlite':
        op.drop_constraint('fk_users_default_source', 'users', type_='foreignkey')

    # Drop column
    op.drop_column('users', 'default_source_id')
