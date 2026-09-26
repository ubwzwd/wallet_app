"""Ledger / member / invite service behaviour (03-backend-api.md §5.9, §5.14-§5.19).

Everything runs against the in-memory SQLite session from ``conftest.py``; the
service never commits, so each case flushes through ``db`` and reads back with
plain queries.
"""
import datetime as dt
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.errors import ApiError, ErrorCode
from app.models import (
    FinanceSource,
    ImportBatch,
    Ledger,
    LedgerInvite,
    LedgerMember,
    Transaction,
    User,
)
from app.models.ledger_source import LedgerSource
from app.services import ledger_service
from app.services.ledger_service import (
    DEFAULT_LEDGER_NAME,
    INVITE_CODE_ATTEMPTS,
    INVITE_TTL,
    create_default_ledger,
    create_ledger,
    issue_invite,
    ledger_counts,
    leave,
    member_count,
    redeem_invite,
    remove_member,
    revoke_invite,
    transfer_ownership,
    user_ledger_count,
)

NOW = dt.datetime(2026, 9, 12, 10, 0, 0)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def make_user(db, email: str = "alice@example.com", base_currency: str = "CNY") -> User:
    """Insert a user row; ledgers always hang off a real user (FKs are on)."""
    user = User(
        email=email,
        password_hash="hash",
        base_currency=base_currency,
        created_at=NOW,
        updated_at=NOW,
    )
    db.add(user)
    db.flush()
    return user


def add_invite(db, ledger: Ledger, actor: User, code: str, expires_at: dt.datetime):
    """Insert an invite row directly, so expiry can be placed in the past."""
    invite = LedgerInvite(
        ledger_id=ledger.id,
        code=code,
        created_by=actor.id,
        created_at=expires_at - INVITE_TTL,
        expires_at=expires_at,
    )
    db.add(invite)
    db.flush()
    return invite


def codes(db, ledger_id=None) -> set[str]:
    """The codes currently in the table, optionally for one ledger."""
    stmt = select(LedgerInvite.code)
    if ledger_id is not None:
        stmt = stmt.where(LedgerInvite.ledger_id == ledger_id)
    return set(db.execute(stmt).scalars())


def add_account(db, owner: User, name: str = "招行") -> FinanceSource:
    """An account ``owner`` owns (decision §14.62), shared nowhere yet."""
    source = FinanceSource(
        owner_id=owner.id,
        name=name,
        type="checking",
        default_currency="CNY",
        opening_balance=Decimal("0"),
        archived=False,
        created_by=owner.id,
        updated_by=owner.id,
        created_at=NOW,
        updated_at=NOW,
    )
    db.add(source)
    db.flush()
    return source


def share(db, ledger: Ledger, source: FinanceSource) -> None:
    db.add(
        LedgerSource(
            ledger_id=ledger.id,
            source_id=source.id,
            shared_by=source.owner_id,
            shared_at=NOW,
        )
    )
    db.flush()


def add_expense(db, ledger: Ledger, source: FinanceSource, actor: User) -> Transaction:
    tx = Transaction(
        ledger_id=ledger.id,
        source_id=source.id,
        amount=Decimal("-10.0000"),
        currency="CNY",
        occurred_at=NOW.date(),
        kind="expense",
        category_l1="food",
        created_by=actor.id,
        updated_by=actor.id,
        created_at=NOW,
        updated_at=NOW,
    )
    db.add(tx)
    db.flush()
    return tx


def shares_of(db, ledger: Ledger) -> set:
    """The account ids shared into ``ledger`` (its ``ledger_sources`` rows)."""
    return set(
        db.execute(
            select(LedgerSource.source_id).where(LedgerSource.ledger_id == ledger.id)
        ).scalars()
    )


def role_of(db, ledger: Ledger, user: User) -> str | None:
    return db.execute(
        select(LedgerMember.role).where(
            LedgerMember.ledger_id == ledger.id,
            LedgerMember.user_id == user.id,
        )
    ).scalar_one_or_none()


def owners(db, ledger: Ledger) -> list[uuid.UUID]:
    return list(
        db.execute(
            select(LedgerMember.user_id).where(
                LedgerMember.ledger_id == ledger.id,
                LedgerMember.role == "owner",
            )
        ).scalars()
    )


def fixed_codes(monkeypatch, *values: int) -> list[int]:
    """Make ``secrets.randbelow`` hand out ``values`` in order, recording calls.

    The last value repeats once the list runs out, so a "always collides" case
    only needs one entry. The returned list grows with every draw.
    """
    drawn: list[int] = []

    def fake_randbelow(_upper: int) -> int:
        value = values[min(len(drawn), len(values) - 1)]
        drawn.append(value)
        return value

    monkeypatch.setattr(ledger_service.secrets, "randbelow", fake_randbelow)
    return drawn


# ---------------------------------------------------------------------------
# create_ledger / create_default_ledger (§5.9, §5.1)
# ---------------------------------------------------------------------------


def test_create_ledger_trims_name_upper_cases_currency_and_makes_owner(db):
    user = make_user(db)

    ledger = create_ledger(db, user, "  家庭账本  ", "cny")

    assert ledger.name == "家庭账本"
    assert ledger.base_currency == "CNY"
    assert ledger.created_by == user.id
    assert ledger.created_at == ledger.updated_at
    assert role_of(db, ledger, user) == "owner"
    assert member_count(db, ledger.id) == 1


def test_create_ledger_does_not_commit(db):
    user = make_user(db)
    db.commit()  # the user is durable, the ledger must not be

    create_ledger(db, user, "家庭账本", "CNY")
    db.rollback()

    assert db.execute(select(Ledger)).scalars().all() == []
    assert db.execute(select(LedgerMember)).scalars().all() == []
    assert db.get(User, user.id) is not None


@pytest.mark.parametrize("name", ["", "   ", "\t\n", "x" * 101])
def test_create_ledger_rejects_bad_names(db, name):
    user = make_user(db)

    with pytest.raises(ApiError) as excinfo:
        create_ledger(db, user, name, "CNY")

    assert excinfo.value.status_code == 400
    assert excinfo.value.code == ErrorCode.VALIDATION_ERROR


def test_create_ledger_accepts_a_100_character_name(db):
    user = make_user(db)

    ledger = create_ledger(db, user, "x" * 100, "CNY")

    assert len(ledger.name) == 100


@pytest.mark.parametrize(
    "currency",
    [
        "",
        "CN",
        "CNYY",
        "12 ",
        # Three letters as far as ``str.isalpha`` is concerned, but not three
        # ASCII letters: only the ``^[A-Za-z]{3}$`` of §4.5 turns these away.
        "ＣＮＹ",
        "ЦНЫ",
    ],
)
def test_create_ledger_rejects_malformed_currency(db, currency):
    user = make_user(db)

    with pytest.raises(ApiError) as excinfo:
        create_ledger(db, user, "家庭账本", currency)

    assert excinfo.value.status_code == 400
    assert excinfo.value.code == ErrorCode.VALIDATION_ERROR


def test_create_ledger_stops_at_the_ledger_limit(db, monkeypatch):
    monkeypatch.setattr(settings, "MAX_LEDGERS_PER_USER", 2)
    user = make_user(db)
    create_ledger(db, user, "one", "CNY")
    create_ledger(db, user, "two", "CNY")

    with pytest.raises(ApiError) as excinfo:
        create_ledger(db, user, "three", "CNY")

    assert excinfo.value.status_code == 409
    assert excinfo.value.code == ErrorCode.LEDGER_LIMIT_REACHED
    assert user_ledger_count(db, user.id) == 2


def test_ledger_limit_counts_joined_ledgers_too(db, monkeypatch):
    monkeypatch.setattr(settings, "MAX_LEDGERS_PER_USER", 2)
    owner = make_user(db, "owner@example.com")
    joiner = make_user(db, "joiner@example.com")
    create_ledger(db, joiner, "mine", "CNY")
    shared = create_ledger(db, owner, "shared", "CNY")
    redeem_invite(db, joiner, issue_invite(db, shared, owner).code)

    with pytest.raises(ApiError) as excinfo:
        create_ledger(db, joiner, "third", "CNY")

    assert excinfo.value.code == ErrorCode.LEDGER_LIMIT_REACHED


def test_create_default_ledger_uses_the_users_currency(db):
    user = make_user(db, base_currency="SGD")

    ledger = create_default_ledger(db, user)

    assert ledger.name == DEFAULT_LEDGER_NAME == "我的账本"
    assert ledger.base_currency == "SGD"
    assert role_of(db, ledger, user) == "owner"


# ---------------------------------------------------------------------------
# issue_invite (§5.17, decision §14.29)
# ---------------------------------------------------------------------------


def test_issue_invite_is_six_digits_valid_for_ten_minutes(db):
    user = make_user(db)
    ledger = create_ledger(db, user, "家庭账本", "CNY")

    invite = issue_invite(db, ledger, user)

    assert len(invite.code) == 6
    assert invite.code.isdigit()
    assert invite.ledger_id == ledger.id
    assert invite.created_by == user.id
    assert invite.expires_at - invite.created_at == dt.timedelta(minutes=10)
    # Not committed, but visible in this transaction.
    assert codes(db, ledger.id) == {invite.code}


def test_issue_invite_sweeps_this_ledgers_expired_codes(db):
    user = make_user(db)
    ledger = create_ledger(db, user, "家庭账本", "CNY")
    other = create_ledger(db, user, "另一本", "CNY")
    stale = dt.datetime.now(dt.UTC).replace(tzinfo=None) - dt.timedelta(minutes=1)
    add_invite(db, ledger, user, "111111", stale)
    add_invite(db, other, user, "222222", stale)
    live = add_invite(db, ledger, user, "333333", stale + dt.timedelta(hours=2))

    invite = issue_invite(db, ledger, user)

    # Own expired row swept, own live row kept, the other ledger untouched.
    assert codes(db, ledger.id) == {live.code, invite.code}
    assert codes(db, other.id) == {"222222"}


def test_issue_invite_redraws_when_a_live_code_collides(db, monkeypatch):
    user = make_user(db)
    ledger = create_ledger(db, user, "家庭账本", "CNY")
    future = dt.datetime.now(dt.UTC).replace(tzinfo=None) + dt.timedelta(minutes=5)
    add_invite(db, ledger, user, "123456", future)
    drawn = fixed_codes(monkeypatch, 123456, 123456, 654321)

    invite = issue_invite(db, ledger, user)

    assert invite.code == "654321"
    assert len(drawn) == 3
    assert codes(db, ledger.id) == {"123456", "654321"}


def test_issue_invite_ignores_an_expired_codes_number(db, monkeypatch):
    """Only live codes are checked, so an expired number may be reused (§14.29)."""
    user = make_user(db)
    ledger = create_ledger(db, user, "家庭账本", "CNY")
    other = create_ledger(db, user, "另一本", "CNY")
    past = dt.datetime.now(dt.UTC).replace(tzinfo=None) - dt.timedelta(minutes=1)
    add_invite(db, other, user, "123456", past)
    drawn = fixed_codes(monkeypatch, 123456)

    invite = issue_invite(db, ledger, user)

    assert invite.code == "123456"
    assert len(drawn) == 1


def test_issue_invite_gives_up_after_five_collisions(db, monkeypatch):
    user = make_user(db)
    ledger = create_ledger(db, user, "家庭账本", "CNY")
    future = dt.datetime.now(dt.UTC).replace(tzinfo=None) + dt.timedelta(minutes=5)
    add_invite(db, ledger, user, "123456", future)
    drawn = fixed_codes(monkeypatch, 123456)

    with pytest.raises(ApiError) as excinfo:
        issue_invite(db, ledger, user)

    assert excinfo.value.status_code == 500
    assert excinfo.value.code == ErrorCode.INTERNAL_ERROR
    assert len(drawn) == INVITE_CODE_ATTEMPTS == 5
    assert codes(db, ledger.id) == {"123456"}


def test_issue_invite_refuses_when_the_ledger_is_full(db, monkeypatch):
    monkeypatch.setattr(settings, "MAX_MEMBERS_PER_LEDGER", 1)
    user = make_user(db)
    ledger = create_ledger(db, user, "家庭账本", "CNY")

    with pytest.raises(ApiError) as excinfo:
        issue_invite(db, ledger, user)

    assert excinfo.value.status_code == 409
    assert excinfo.value.code == ErrorCode.MEMBER_LIMIT_REACHED


def test_issue_invite_allows_several_live_codes_per_ledger(db):
    user = make_user(db)
    ledger = create_ledger(db, user, "家庭账本", "CNY")

    first = issue_invite(db, ledger, user)
    second = issue_invite(db, ledger, user)

    assert codes(db, ledger.id) == {first.code, second.code}


# ---------------------------------------------------------------------------
# revoke_invite (§5.18)
# ---------------------------------------------------------------------------


def test_revoke_invite_deletes_the_row(db):
    user = make_user(db)
    ledger = create_ledger(db, user, "家庭账本", "CNY")
    invite = issue_invite(db, ledger, user)

    revoke_invite(db, ledger, invite.code)

    assert codes(db, ledger.id) == set()


def test_revoke_invite_is_404_the_second_time(db):
    user = make_user(db)
    ledger = create_ledger(db, user, "家庭账本", "CNY")
    invite = issue_invite(db, ledger, user)
    revoke_invite(db, ledger, invite.code)

    with pytest.raises(ApiError) as excinfo:
        revoke_invite(db, ledger, invite.code)

    assert excinfo.value.status_code == 404
    assert excinfo.value.code == ErrorCode.NOT_FOUND


def test_revoke_invite_only_touches_its_own_ledger(db):
    user = make_user(db)
    ledger = create_ledger(db, user, "家庭账本", "CNY")
    other = create_ledger(db, user, "另一本", "CNY")
    invite = issue_invite(db, ledger, user)

    with pytest.raises(ApiError) as excinfo:
        revoke_invite(db, other, invite.code)

    assert excinfo.value.code == ErrorCode.NOT_FOUND
    assert codes(db, ledger.id) == {invite.code}


def test_revoked_code_cannot_be_redeemed(db):
    owner = make_user(db, "owner@example.com")
    joiner = make_user(db, "joiner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")
    invite = issue_invite(db, ledger, owner)
    revoke_invite(db, ledger, invite.code)

    with pytest.raises(ApiError) as excinfo:
        redeem_invite(db, joiner, invite.code)

    assert excinfo.value.code == ErrorCode.INVITE_INVALID


# ---------------------------------------------------------------------------
# redeem_invite (§5.19)
# ---------------------------------------------------------------------------


def test_redeem_invite_joins_as_member_and_burns_the_code(db):
    owner = make_user(db, "owner@example.com")
    joiner = make_user(db, "joiner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")
    invite = issue_invite(db, ledger, owner)

    joined = redeem_invite(db, joiner, invite.code)

    assert joined.id == ledger.id
    assert role_of(db, ledger, joiner) == "member"
    assert member_count(db, ledger.id) == 2
    assert codes(db, ledger.id) == set()


def test_redeem_invite_is_single_use(db):
    owner = make_user(db, "owner@example.com")
    first = make_user(db, "first@example.com")
    second = make_user(db, "second@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")
    invite = issue_invite(db, ledger, owner)
    redeem_invite(db, first, invite.code)

    with pytest.raises(ApiError) as excinfo:
        redeem_invite(db, second, invite.code)

    assert excinfo.value.status_code == 400
    assert excinfo.value.code == ErrorCode.INVITE_INVALID
    assert role_of(db, ledger, second) is None


def test_redeem_invite_rejects_and_sweeps_an_expired_code(db):
    owner = make_user(db, "owner@example.com")
    joiner = make_user(db, "joiner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")
    past = dt.datetime.now(dt.UTC).replace(tzinfo=None) - dt.timedelta(seconds=1)
    add_invite(db, ledger, owner, "424242", past)

    with pytest.raises(ApiError) as excinfo:
        redeem_invite(db, joiner, "424242")

    assert excinfo.value.status_code == 400
    assert excinfo.value.code == ErrorCode.INVITE_INVALID
    assert codes(db, ledger.id) == set()  # swept on the way past (§14.29)
    assert role_of(db, ledger, joiner) is None


def test_redeem_invite_rejects_an_unknown_code(db):
    joiner = make_user(db, "joiner@example.com")

    with pytest.raises(ApiError) as excinfo:
        redeem_invite(db, joiner, "000000")

    assert excinfo.value.code == ErrorCode.INVITE_INVALID


def test_redeem_invite_refuses_an_existing_member_without_burning_the_code(db):
    owner = make_user(db, "owner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")
    invite = issue_invite(db, ledger, owner)

    with pytest.raises(ApiError) as excinfo:
        redeem_invite(db, owner, invite.code)

    assert excinfo.value.status_code == 409
    assert excinfo.value.code == ErrorCode.ALREADY_MEMBER
    assert codes(db, ledger.id) == {invite.code}
    assert member_count(db, ledger.id) == 1


def test_redeem_invite_refuses_a_full_ledger_without_burning_the_code(db, monkeypatch):
    monkeypatch.setattr(settings, "MAX_MEMBERS_PER_LEDGER", 1)
    owner = make_user(db, "owner@example.com")
    joiner = make_user(db, "joiner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")
    monkeypatch.setattr(settings, "MAX_MEMBERS_PER_LEDGER", 2)
    invite = issue_invite(db, ledger, owner)
    monkeypatch.setattr(settings, "MAX_MEMBERS_PER_LEDGER", 1)

    with pytest.raises(ApiError) as excinfo:
        redeem_invite(db, joiner, invite.code)

    assert excinfo.value.status_code == 409
    assert excinfo.value.code == ErrorCode.MEMBER_LIMIT_REACHED
    assert codes(db, ledger.id) == {invite.code}
    assert role_of(db, ledger, joiner) is None


def test_redeem_invite_refuses_when_the_joiner_is_at_the_ledger_limit(db, monkeypatch):
    monkeypatch.setattr(settings, "MAX_LEDGERS_PER_USER", 1)
    owner = make_user(db, "owner@example.com")
    joiner = make_user(db, "joiner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")
    create_ledger(db, joiner, "我的账本", "CNY")
    invite = issue_invite(db, ledger, owner)

    with pytest.raises(ApiError) as excinfo:
        redeem_invite(db, joiner, invite.code)

    assert excinfo.value.status_code == 409
    assert excinfo.value.code == ErrorCode.LEDGER_LIMIT_REACHED
    assert codes(db, ledger.id) == {invite.code}
    assert role_of(db, ledger, joiner) is None


def test_redeem_invite_checks_membership_before_the_member_limit(db, monkeypatch):
    """A member who re-enters a full ledger's code gets already_member (§5.19)."""
    monkeypatch.setattr(settings, "MAX_MEMBERS_PER_LEDGER", 1)
    owner = make_user(db, "owner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")
    invite = add_invite(
        db,
        ledger,
        owner,
        "515151",
        dt.datetime.now(dt.UTC).replace(tzinfo=None) + dt.timedelta(minutes=5),
    )

    with pytest.raises(ApiError) as excinfo:
        redeem_invite(db, owner, invite.code)

    assert excinfo.value.code == ErrorCode.ALREADY_MEMBER


def test_redeem_invite_does_not_commit(db):
    owner = make_user(db, "owner@example.com")
    joiner = make_user(db, "joiner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")
    invite = issue_invite(db, ledger, owner)
    db.commit()

    redeem_invite(db, joiner, invite.code)
    db.rollback()

    assert role_of(db, ledger, joiner) is None
    assert codes(db, ledger.id) == {invite.code}


# ---------------------------------------------------------------------------
# transfer_ownership (§5.16)
# ---------------------------------------------------------------------------


def test_transfer_ownership_swaps_the_two_roles(db):
    owner = make_user(db, "owner@example.com")
    joiner = make_user(db, "joiner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")
    redeem_invite(db, joiner, issue_invite(db, ledger, owner).code)

    transfer_ownership(db, ledger, joiner.id)

    assert owners(db, ledger) == [joiner.id]
    assert role_of(db, ledger, owner) == "member"
    assert role_of(db, ledger, joiner) == "owner"


def test_transfer_ownership_to_a_non_member_is_member_not_found(db):
    owner = make_user(db, "owner@example.com")
    stranger = make_user(db, "stranger@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")

    with pytest.raises(ApiError) as excinfo:
        transfer_ownership(db, ledger, stranger.id)

    assert excinfo.value.status_code == 404
    assert excinfo.value.code == ErrorCode.MEMBER_NOT_FOUND
    assert owners(db, ledger) == [owner.id]


def test_transfer_ownership_to_self_is_validation_error(db):
    owner = make_user(db, "owner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")

    with pytest.raises(ApiError) as excinfo:
        transfer_ownership(db, ledger, owner.id)

    assert excinfo.value.status_code == 400
    assert excinfo.value.code == ErrorCode.VALIDATION_ERROR
    assert owners(db, ledger) == [owner.id]


def test_transfer_ownership_leaves_the_other_ledger_alone(db):
    owner = make_user(db, "owner@example.com")
    joiner = make_user(db, "joiner@example.com")
    shared = create_ledger(db, owner, "家庭账本", "CNY")
    private = create_ledger(db, owner, "我的账本", "CNY")
    redeem_invite(db, joiner, issue_invite(db, shared, owner).code)

    transfer_ownership(db, shared, joiner.id)

    assert owners(db, private) == [owner.id]


# ---------------------------------------------------------------------------
# remove_member / leave (§5.14, §5.15)
# ---------------------------------------------------------------------------


def test_remove_member_drops_the_membership_row(db):
    owner = make_user(db, "owner@example.com")
    joiner = make_user(db, "joiner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")
    redeem_invite(db, joiner, issue_invite(db, ledger, owner).code)

    remove_member(db, ledger, joiner.id)

    assert role_of(db, ledger, joiner) is None
    assert member_count(db, ledger.id) == 1


def test_removing_a_member_unshares_their_accounts_and_keeps_their_entries(db):
    """§14.62 f: their cards leave this ledger with them; nothing else moves."""
    owner = make_user(db, "owner@example.com")
    joiner = make_user(db, "joiner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")
    elsewhere = create_ledger(db, joiner, "自己的", "CNY")
    redeem_invite(db, joiner, issue_invite(db, ledger, owner).code)
    theirs = add_account(db, joiner, "他的卡")
    ours = add_account(db, owner, "家用卡")
    for source in (theirs, ours):
        share(db, ledger, source)
    share(db, elsewhere, theirs)
    booked = add_expense(db, ledger, theirs, joiner)

    remove_member(db, ledger, joiner.id)

    assert shares_of(db, ledger) == {ours.id}
    assert shares_of(db, elsewhere) == {theirs.id}
    assert db.get(Transaction, booked.id) is not None
    assert db.get(FinanceSource, theirs.id) is not None
    assert ledger_counts(db, ledger.id)["sources"] == 1


def test_leaving_unshares_ones_accounts_and_keeps_ones_entries(db):
    owner = make_user(db, "owner@example.com")
    joiner = make_user(db, "joiner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")
    redeem_invite(db, joiner, issue_invite(db, ledger, owner).code)
    theirs = add_account(db, joiner, "他的卡")
    ours = add_account(db, owner, "家用卡")
    for source in (theirs, ours):
        share(db, ledger, source)
    booked = add_expense(db, ledger, theirs, joiner)

    leave(db, ledger, joiner)

    assert role_of(db, ledger, joiner) is None
    assert shares_of(db, ledger) == {ours.id}
    assert db.get(Transaction, booked.id) is not None
    assert db.get(FinanceSource, theirs.id) is not None


def test_remove_member_rejects_the_owner(db):
    owner = make_user(db, "owner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")

    with pytest.raises(ApiError) as excinfo:
        remove_member(db, ledger, owner.id)

    assert excinfo.value.status_code == 409
    assert excinfo.value.code == ErrorCode.CANNOT_REMOVE_OWNER
    assert role_of(db, ledger, owner) == "owner"


def test_remove_member_rejects_a_non_member(db):
    owner = make_user(db, "owner@example.com")
    stranger = make_user(db, "stranger@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")

    with pytest.raises(ApiError) as excinfo:
        remove_member(db, ledger, stranger.id)

    assert excinfo.value.status_code == 404
    assert excinfo.value.code == ErrorCode.MEMBER_NOT_FOUND


def test_owner_cannot_leave_before_transferring(db):
    owner = make_user(db, "owner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")

    with pytest.raises(ApiError) as excinfo:
        leave(db, ledger, owner)

    assert excinfo.value.status_code == 409
    assert excinfo.value.code == ErrorCode.OWNER_MUST_TRANSFER
    assert role_of(db, ledger, owner) == "owner"


def test_member_can_leave(db):
    owner = make_user(db, "owner@example.com")
    joiner = make_user(db, "joiner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")
    redeem_invite(db, joiner, issue_invite(db, ledger, owner).code)

    leave(db, ledger, joiner)

    assert role_of(db, ledger, joiner) is None
    assert user_ledger_count(db, joiner.id) == 0


def test_former_owner_can_leave_after_transferring(db):
    owner = make_user(db, "owner@example.com")
    joiner = make_user(db, "joiner@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")
    redeem_invite(db, joiner, issue_invite(db, ledger, owner).code)
    transfer_ownership(db, ledger, joiner.id)

    leave(db, ledger, owner)

    assert owners(db, ledger) == [joiner.id]
    assert member_count(db, ledger.id) == 1


def test_leave_a_ledger_one_is_not_in_is_not_found(db):
    owner = make_user(db, "owner@example.com")
    stranger = make_user(db, "stranger@example.com")
    ledger = create_ledger(db, owner, "家庭账本", "CNY")

    with pytest.raises(ApiError) as excinfo:
        leave(db, ledger, stranger)

    assert excinfo.value.status_code == 404
    assert excinfo.value.code == ErrorCode.NOT_FOUND


# ---------------------------------------------------------------------------
# counts (§5.10)
# ---------------------------------------------------------------------------


def test_ledger_counts_only_counts_this_ledger(db):
    user = make_user(db)
    ledger = create_ledger(db, user, "家庭账本", "CNY")
    other = create_ledger(db, user, "另一本", "CNY")

    def add_source(target: Ledger, name: str) -> FinanceSource:
        source = add_account(db, user, name)
        share(db, target, source)
        return source

    # §14.62 f: ``sources`` counts the shares into the ledger; an account the
    # owner never shared is not counted, however many entries sit on it.
    source = add_account(db, user, "招行")
    add_source(ledger, "现金")
    other_source = add_source(other, "别的")
    share(db, ledger, other_source)

    for target, src, count in ((ledger, source, 3), (other, other_source, 1)):
        # ``source`` is not shared anywhere; its owner books on it all the same.
        for _ in range(count):
            db.add(
                Transaction(
                    ledger_id=target.id,
                    source_id=src.id,
                    amount=Decimal("-10.0000"),
                    currency="CNY",
                    occurred_at=NOW.date(),
                    kind="expense",
                    category_l1="food",
                    created_by=user.id,
                    updated_by=user.id,
                    created_at=NOW,
                    updated_at=NOW,
                )
            )
    db.add(
        ImportBatch(
            ledger_id=ledger.id,
            source_id=source.id,
            created_by=user.id,
            source="csv",
            filename="a.csv",
            size_bytes=100,
            skill_version="2026-09-10",
            status="ready",
            row_count=0,
            created_at=NOW,
            updated_at=NOW,
        )
    )
    db.flush()

    assert ledger_counts(db, ledger.id) == {
        "transactions": 3,
        "sources": 2,
        "import_batches": 1,
    }
    assert ledger_counts(db, other.id) == {
        "transactions": 1,
        "sources": 1,
        "import_batches": 0,
    }


def test_counts_are_zero_for_an_unknown_ledger(db):
    assert ledger_counts(db, uuid.uuid4()) == {
        "transactions": 0,
        "sources": 0,
        "import_batches": 0,
    }
    assert member_count(db, uuid.uuid4()) == 0
    assert user_ledger_count(db, uuid.uuid4()) == 0
