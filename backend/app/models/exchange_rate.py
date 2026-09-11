"""ExchangeRate model (02-database.md §1.10): Frankfurter daily rate cache."""
import datetime as dt
from decimal import Decimal

from sqlalchemy import CHAR, CheckConstraint, Date, DateTime, Index, Numeric, PrimaryKeyConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ExchangeRate(Base):
    """One published rate ``1 base = rate symbol`` for one quotation day."""

    __tablename__ = "exchange_rates"
    __table_args__ = (
        PrimaryKeyConstraint("date", "base", "symbol", name="pk_exchange_rates"),
        CheckConstraint("rate > 0", name="rate_positive"),
        CheckConstraint("base = upper(base)", name="base_upper"),
        CheckConstraint("symbol = upper(symbol)", name="symbol_upper"),
        CheckConstraint("base <> symbol", name="not_self"),
        {"comment": "Frankfurter daily rate cache; see 00-decisions.md 14.1"},
    )

    date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    base: Mapped[str] = mapped_column(CHAR(3), nullable=False)
    symbol: Mapped[str] = mapped_column(CHAR(3), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)
    fetched_at: Mapped[dt.datetime] = mapped_column(DateTime, nullable=False)

    def __repr__(self) -> str:
        return f"<ExchangeRate({self.date} {self.base}/{self.symbol}={self.rate})>"


Index(
    "ix_exchange_rates_pair_date",
    ExchangeRate.base,
    ExchangeRate.symbol,
    ExchangeRate.date.desc(),
)
