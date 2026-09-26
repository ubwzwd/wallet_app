"""LedgerSource model: an account shared into a ledger (decision §14.62).

One row means "the owner of this account shared it into this ledger", so the
other members of that ledger can use it too. The owner never needs a row to
use their own account (§14.62 b). Both foreign keys cascade: deleting the
ledger or the account removes the share, and nothing else.
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, PrimaryKeyConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.finance_source import FinanceSource
    from app.models.ledger import Ledger


class LedgerSource(Base):
    """One (ledger, account) share; the primary key makes sharing idempotent."""

    __tablename__ = "ledger_sources"

    ledger_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey(
            "ledgers.id",
            ondelete="CASCADE",
            name="fk_ledger_sources_ledger_id_ledgers",
        ),
        nullable=False,
    )
    source_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey(
            "finance_sources.id",
            ondelete="CASCADE",
            name="fk_ledger_sources_source_id_finance_sources",
        ),
        nullable=False,
    )
    shared_by: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey("users.id", name="fk_ledger_sources_shared_by_users"),
        nullable=False,
    )
    shared_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    ledger: Mapped["Ledger"] = relationship(back_populates="source_shares")
    source: Mapped["FinanceSource"] = relationship(back_populates="shares")

    __table_args__ = (
        PrimaryKeyConstraint("ledger_id", "source_id", name="pk_ledger_sources"),
    )

    def __repr__(self) -> str:
        return f"<LedgerSource(ledger_id={self.ledger_id}, source_id={self.source_id})>"


Index("ix_ledger_sources_source_id", LedgerSource.source_id)
