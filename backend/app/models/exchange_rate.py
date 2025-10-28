"""Exchange rate model for storing daily currency rates."""
from datetime import date

from sqlalchemy import Column, String, Date, Numeric, BigInteger, UniqueConstraint
from app.core.database import Base


class ExchangeRate(Base):
    """Exchange rate table for daily currency conversion rates."""
    
    __tablename__ = "exchange_rates"
    
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    source = Column(String(32), nullable=False)  # e.g., "exchangerate.host"
    base = Column(String(3), nullable=False)  # Base currency (ISO 4217)
    symbol = Column(String(3), nullable=False)  # Target currency (ISO 4217)
    rate = Column(Numeric(18, 8), nullable=False)  # Exchange rate
    date = Column(Date, nullable=False, index=True)  # Rate date
    
    # Unique constraint: only one rate per base-symbol-date combination
    __table_args__ = (
        UniqueConstraint('base', 'symbol', 'date', name='uix_base_symbol_date'),
        {'comment': 'Daily exchange rates from external API'}
    )
    
    def __repr__(self):
        return f"<ExchangeRate({self.base}/{self.symbol}={self.rate} on {self.date})>"

