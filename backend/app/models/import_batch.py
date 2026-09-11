"""Import batch and draft row models (02-database.md §1.7-§1.8)."""
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CHAR,
    JSON,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ImportBatch(Base):
    """One standard-CSV import: who uploaded what, into which account."""

    __tablename__ = "import_batches"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    ledger_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey(
            "ledgers.id",
            ondelete="CASCADE",
            name="fk_import_batches_ledger_id_ledgers",
        ),
        nullable=False,
    )
    source_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey("finance_sources.id", name="fk_import_batches_source_id_finance_sources"),
        nullable=False,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey("users.id", name="fk_import_batches_created_by_users"),
        nullable=False,
    )
    source: Mapped[str] = mapped_column(String(8), nullable=False)
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    skill_version: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="ready", server_default="ready"
    )
    row_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    warnings: Mapped[list | None] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    committed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    rows: Mapped[list["ImportRow"]] = relationship(
        back_populates="batch", passive_deletes=True
    )

    __table_args__ = (
        CheckConstraint("source IN ('csv', 'paste')", name="source"),
        CheckConstraint("status IN ('ready', 'committed')", name="status"),
        CheckConstraint("(source = 'csv') = (filename IS NOT NULL)", name="filename"),
        CheckConstraint("size_bytes > 0 AND size_bytes <= 2097152", name="size"),
        CheckConstraint("row_count >= 0 AND row_count <= 2000", name="row_count"),
        CheckConstraint(
            "(status = 'committed') = (committed_at IS NOT NULL)",
            name="committed_at",
        ),
    )

    def __repr__(self) -> str:
        return f"<ImportBatch(id={self.id}, source={self.source}, status={self.status})>"


class ImportRow(Base):
    """A draft row of an import batch; kept strictly apart from transactions."""

    __tablename__ = "import_rows"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey(
            "import_batches.id",
            ondelete="CASCADE",
            name="fk_import_rows_batch_id_import_batches",
        ),
        nullable=False,
    )
    row_no: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )
    occurred_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    currency: Mapped[str | None] = mapped_column(CHAR(3), nullable=True)
    kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    transfer_role: Mapped[str | None] = mapped_column(String(8), nullable=True)
    transfer_subtype: Mapped[str | None] = mapped_column(String(16), nullable=True)
    merchant: Mapped[str | None] = mapped_column(String(200), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    category_l1: Mapped[str | None] = mapped_column(String(32), nullable=True)
    category_l2: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    hint: Mapped[str | None] = mapped_column(String(500), nullable=True)
    flags: Mapped[list | None] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=True
    )
    matched_transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(),
        ForeignKey(
            "transactions.id",
            ondelete="SET NULL",
            name="fk_import_rows_matched_transaction_id_transactions",
        ),
        nullable=True,
    )
    counterpart_source_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(),
        ForeignKey(
            "finance_sources.id",
            ondelete="SET NULL",
            name="fk_import_rows_counterpart_source_id_finance_sources",
        ),
        nullable=True,
    )
    counterparty: Mapped[str | None] = mapped_column(String(100), nullable=True)
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(),
        ForeignKey(
            "transactions.id",
            ondelete="SET NULL",
            name="fk_import_rows_transaction_id_transactions",
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    batch: Mapped["ImportBatch"] = relationship(back_populates="rows")

    __table_args__ = (
        CheckConstraint("status IN ('pending', 'edited', 'skipped')", name="status"),
        CheckConstraint(
            "kind IS NULL OR kind IN ('expense', 'income', 'refund', 'transfer')",
            name="kind",
        ),
        CheckConstraint(
            "transfer_role IS NULL OR transfer_role IN ('out', 'in')",
            name="transfer_role",
        ),
        CheckConstraint(
            "transfer_subtype IS NULL OR transfer_subtype IN ('plain', 'repayment')",
            name="transfer_subtype",
        ),
        CheckConstraint("row_no >= 1", name="row_no"),
    )

    def __repr__(self) -> str:
        return f"<ImportRow(id={self.id}, batch_id={self.batch_id}, row_no={self.row_no})>"


Index(
    "ix_import_batches_ledger_created",
    ImportBatch.ledger_id,
    ImportBatch.created_at.desc(),
)
Index("uq_import_rows_batch_row", ImportRow.batch_id, ImportRow.row_no, unique=True)
Index(
    "ix_import_rows_transaction_id",
    ImportRow.transaction_id,
    postgresql_where=ImportRow.transaction_id.is_not(None),
    sqlite_where=ImportRow.transaction_id.is_not(None),
)
