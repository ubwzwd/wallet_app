"""User model for authentication and base currency settings."""
import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, ForeignKey, Uuid
from sqlalchemy.orm import relationship

from app.core.database import Base


class User(Base):
    """User table for multi-user authentication."""
    
    __tablename__ = "users"
    
    id = Column(Uuid(), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    base_currency = Column(String(3), nullable=False, default="USD")  # ISO 4217 code
    default_source_id = Column(Uuid(), ForeignKey("finance_sources.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    
    # Relationships
    finance_sources = relationship("FinanceSource", back_populates="user", cascade="all, delete-orphan", foreign_keys="[FinanceSource.user_id]")
    default_source = relationship("FinanceSource", foreign_keys=[default_source_id], uselist=False)
    transactions = relationship("Transaction", back_populates="user", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<User(id={self.id}, email={self.email})>"

