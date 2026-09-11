"""Member, invite and join endpoints (03-backend-api.md §5.13-§5.19, §10.2).

The invite table only ever holds live codes (decision §14.29), so most cases
here are about a row being *gone*: used, revoked and expired all look the same
from outside — ``400 invite_invalid``.
"""
import datetime as dt
import uuid

from sqlalchemy import func, select

from app.core import ratelimit
from app.core.clock import utcnow
from app.core.config import settings
from app.models.ledger import Ledger, LedgerInvite, LedgerMember
from app.services.ledger_service import INVITE_TTL


def issue_code(client, ledger, owner, auth_headers) -> str:
    """Draw a code through the API and return it (§5.17)."""
    response = client.post(
        f"/api/v1/ledgers/{ledger.id}/invites", headers=auth_headers(owner)
    )
    assert response.status_code == 201, response.text
    return response.json()["code"]


def plant_invite(db, ledger, owner, code: str, *, expires_in: dt.timedelta) -> LedgerInvite:
    """Insert a code straight into the table, so its expiry can be chosen."""
    now = utcnow()
    invite = LedgerInvite(
        ledger_id=ledger.id,
        code=code,
        created_by=owner.id,
        created_at=now - dt.timedelta(minutes=30),
        expires_at=now + expires_in,
    )
    db.add(invite)
    db.flush()
    return invite


# ---------------------------------------------------------------------------
# §5.17 POST /ledgers/{id}/invites
# ---------------------------------------------------------------------------


def test_owner_draws_a_six_digit_code(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    ledger = ledger_factory(alice, name="家庭账本")
    db.commit()

    response = client.post(
        f"/api/v1/ledgers/{ledger.id}/invites", headers=auth_headers(alice)
    )

    assert response.status_code == 201
    body = response.json()
    assert body["code"].isdigit() and len(body["code"]) == 6
    assert body["ledger_id"] == str(ledger.id)
    assert body["ledger_name"] == "家庭账本"

    invite = db.execute(select(LedgerInvite)).scalar_one()
    assert invite.code == body["code"]
    assert invite.created_by == alice.id
    assert invite.expires_at - invite.created_at == INVITE_TTL


def test_a_plain_member_cannot_draw_a_code(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    bob = user_factory()
    ledger = ledger_factory(alice, members=[bob])
    db.commit()

    response = client.post(
        f"/api/v1/ledgers/{ledger.id}/invites", headers=auth_headers(bob)
    )

    assert response.status_code == 403
    assert response.json()["code"] == "not_owner"
    assert db.execute(select(func.count()).select_from(LedgerInvite)).scalar_one() == 0


def test_drawing_a_code_sweeps_this_ledgers_expired_ones(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    ledger = ledger_factory(alice)
    other_owner = user_factory()
    other = ledger_factory(other_owner, name="别人的")
    plant_invite(db, ledger, alice, "111111", expires_in=-dt.timedelta(minutes=1))
    plant_invite(db, other, other_owner, "222222", expires_in=-dt.timedelta(minutes=1))
    db.commit()

    fresh = issue_code(client, ledger, alice, auth_headers)

    codes = set(db.execute(select(LedgerInvite.code)).scalars())
    assert "111111" not in codes           # swept, it belonged to this ledger
    assert "222222" in codes               # another ledger's rows are left alone
    assert fresh in codes


def test_a_full_ledger_cannot_invite(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    crowd = [user_factory() for _ in range(settings.MAX_MEMBERS_PER_LEDGER - 1)]
    ledger = ledger_factory(alice, members=crowd)
    db.commit()

    response = client.post(
        f"/api/v1/ledgers/{ledger.id}/invites", headers=auth_headers(alice)
    )

    assert response.status_code == 409
    assert response.json()["code"] == "member_limit_reached"


# ---------------------------------------------------------------------------
# §5.19 POST /ledgers/join
# ---------------------------------------------------------------------------


def test_join_with_a_fresh_code(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    bob = user_factory()
    ledger = ledger_factory(alice, name="家庭账本")
    db.commit()
    code = issue_code(client, ledger, alice, auth_headers)

    response = client.post(
        "/api/v1/ledgers/join", json={"code": code}, headers=auth_headers(bob)
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(ledger.id)
    assert body["role"] == "member"
    assert body["member_count"] == 2
    assert body["counts"] == {"transactions": 0, "sources": 0, "import_batches": 0}

    membership = db.execute(
        select(LedgerMember).where(
            LedgerMember.ledger_id == ledger.id, LedgerMember.user_id == bob.id
        )
    ).scalar_one()
    assert membership.role == "member"
    # Single use: the row is gone with the join.
    assert db.execute(select(func.count()).select_from(LedgerInvite)).scalar_one() == 0


def test_a_code_works_only_once(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    bob = user_factory()
    carol = user_factory()
    ledger = ledger_factory(alice)
    db.commit()
    code = issue_code(client, ledger, alice, auth_headers)

    assert (
        client.post(
            "/api/v1/ledgers/join", json={"code": code}, headers=auth_headers(bob)
        ).status_code
        == 200
    )
    second = client.post(
        "/api/v1/ledgers/join", json={"code": code}, headers=auth_headers(carol)
    )

    assert second.status_code == 400
    assert second.json()["code"] == "invite_invalid"
    assert (
        db.execute(
            select(func.count())
            .select_from(LedgerMember)
            .where(LedgerMember.ledger_id == ledger.id)
        ).scalar_one()
        == 2
    )


def test_an_expired_code_is_refused(
    client, db, user_factory, auth_headers, ledger_factory, fresh_session
):
    alice = user_factory()
    bob = user_factory()
    ledger = ledger_factory(alice)
    db.commit()
    code = issue_code(client, ledger, alice, auth_headers)
    invite = db.execute(select(LedgerInvite)).scalar_one()
    # Age the row: the CHECK wants expires_at > created_at, so both move back.
    invite.created_at = utcnow() - dt.timedelta(minutes=30)
    invite.expires_at = utcnow() - dt.timedelta(seconds=1)
    db.commit()

    response = client.post(
        "/api/v1/ledgers/join", json={"code": code}, headers=auth_headers(bob)
    )

    assert response.status_code == 400
    assert response.json()["code"] == "invite_invalid"
    # The stale row is swept on the way past (decision §14.29) — and the sweep
    # is *committed*, so it survives the 400 the request ends with. Rolling the
    # request's session back first is what makes the next assertion mean that:
    # an uncommitted delete would come back here.
    db.rollback()
    assert (
        fresh_session().execute(select(func.count()).select_from(LedgerInvite)).scalar_one()
        == 0
    )


def test_a_revoked_code_no_longer_joins(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    bob = user_factory()
    ledger = ledger_factory(alice)
    db.commit()
    code = issue_code(client, ledger, alice, auth_headers)

    revoked = client.delete(
        f"/api/v1/ledgers/{ledger.id}/invites/{code}", headers=auth_headers(alice)
    )
    joined = client.post(
        "/api/v1/ledgers/join", json={"code": code}, headers=auth_headers(bob)
    )

    assert revoked.status_code == 204
    assert revoked.content == b""
    assert joined.status_code == 400
    assert joined.json()["code"] == "invite_invalid"


def test_revoking_is_a_one_way_door(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    ledger = ledger_factory(alice)
    db.commit()
    code = issue_code(client, ledger, alice, auth_headers)

    assert (
        client.delete(
            f"/api/v1/ledgers/{ledger.id}/invites/{code}", headers=auth_headers(alice)
        ).status_code
        == 204
    )
    again = client.delete(
        f"/api/v1/ledgers/{ledger.id}/invites/{code}", headers=auth_headers(alice)
    )

    assert again.status_code == 404
    assert again.json()["code"] == "not_found"


def test_revoking_an_unknown_code_is_404(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    ledger = ledger_factory(alice)
    db.commit()

    response = client.delete(
        f"/api/v1/ledgers/{ledger.id}/invites/000000", headers=auth_headers(alice)
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_revoking_another_ledgers_code_is_404(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    mine = ledger_factory(alice, name="我的")
    theirs_owner = user_factory()
    theirs = ledger_factory(theirs_owner, name="别人的")
    plant_invite(db, theirs, theirs_owner, "654321", expires_in=INVITE_TTL)
    db.commit()

    response = client.delete(
        f"/api/v1/ledgers/{mine.id}/invites/654321", headers=auth_headers(alice)
    )

    assert response.status_code == 404
    assert db.execute(select(func.count()).select_from(LedgerInvite)).scalar_one() == 1


def test_a_member_cannot_revoke(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    bob = user_factory()
    ledger = ledger_factory(alice, members=[bob])
    db.commit()
    code = issue_code(client, ledger, alice, auth_headers)

    response = client.delete(
        f"/api/v1/ledgers/{ledger.id}/invites/{code}", headers=auth_headers(bob)
    )

    assert response.status_code == 403
    assert response.json()["code"] == "not_owner"
    assert db.execute(select(func.count()).select_from(LedgerInvite)).scalar_one() == 1


def test_a_malformed_code_is_422_on_both_ends(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    ledger = ledger_factory(alice)
    db.commit()

    revoke = client.delete(
        f"/api/v1/ledgers/{ledger.id}/invites/12a456", headers=auth_headers(alice)
    )
    join = client.post(
        "/api/v1/ledgers/join", json={"code": "12345"}, headers=auth_headers(alice)
    )

    assert revoke.status_code == 422
    assert revoke.json()["code"] == "validation_error"
    assert join.status_code == 422
    assert join.json()["code"] == "validation_error"


def test_joining_a_ledger_you_are_already_in(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    ledger = ledger_factory(alice)
    db.commit()
    code = issue_code(client, ledger, alice, auth_headers)

    response = client.post(
        "/api/v1/ledgers/join", json={"code": code}, headers=auth_headers(alice)
    )

    assert response.status_code == 409
    assert response.json()["code"] == "already_member"
    # A refused join does not burn the code.
    assert db.execute(select(func.count()).select_from(LedgerInvite)).scalar_one() == 1


def test_joining_a_full_ledger(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    crowd = [user_factory() for _ in range(settings.MAX_MEMBERS_PER_LEDGER - 1)]
    ledger = ledger_factory(alice, members=crowd)
    latecomer = user_factory()
    # The ledger filled up after the code went out, so it has to be planted.
    plant_invite(db, ledger, alice, "424242", expires_in=INVITE_TTL)
    db.commit()

    response = client.post(
        "/api/v1/ledgers/join", json={"code": "424242"}, headers=auth_headers(latecomer)
    )

    assert response.status_code == 409
    assert response.json()["code"] == "member_limit_reached"


def test_joining_an_eleventh_ledger(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    busy = user_factory()
    for index in range(settings.MAX_LEDGERS_PER_USER):
        ledger_factory(busy, name=f"账本 {index}")
    ledger = ledger_factory(alice, name="第 11 本")
    db.commit()
    code = issue_code(client, ledger, alice, auth_headers)

    response = client.post(
        "/api/v1/ledgers/join", json={"code": code}, headers=auth_headers(busy)
    )

    assert response.status_code == 409
    assert response.json()["code"] == "ledger_limit_reached"


# ---------------------------------------------------------------------------
# §8.2 the join bucket is global, and 429 never burns a code
# ---------------------------------------------------------------------------


def test_join_is_globally_rate_limited_without_consuming_codes(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    ledger = ledger_factory(alice, name="家庭账本")
    joiners = [user_factory() for _ in range(5)]
    db.commit()
    codes = [issue_code(client, ledger, alice, auth_headers) for _ in range(5)]
    assert len(set(codes)) == 5

    responses = [
        client.post(
            "/api/v1/ledgers/join", json={"code": code}, headers=auth_headers(joiner)
        )
        for code, joiner in zip(codes, joiners)
    ]

    # Capacity 3 refilling one token per second: the burst gets three through,
    # and the key is "global", so a different user does not get a fresh bucket.
    assert [response.status_code for response in responses] == [200, 200, 200, 429, 429]
    for throttled in responses[3:]:
        assert throttled.json()["code"] == "invite_rate_limited"
        assert int(throttled.headers["Retry-After"]) >= 1

    # The throttled attempts never reached the database: their codes are alive.
    live = set(db.execute(select(LedgerInvite.code)).scalars())
    assert live == set(codes[3:])

    ratelimit.reset_all()
    retried = client.post(
        "/api/v1/ledgers/join",
        json={"code": codes[3]},
        headers=auth_headers(joiners[3]),
    )

    assert retried.status_code == 200
    assert retried.json()["member_count"] == 5


def test_the_join_bucket_is_sized_from_the_configured_qps(
    client, db, user_factory, auth_headers, ledger_factory, monkeypatch
):
    """§8.2: ``RATE_LIMIT_JOIN_QPS`` is what sets the refill rate, not a constant.

    Time is faked so the case does not sleep: every ``check`` sees the clock 50
    milliseconds further along. At the default 1 QPS that refills 0.05 tokens
    per attempt, so the burst of three is spent and the fourth is a 429; at 100
    QPS the same 50 milliseconds refill the whole bucket and nothing is
    throttled. The codes are deliberately unknown — the limiter runs before the
    code is looked at, so a 400 proves the request got past it.
    """
    alice = user_factory()
    ledger_factory(alice)
    db.commit()

    def fake_clock(step=[0.0]):
        step[0] += 0.05
        return step[0]

    monkeypatch.setattr(ratelimit, "clock", fake_clock)

    def statuses() -> list[int]:
        ratelimit.reset_all()
        return [
            client.post(
                "/api/v1/ledgers/join",
                json={"code": f"{index:06d}"},
                headers=auth_headers(alice),
            ).status_code
            for index in range(10)
        ]

    assert 429 in statuses()

    monkeypatch.setattr(settings, "RATE_LIMIT_JOIN_QPS", 100)

    assert statuses() == [400] * 10


# ---------------------------------------------------------------------------
# §5.13 GET /ledgers/{id}/members
# ---------------------------------------------------------------------------


def test_member_list_puts_the_owner_first(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory(email="alice@example.test", display_name="Alice")
    bob = user_factory(email="bob@example.test")
    carol = user_factory(email="carol@example.test")
    ledger = ledger_factory(alice, members=[bob, carol])
    # Bob joined last, so joined_at decides the order behind the owner.
    now = utcnow()
    for user, joined in ((bob, now), (carol, now - dt.timedelta(days=1))):
        membership = db.execute(
            select(LedgerMember).where(
                LedgerMember.ledger_id == ledger.id, LedgerMember.user_id == user.id
            )
        ).scalar_one()
        membership.joined_at = joined
    db.commit()

    body = client.get(
        f"/api/v1/ledgers/{ledger.id}/members", headers=auth_headers(carol)
    ).json()

    assert body["total"] == 3
    assert [item["email"] for item in body["items"]] == [
        "alice@example.test",
        "carol@example.test",
        "bob@example.test",
    ]
    assert [item["role"] for item in body["items"]] == ["owner", "member", "member"]
    assert [item["is_me"] for item in body["items"]] == [False, True, False]
    assert body["items"][0]["display_name"] == "Alice"
    assert body["items"][1]["display_name"] is None


# ---------------------------------------------------------------------------
# §5.14 DELETE /ledgers/{id}/members/{user_id}
# ---------------------------------------------------------------------------


def test_owner_removes_a_member(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    bob = user_factory()
    ledger = ledger_factory(alice, members=[bob])
    db.commit()

    response = client.delete(
        f"/api/v1/ledgers/{ledger.id}/members/{bob.id}", headers=auth_headers(alice)
    )

    assert response.status_code == 204
    assert response.content == b""
    assert (
        db.execute(
            select(func.count())
            .select_from(LedgerMember)
            .where(LedgerMember.ledger_id == ledger.id)
        ).scalar_one()
        == 1
    )
    # The ledger is now invisible to Bob (§3.3).
    assert (
        client.get(f"/api/v1/ledgers/{ledger.id}", headers=auth_headers(bob)).status_code
        == 404
    )


def test_the_owner_cannot_be_removed(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    bob = user_factory()
    ledger = ledger_factory(alice, members=[bob])
    db.commit()

    response = client.delete(
        f"/api/v1/ledgers/{ledger.id}/members/{alice.id}", headers=auth_headers(alice)
    )

    assert response.status_code == 409
    assert response.json()["code"] == "cannot_remove_owner"
    assert (
        db.execute(
            select(func.count())
            .select_from(LedgerMember)
            .where(LedgerMember.ledger_id == ledger.id)
        ).scalar_one()
        == 2
    )


def test_removing_someone_who_is_not_a_member(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    stranger = user_factory()
    ledger = ledger_factory(alice)
    db.commit()

    response = client.delete(
        f"/api/v1/ledgers/{ledger.id}/members/{stranger.id}", headers=auth_headers(alice)
    )

    assert response.status_code == 404
    assert response.json()["code"] == "member_not_found"


def test_a_member_cannot_remove_anyone(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    bob = user_factory()
    carol = user_factory()
    ledger = ledger_factory(alice, members=[bob, carol])
    db.commit()

    response = client.delete(
        f"/api/v1/ledgers/{ledger.id}/members/{carol.id}", headers=auth_headers(bob)
    )

    assert response.status_code == 403
    assert response.json()["code"] == "not_owner"


# ---------------------------------------------------------------------------
# §5.15 POST /ledgers/{id}/leave
# ---------------------------------------------------------------------------


def test_a_member_leaves_and_the_ledger_disappears(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    bob = user_factory()
    ledger = ledger_factory(alice, members=[bob])
    db.commit()

    response = client.post(f"/api/v1/ledgers/{ledger.id}/leave", headers=auth_headers(bob))

    assert response.status_code == 204
    assert (
        client.get(f"/api/v1/ledgers/{ledger.id}", headers=auth_headers(bob)).status_code
        == 404
    )
    assert client.get("/api/v1/ledgers", headers=auth_headers(bob)).json()["total"] == 0
    # The ledger itself and its owner are untouched.
    assert db.get(Ledger, ledger.id) is not None
    assert (
        client.get(f"/api/v1/ledgers/{ledger.id}", headers=auth_headers(alice)).json()[
            "member_count"
        ]
        == 1
    )


def test_the_owner_must_transfer_before_leaving(
    client, db, user_factory, auth_headers, ledger_factory
):
    alice = user_factory()
    bob = user_factory()
    ledger = ledger_factory(alice, members=[bob])
    db.commit()

    response = client.post(
        f"/api/v1/ledgers/{ledger.id}/leave", headers=auth_headers(alice)
    )

    assert response.status_code == 409
    assert response.json()["code"] == "owner_must_transfer"
    assert (
        db.execute(
            select(func.count())
            .select_from(LedgerMember)
            .where(LedgerMember.ledger_id == ledger.id)
        ).scalar_one()
        == 2
    )


# ---------------------------------------------------------------------------
# §5.16 POST /ledgers/{id}/transfer-ownership
# ---------------------------------------------------------------------------


def test_transfer_swaps_the_two_roles(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory(email="alice@example.test")
    bob = user_factory(email="bob@example.test")
    ledger = ledger_factory(alice, members=[bob])
    db.commit()

    response = client.post(
        f"/api/v1/ledgers/{ledger.id}/transfer-ownership",
        json={"to_user_id": str(bob.id)},
        headers=auth_headers(alice),
    )

    assert response.status_code == 200
    roles = {item["email"]: item["role"] for item in response.json()["items"]}
    assert roles == {"alice@example.test": "member", "bob@example.test": "owner"}

    # The former owner is a plain member from this moment on.
    demoted = client.post(
        f"/api/v1/ledgers/{ledger.id}/invites", headers=auth_headers(alice)
    )
    assert demoted.status_code == 403
    assert demoted.json()["code"] == "not_owner"
    assert (
        client.post(
            f"/api/v1/ledgers/{ledger.id}/invites", headers=auth_headers(bob)
        ).status_code
        == 201
    )
    # ... and can now leave on their own.
    assert (
        client.post(
            f"/api/v1/ledgers/{ledger.id}/leave", headers=auth_headers(alice)
        ).status_code
        == 204
    )


def test_transfer_to_a_non_member(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    stranger = user_factory()
    ledger = ledger_factory(alice)
    db.commit()

    response = client.post(
        f"/api/v1/ledgers/{ledger.id}/transfer-ownership",
        json={"to_user_id": str(stranger.id)},
        headers=auth_headers(alice),
    )

    assert response.status_code == 404
    assert response.json()["code"] == "member_not_found"


def test_transfer_to_yourself(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    bob = user_factory()
    ledger = ledger_factory(alice, members=[bob])
    db.commit()

    response = client.post(
        f"/api/v1/ledgers/{ledger.id}/transfer-ownership",
        json={"to_user_id": str(alice.id)},
        headers=auth_headers(alice),
    )

    assert response.status_code == 400
    assert response.json()["code"] == "validation_error"
    membership = db.execute(
        select(LedgerMember).where(
            LedgerMember.ledger_id == ledger.id, LedgerMember.user_id == alice.id
        )
    ).scalar_one()
    assert membership.role == "owner"


def test_a_member_cannot_transfer(client, db, user_factory, auth_headers, ledger_factory):
    alice = user_factory()
    bob = user_factory()
    ledger = ledger_factory(alice, members=[bob])
    db.commit()

    response = client.post(
        f"/api/v1/ledgers/{ledger.id}/transfer-ownership",
        json={"to_user_id": str(bob.id)},
        headers=auth_headers(bob),
    )

    assert response.status_code == 403
    assert response.json()["code"] == "not_owner"


def test_join_of_an_unknown_code(client, db, user_factory, auth_headers):
    alice = user_factory()
    db.commit()

    response = client.post(
        "/api/v1/ledgers/join", json={"code": "999999"}, headers=auth_headers(alice)
    )

    assert response.status_code == 400
    assert response.json()["code"] == "invite_invalid"
    assert db.execute(select(func.count()).select_from(LedgerMember)).scalar_one() == 0


def test_join_does_not_leak_another_ledgers_membership(
    client, db, user_factory, auth_headers, ledger_factory
):
    """A code drawn for one ledger joins that ledger and no other."""
    alice = user_factory()
    bob = user_factory()
    joiner = user_factory()
    first = ledger_factory(alice, name="第一本")
    second = ledger_factory(bob, name="第二本")
    db.commit()
    code = issue_code(client, second, bob, auth_headers)

    body = client.post(
        "/api/v1/ledgers/join", json={"code": code}, headers=auth_headers(joiner)
    ).json()

    assert body["id"] == str(second.id)
    assert (
        db.execute(
            select(func.count())
            .select_from(LedgerMember)
            .where(LedgerMember.ledger_id == first.id)
        ).scalar_one()
        == 1
    )


def test_unknown_ledger_id_on_invite_endpoints(client, db, user_factory, auth_headers):
    alice = user_factory()
    db.commit()
    missing = uuid.uuid4()

    created = client.post(f"/api/v1/ledgers/{missing}/invites", headers=auth_headers(alice))
    revoked = client.delete(
        f"/api/v1/ledgers/{missing}/invites/123456", headers=auth_headers(alice)
    )

    assert created.status_code == 404 and created.json()["code"] == "not_found"
    assert revoked.status_code == 404 and revoked.json()["code"] == "not_found"
