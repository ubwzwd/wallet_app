"""FinanceSource model (02-database.md §1.5)."""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    CHAR,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.ledger_source import LedgerSource


class FinanceSource(Base):
    """An account that belongs to one user and is shared into ledgers (§14.62).

    ``owner_id`` is the person the card belongs to. The owner can use it in any
    ledger they are a member of; a ``ledger_sources`` row shares it into one
    ledger so that the other members there can use it too. Deleting a ledger
    only drops those share rows — the account itself survives.
    """

    __tablename__ = "finance_sources"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey("users.id", name="fk_finance_sources_owner_id_users"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    default_currency: Mapped[str] = mapped_column(CHAR(3), nullable=False)
    opening_balance: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0"), server_default=text("0")
    )
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey("users.id", name="fk_finance_sources_created_by_users"),
        nullable=False,
    )
    updated_by: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey("users.id", name="fk_finance_sources_updated_by_users"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    # Share rows only; the database cascades them away (passive_deletes).
    shares: Mapped[list["LedgerSource"]] = relationship(
        back_populates="source", passive_deletes=True
    )

    __table_args__ = (
        CheckConstraint("type IN ('checking', 'credit', 'cash', 'other')", name="type"),
        CheckConstraint("default_currency = upper(default_currency)", name="currency_upper"),
        CheckConstraint("length(trim(name)) > 0", name="name_not_blank"),
        CheckConstraint("archived = (archived_at IS NOT NULL)", name="archived_at"),
    )

    def __repr__(self) -> str:
        return f"<FinanceSource(id={self.id}, name={self.name}, type={self.type})>"


Index("ix_finance_sources_owner_id", FinanceSource.owner_id)
