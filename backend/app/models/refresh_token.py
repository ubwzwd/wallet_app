"""Refresh token model (02-database.md §1.12, decision §14.67).

One row per refresh token ever handed out and not yet pruned. Only the SHA-256
hex digest of the token is stored — never the token itself. A login or a
registration starts a *family*; every rotation adds a row to the same family,
so revoking a family ends that one sign-in on every token it ever produced.
"""
import uuid
from datetime import datetime

from sqlalchemy import CHAR, CheckConstraint, DateTime, ForeignKey, Index, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RefreshToken(Base):
    """A hashed, rotating, server-side revocable refresh token."""

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
            name="fk_refresh_tokens_user_id_users",
        ),
        nullable=False,
    )
    family_id: Mapped[uuid.UUID] = mapped_column(Uuid(), nullable=False)
    token_hash: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (CheckConstraint("expires_at > created_at", name="expiry"),)

    def __repr__(self) -> str:
        return f"<RefreshToken(id={self.id}, user_id={self.user_id}, family_id={self.family_id})>"


Index("ix_refresh_tokens_token_hash", RefreshToken.token_hash, unique=True)
Index("ix_refresh_tokens_user_id", RefreshToken.user_id)
Index("ix_refresh_tokens_family_id", RefreshToken.family_id)
