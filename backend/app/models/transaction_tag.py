"""Transaction tag model for categorizing transactions."""
from sqlalchemy import Column, String, ForeignKey, PrimaryKeyConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class TransactionTag(Base):
    """Transaction tags for categorization (many-to-many)."""
    
    __tablename__ = "transaction_tags"
    
    transaction_id = Column(UUID(as_uuid=True), ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False)
    tag = Column(String(64), nullable=False)
    
    # Composite primary key
    __table_args__ = (
        PrimaryKeyConstraint('transaction_id', 'tag'),
        {'comment': 'Transaction tags for flexible categorization'}
    )
    
    # Relationships
    transaction = relationship("Transaction", back_populates="tags")
    
    def __repr__(self):
        return f"<TransactionTag(transaction_id={self.transaction_id}, tag={self.tag})>"

