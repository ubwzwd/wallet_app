"""Transaction model (02-database.md §1.6)."""
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CHAR,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Transaction(Base):
    """One booked movement of money; ``kind`` is the single source of direction."""

    __tablename__ = "transactions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    ledger_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey(
            "ledgers.id",
            ondelete="CASCADE",
            name="fk_transactions_ledger_id_ledgers",
        ),
        nullable=False,
    )
    # NO ACTION on purpose: RESTRICT would break "delete ledger" (§1.6.2).
    source_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey("finance_sources.id", name="fk_transactions_source_id_finance_sources"),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    currency: Mapped[str] = mapped_column(CHAR(3), nullable=False)
    occurred_at: Mapped[date] = mapped_column(Date, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    merchant: Mapped[str | None] = mapped_column(String(200), nullable=True)
    category_l1: Mapped[str | None] = mapped_column(String(32), nullable=True)
    category_l2: Mapped[str | None] = mapped_column(String(32), nullable=True)
    transfer_role: Mapped[str | None] = mapped_column(String(8), nullable=True)
    transfer_subtype: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Free UUID shared by the two legs of a transfer; deliberately no foreign key.
    transfer_pair_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(), nullable=True)
    counterparty: Mapped[str | None] = mapped_column(String(100), nullable=True)
    refund_of: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(),
        ForeignKey(
            "transactions.id",
            ondelete="SET NULL",
            name="fk_transactions_refund_of_transactions",
        ),
        nullable=True,
    )
    import_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(),
        ForeignKey(
            "import_batches.id",
            ondelete="SET NULL",
            name="fk_transactions_import_batch_id_import_batches",
        ),
        nullable=True,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey("users.id", name="fk_transactions_created_by_users"),
        nullable=False,
    )
    updated_by: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey("users.id", name="fk_transactions_updated_by_users"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    events: Mapped[list["TransactionEvent"]] = relationship(  # noqa: F821
        back_populates="transaction", passive_deletes=True
    )

    __table_args__ = (
        CheckConstraint(
            "kind IN ('expense', 'income', 'refund', 'transfer')",
            name="kind",
        ),
        CheckConstraint(
            "(kind = 'expense'  AND amount < 0) OR "
            "(kind = 'income'   AND amount > 0) OR "
            "(kind = 'refund'   AND amount > 0) OR "
            "(kind = 'transfer' AND transfer_role = 'out' AND amount < 0) OR "
            "(kind = 'transfer' AND transfer_role = 'in'  AND amount > 0)",
            name="amount_sign",
        ),
        CheckConstraint(
            "(kind = 'transfer') = (transfer_role IS NOT NULL)",
            name="transfer_role",
        ),
        CheckConstraint(
            "(kind = 'transfer') = (transfer_subtype IS NOT NULL)",
            name="transfer_subtype",
        ),
        CheckConstraint(
            "(kind = 'transfer' AND category_l1 IS NULL AND category_l2 IS NULL) OR "
            "(kind <> 'transfer' AND category_l1 IS NOT NULL)",
            name="category",
        ),
        CheckConstraint("refund_of IS NULL OR kind = 'refund'", name="refund_of"),
        UniqueConstraint(
            "transfer_pair_id",
            "transfer_role",
            name="uq_transactions_transfer_pair_role",
        ),
        CheckConstraint(
            "transfer_pair_id IS NULL OR counterparty IS NULL",
            name="counterparty",
        ),
        CheckConstraint(
            "transfer_role IS NULL OR transfer_role IN ('out', 'in')",
            name="transfer_role_values",
        ),
        CheckConstraint(
            "transfer_subtype IS NULL OR transfer_subtype IN ('plain', 'repayment')",
            name="transfer_subtype_values",
        ),
        CheckConstraint(
            "category_l2 IS NULL OR category_l1 IS NOT NULL",
            name="category_l2_needs_l1",
        ),
        CheckConstraint("currency = upper(currency)", name="currency_upper"),
        CheckConstraint("refund_of IS NULL OR refund_of <> id", name="not_self_refund"),
    )

    def __repr__(self) -> str:
        return (
            f"<Transaction(id={self.id}, kind={self.kind}, "
            f"amount={self.amount} {self.currency}, date={self.occurred_at})>"
        )


Index(
    "ix_transactions_ledger_occurred",
    Transaction.ledger_id,
    Transaction.occurred_at.desc(),
    Transaction.created_at.desc(),
)
Index("ix_transactions_ledger_source", Transaction.ledger_id, Transaction.source_id)
# Account balances span every ledger (decision §14.62 f): the balance query
# filters on source_id alone and groups by occurred_at (02 §4).
Index("ix_transactions_source_occurred", Transaction.source_id, Transaction.occurred_at)
Index(
    "ix_transactions_ledger_kind_cat",
    Transaction.ledger_id,
    Transaction.kind,
    Transaction.category_l1,
)
Index(
    "ix_transactions_refund_of",
    Transaction.refund_of,
    postgresql_where=Transaction.refund_of.is_not(None),
    sqlite_where=Transaction.refund_of.is_not(None),
)
Index(
    "ix_transactions_import_batch_id",
    Transaction.import_batch_id,
    postgresql_where=Transaction.import_batch_id.is_not(None),
    sqlite_where=Transaction.import_batch_id.is_not(None),
)
