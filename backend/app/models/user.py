"""User model (02-database.md §1.1)."""
import uuid
from datetime import datetime

from sqlalchemy import CHAR, CheckConstraint, DateTime, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class User(Base):
    """A registered account; owns nothing by itself, joins ledgers."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # The comment is part of the schema: migration b1f3c2a10d46 writes it, so
    # the model has to carry it or compare_metadata reports drift (§5.6).
    base_currency: Mapped[str] = mapped_column(
        CHAR(3),
        nullable=False,
        default="USD",
        comment=(
            "Default base currency for newly created ledgers "
            "(see ledgers.base_currency)"
        ),
    )
    language: Mapped[str | None] = mapped_column(String(8), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    __table_args__ = (
        CheckConstraint("base_currency = upper(base_currency)", name="base_currency_upper"),
        CheckConstraint("language IS NULL OR language IN ('zh', 'en')", name="language"),
        CheckConstraint(
            "display_name IS NULL OR length(trim(display_name)) > 0",
            name="display_name_not_blank",
        ),
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email={self.email})>"


Index("ix_users_email", User.email, unique=True)
