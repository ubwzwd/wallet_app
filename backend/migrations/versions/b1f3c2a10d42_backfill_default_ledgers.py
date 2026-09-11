"""backfill default ledgers

Revision ID: b1f3c2a10d42
Revises: b1f3c2a10d41
Create Date: 2026-09-12 00:00:00.000000

Step 2 of the v3.0 chain (02-database.md §5.2): give every existing user one
default ledger named "我的账本" plus an owner membership (decisions §2, §13).
No-op on an empty database.
"""
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1f3c2a10d42"
down_revision: Union[str, Sequence[str], None] = "b1f3c2a10d41"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Default ledger name (decision §2); migrations never import app.* (§5.0).
_DEFAULT_LEDGER_NAME = "我的账本"


def upgrade() -> None:
    """One ledger per user, base currency copied from users.base_currency."""
    conn = op.get_bind()
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    ledgers = sa.table(
        "ledgers",
        sa.column("id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("base_currency", sa.CHAR(3)),
        sa.column("created_by", sa.Uuid()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    members = sa.table(
        "ledger_members",
        sa.column("ledger_id", sa.Uuid()),
        sa.column("user_id", sa.Uuid()),
        sa.column("role", sa.String()),
        sa.column("joined_at", sa.DateTime()),
    )

    # Typed select rather than sa.text: SQLite hands back plain strings for a
    # UUID column, which the Uuid bind processor of the insert below rejects.
    users = sa.table(
        "users",
        sa.column("id", sa.Uuid()),
        sa.column("base_currency", sa.CHAR(3)),
        sa.column("created_at", sa.DateTime()),
    )
    rows = conn.execute(
        sa.select(users.c.id, users.c.base_currency).order_by(users.c.created_at)
    ).fetchall()
    ledger_rows: list[dict] = []
    member_rows: list[dict] = []
    for user_id, base_currency in rows:
        ledger_id = uuid.uuid4()
        ledger_rows.append(
            {
                "id": ledger_id,
                "name": _DEFAULT_LEDGER_NAME,
                "base_currency": (base_currency or "USD").upper(),
                "created_by": user_id,
                "created_at": now,
                "updated_at": now,
            }
        )
        member_rows.append(
            {
                "ledger_id": ledger_id,
                "user_id": user_id,
                "role": "owner",
                "joined_at": now,
            }
        )
    if ledger_rows:
        op.bulk_insert(ledgers, ledger_rows)
        op.bulk_insert(members, member_rows)


def downgrade() -> None:
    """Destructive (§5.7): ledgers created after step 2 cannot be told apart."""
    op.execute("DELETE FROM ledger_members")
    op.execute("DELETE FROM ledgers")
