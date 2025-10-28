"""Transaction model for expense/income records."""
import uuid
from datetime import datetime, date

from sqlalchemy import Column, String, DateTime, Date, Numeric, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class Transaction(Base):
    """Transaction table for expense and income records."""
    
    __tablename__ = "transactions"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    account_id = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False, index=True)
    amount = Column(Numeric(18, 4), nullable=False)  # Original amount
    currency = Column(String(3), nullable=False)  # ISO 4217 code
    occurred_at = Column(Date, nullable=False, index=True)  # Transaction date
    description = Column(String, nullable=True)
    merchant = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="transactions")
    account = relationship("Account", back_populates="transactions")
    tags = relationship("TransactionTag", back_populates="transaction", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<Transaction(id={self.id}, amount={self.amount} {self.currency}, date={self.occurred_at})>"

