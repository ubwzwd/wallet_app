"""FinanceSource model for managing user's payment sources and accounts."""
import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class FinanceSource(Base):
    """FinanceSource table for user's financial accounts and payment sources."""
    
    __tablename__ = "finance_sources"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)  # e.g., "Chase Checking", "Amex Credit"
    type = Column(String(32), nullable=False)  # checking, savings, credit, other
    default_currency = Column(String(3), nullable=False)  # ISO 4217 code
    archived = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="finance_sources", foreign_keys=[user_id])
    transactions = relationship("Transaction", back_populates="source", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<FinanceSource(id={self.id}, name={self.name}, currency={self.default_currency})>"

