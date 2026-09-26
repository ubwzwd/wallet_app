"""Ledger, membership and invite models (02-database.md §1.2-§1.4)."""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CHAR,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    PrimaryKeyConstraint,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.ledger_source import LedgerSource

# 6-digit check without regex: strip every digit and require an empty rest,
# because `~` is Postgres-only and a string range would pass '12a456' (§1.4).
_CODE_DIGITS = (
    "length(code) = 6 AND replace(replace(replace(replace(replace("
    "replace(replace(replace(replace(replace(code, "
    "'0',''),'1',''),'2',''),'3',''),'4',''), "
    "'5',''),'6',''),'7',''),'8',''),'9','') = ''"
)


class Ledger(Base):
    """A shared book of accounts; every transaction belongs to exactly one."""

    __tablename__ = "ledgers"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    base_currency: Mapped[str] = mapped_column(CHAR(3), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey("users.id", name="fk_ledgers_created_by_users"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    members: Mapped[list["LedgerMember"]] = relationship(
        back_populates="ledger", passive_deletes=True
    )
    invites: Mapped[list["LedgerInvite"]] = relationship(
        back_populates="ledger", passive_deletes=True
    )
    # Accounts shared into this ledger (§14.62); the rows die with the ledger
    # through the database cascade, the accounts themselves never do.
    source_shares: Mapped[list["LedgerSource"]] = relationship(
        back_populates="ledger", passive_deletes=True
    )

    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="name_not_blank"),
        CheckConstraint("base_currency = upper(base_currency)", name="base_currency_upper"),
    )

    def __repr__(self) -> str:
        return f"<Ledger(id={self.id}, name={self.name})>"


class LedgerMember(Base):
    """One row per (ledger, user); the role tells owner from member."""

    __tablename__ = "ledger_members"

    ledger_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey(
            "ledgers.id",
            ondelete="CASCADE",
            name="fk_ledger_members_ledger_id_ledgers",
        ),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_ledger_members_user_id_users"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(
        String(16), nullable=False, default="member", server_default="member"
    )
    joined_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    ledger: Mapped["Ledger"] = relationship(back_populates="members")

    __table_args__ = (
        PrimaryKeyConstraint("ledger_id", "user_id", name="pk_ledger_members"),
        CheckConstraint("role IN ('owner', 'member')", name="role"),
    )

    def __repr__(self) -> str:
        return f"<LedgerMember(ledger_id={self.ledger_id}, user_id={self.user_id})>"


class LedgerInvite(Base):
    """A currently valid join code; used / expired / revoked codes are deleted."""

    __tablename__ = "ledger_invites"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    ledger_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey(
            "ledgers.id",
            ondelete="CASCADE",
            name="fk_ledger_invites_ledger_id_ledgers",
        ),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(CHAR(6), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey("users.id", name="fk_ledger_invites_created_by_users"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    ledger: Mapped["Ledger"] = relationship(back_populates="invites")

    __table_args__ = (
        CheckConstraint(_CODE_DIGITS, name="code_digits"),
        CheckConstraint("expires_at > created_at", name="expiry"),
    )

    def __repr__(self) -> str:
        return f"<LedgerInvite(id={self.id}, ledger_id={self.ledger_id})>"


Index("ix_ledgers_created_by", Ledger.created_by)
Index("ix_ledger_members_user_id", LedgerMember.user_id)
Index("ix_ledger_invites_ledger_id", LedgerInvite.ledger_id)
