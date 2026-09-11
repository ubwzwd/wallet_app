"""TransactionEvent model (02-database.md §1.9): append-only audit trail."""
import uuid
from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TransactionEvent(Base):
    """One line of "who did what to this transaction, when"; never updated."""

    __tablename__ = "transaction_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    ledger_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey(
            "ledgers.id",
            ondelete="CASCADE",
            name="fk_transaction_events_ledger_id_ledgers",
        ),
        nullable=False,
    )
    transaction_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey(
            "transactions.id",
            ondelete="CASCADE",
            name="fk_transaction_events_transaction_id_transactions",
        ),
        nullable=False,
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey("users.id", name="fk_transaction_events_actor_id_users"),
        nullable=False,
    )
    at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    event: Mapped[str] = mapped_column(String(24), nullable=False)
    changes: Mapped[dict | None] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=True
    )
    import_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(),
        ForeignKey(
            "import_batches.id",
            ondelete="SET NULL",
            name="fk_transaction_events_import_batch_id_import_batches",
        ),
        nullable=True,
    )
    client: Mapped[str | None] = mapped_column(String(16), nullable=True)

    transaction: Mapped["Transaction"] = relationship(  # noqa: F821
        back_populates="events"
    )

    __table_args__ = (
        CheckConstraint(
            "event IN ('created', 'updated', 'imported', 'paired', 'unpaired', "
            "'refund_linked', 'refund_unlinked')",
            name="event",
        ),
    )

    def __repr__(self) -> str:
        return f"<TransactionEvent(id={self.id}, event={self.event})>"


Index(
    "ix_transaction_events_transaction_at",
    TransactionEvent.transaction_id,
    TransactionEvent.at.desc(),
)
