"""Tests for pydantic schemas (03-backend-api.md §4.5, §5.1-§5.4, §5.8-§5.19)."""
import datetime as dt
import uuid

import pytest
from pydantic import BaseModel, ValidationError

from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse
from app.schemas.common import ApiModel, ListResponse, UtcDatetime
from app.schemas.ledger import (
    InviteResponse,
    JoinRequest,
    LedgerCounts,
    LedgerCreate,
    LedgerPatch,
    LedgerResponse,
    MemberResponse,
    TransferOwnershipRequest,
)
from app.schemas.user import MePatch, MeResponse


# ---------------------------------------------------------------------------
# §5.1 RegisterRequest
# ---------------------------------------------------------------------------


def test_register_email_is_lowercased():
    req = RegisterRequest(
        email="Alice@Example.COM", password="correct horse", base_currency="cny"
    )
    assert req.email == "alice@example.com"


def test_register_base_currency_uppercased():
    req = RegisterRequest(email="a@example.com", password="correct horse", base_currency="cny")
    assert req.base_currency == "CNY"


def test_register_base_currency_must_match_pattern():
    with pytest.raises(ValidationError):
        RegisterRequest(email="a@example.com", password="correct horse", base_currency="cn1")
    with pytest.raises(ValidationError):
        RegisterRequest(email="a@example.com", password="correct horse", base_currency="cnyy")


def test_register_language_defaults_to_zh():
    req = RegisterRequest(email="a@example.com", password="correct horse", base_currency="cny")
    assert req.language == "zh"


def test_register_language_accepts_en_rejects_other():
    req = RegisterRequest(
        email="a@example.com", password="correct horse", base_currency="cny", language="en"
    )
    assert req.language == "en"
    with pytest.raises(ValidationError):
        RegisterRequest(
            email="a@example.com", password="correct horse", base_currency="cny", language="fr"
        )


def test_register_password_min_length_8():
    with pytest.raises(ValidationError):
        RegisterRequest(email="a@example.com", password="short1", base_currency="cny")
    # exactly 8 chars is accepted
    req = RegisterRequest(email="a@example.com", password="12345678", base_currency="cny")
    assert req.password == "12345678"


def test_register_password_72_utf8_bytes_accepted():
    # '中' is 3 bytes in UTF-8; 24 * 3 = 72 bytes, 24 chars (>= 8).
    password = "中" * 24
    assert len(password.encode("utf-8")) == 72
    req = RegisterRequest(email="a@example.com", password=password, base_currency="cny")
    assert req.password == password


def test_register_password_73_utf8_bytes_rejected():
    password = "中" * 24 + "x"
    assert len(password.encode("utf-8")) == 73
    with pytest.raises(ValidationError):
        RegisterRequest(email="a@example.com", password=password, base_currency="cny")


def test_register_rejects_unknown_field():
    with pytest.raises(ValidationError):
        RegisterRequest(
            email="a@example.com",
            password="correct horse",
            base_currency="cny",
            default_source_id="whatever",
        )


# ---------------------------------------------------------------------------
# §5.2 LoginRequest / TokenResponse
# ---------------------------------------------------------------------------


def test_login_request_requires_email_and_password():
    req = LoginRequest(email="a@example.com", password="whatever")
    assert req.email == "a@example.com"
    with pytest.raises(ValidationError):
        LoginRequest(email="a@example.com")


def test_login_request_rejects_unknown_field():
    with pytest.raises(ValidationError):
        LoginRequest(email="a@example.com", password="x", default_source_id="1")


def test_token_response_defaults_bearer():
    token = TokenResponse(access_token="eyJ...")
    assert token.token_type == "bearer"


# ---------------------------------------------------------------------------
# §5.3 MeResponse
# ---------------------------------------------------------------------------


def test_me_response_builds_from_orm_like_object():
    """ApiModel's ``from_attributes`` config lets MeResponse read an ORM object
    directly, with ``ledger_count`` supplied separately by the caller."""

    class FakeUser:
        id = uuid.uuid4()
        email = "alice@example.com"
        display_name = "Alice"
        base_currency = "CNY"
        language = "zh"
        created_at = dt.datetime(2026, 9, 3, 5, 51, 45, 537326)
        ledger_count = 2

    me = MeResponse.model_validate(FakeUser())
    assert isinstance(me, ApiModel)
    assert me.email == "alice@example.com"
    assert me.ledger_count == 2


def test_me_response_fields_and_ledger_count():
    me = MeResponse(
        id=uuid.uuid4(),
        email="alice@example.com",
        display_name=None,
        base_currency="CNY",
        language=None,
        created_at=dt.datetime(2026, 9, 3, 5, 51, 45, 537326),
        ledger_count=2,
    )
    dumped = me.model_dump(mode="json")
    assert dumped["ledger_count"] == 2
    assert dumped["created_at"] == "2026-09-03T05:51:45.537326Z"
    assert dumped["language"] is None


def test_me_response_rejects_bad_language():
    with pytest.raises(ValidationError):
        MeResponse(
            id=uuid.uuid4(),
            email="a@example.com",
            display_name=None,
            base_currency="CNY",
            language="fr",
            created_at=dt.datetime(2026, 9, 3, 5, 51, 45, 537326),
            ledger_count=0,
        )


# ---------------------------------------------------------------------------
# §5.4 MePatch — exclude_unset and null semantics
# ---------------------------------------------------------------------------


def test_me_patch_exclude_unset_omits_untouched_fields():
    patch = MePatch(display_name="Alice")
    assert patch.model_fields_set == {"display_name"}
    dumped = patch.model_dump(exclude_unset=True)
    assert dumped == {"display_name": "Alice"}


def test_me_patch_base_currency_rejects_explicit_null():
    with pytest.raises(ValidationError):
        MePatch(base_currency=None)


def test_me_patch_base_currency_omitted_is_fine():
    patch = MePatch()
    assert "base_currency" not in patch.model_fields_set
    assert patch.base_currency is None


def test_me_patch_base_currency_uppercased_when_provided():
    patch = MePatch(base_currency="usd")
    assert patch.base_currency == "USD"
    assert "base_currency" in patch.model_fields_set


def test_me_patch_language_explicit_null_means_follow_system():
    patch = MePatch(language=None)
    assert "language" in patch.model_fields_set
    assert patch.language is None


def test_me_patch_language_rejects_unknown_value():
    with pytest.raises(ValidationError):
        MePatch(language="fr")


def test_me_patch_display_name_strips_and_bounds():
    patch = MePatch(display_name="  Alice  ")
    assert patch.display_name == "Alice"
    with pytest.raises(ValidationError):
        MePatch(display_name="x" * 41)
    # 40 chars exactly is fine
    ok = MePatch(display_name="x" * 40)
    assert ok.display_name == "x" * 40


def test_me_patch_display_name_null_or_blank_clears():
    assert MePatch(display_name=None).display_name is None
    assert MePatch(display_name="").display_name is None
    assert MePatch(display_name="   ").display_name is None


def test_me_patch_rejects_unknown_field():
    with pytest.raises(ValidationError):
        MePatch(default_source_id="abc")


# ---------------------------------------------------------------------------
# §5.9/§5.11 LedgerCreate / LedgerPatch
# ---------------------------------------------------------------------------


def test_ledger_create_strips_name_and_rejects_blank():
    lc = LedgerCreate(name="  家庭账本  ")
    assert lc.name == "家庭账本"
    with pytest.raises(ValidationError):
        LedgerCreate(name="   ")


def test_ledger_create_name_length_bounds():
    LedgerCreate(name="x" * 100)
    with pytest.raises(ValidationError):
        LedgerCreate(name="x" * 101)
    with pytest.raises(ValidationError):
        LedgerCreate(name="")


def test_ledger_create_base_currency_optional_and_uppercased():
    lc = LedgerCreate(name="家用")
    assert lc.base_currency is None
    lc2 = LedgerCreate(name="家用", base_currency="cny")
    assert lc2.base_currency == "CNY"


def test_ledger_create_rejects_unknown_field():
    with pytest.raises(ValidationError):
        LedgerCreate(name="家用", extra_field="nope")


def test_ledger_patch_requires_updated_at():
    with pytest.raises(ValidationError):
        LedgerPatch(name="家用")
    lp = LedgerPatch(updated_at=dt.datetime(2026, 9, 3, 5, 51, 45, 600000))
    assert lp.name is None
    assert lp.base_currency is None


def test_ledger_patch_optional_fields_validated_when_present():
    lp = LedgerPatch(
        updated_at=dt.datetime(2026, 9, 3, 5, 51, 45, 600000),
        name="  家用  ",
        base_currency="usd",
    )
    assert lp.name == "家用"
    assert lp.base_currency == "USD"
    with pytest.raises(ValidationError):
        LedgerPatch(
            updated_at=dt.datetime(2026, 9, 3, 5, 51, 45, 600000), base_currency="usdd"
        )


# ---------------------------------------------------------------------------
# LedgerResponse / LedgerCounts / MemberResponse / InviteResponse
# ---------------------------------------------------------------------------


def _sample_ledger_kwargs(**overrides):
    base = dict(
        id=uuid.uuid4(),
        name="我的账本",
        base_currency="CNY",
        role="owner",
        member_count=2,
        created_by=uuid.uuid4(),
        created_at=dt.datetime(2026, 9, 3, 5, 51, 45, 600000),
        updated_at=dt.datetime(2026, 9, 3, 5, 51, 45, 600000),
    )
    base.update(overrides)
    return base


def test_ledger_response_counts_defaults_to_none():
    resp = LedgerResponse(**_sample_ledger_kwargs())
    assert resp.counts is None
    assert "counts" not in resp.model_dump(exclude_none=True)


def test_ledger_response_counts_present_for_get_single_and_join():
    resp = LedgerResponse(
        **_sample_ledger_kwargs(
            counts=LedgerCounts(transactions=1284, sources=6, import_batches=9)
        )
    )
    assert resp.counts is not None
    assert resp.counts.transactions == 1284


def test_ledger_response_role_restricted_to_owner_or_member():
    with pytest.raises(ValidationError):
        LedgerResponse(**_sample_ledger_kwargs(role="admin"))


def test_member_response_fields():
    m = MemberResponse(
        user_id=uuid.uuid4(),
        email="bob@example.com",
        display_name=None,
        role="member",
        joined_at=dt.datetime(2026, 9, 5, 9, 10, 0),
        is_me=False,
    )
    dumped = m.model_dump(mode="json")
    assert dumped["joined_at"] == "2026-09-05T09:10:00.000000Z"
    assert dumped["is_me"] is False


def test_invite_response_fields():
    inv = InviteResponse(
        id=uuid.uuid4(),
        code="418302",
        ledger_id=uuid.uuid4(),
        ledger_name="我的账本",
        expires_at=dt.datetime(2026, 9, 9, 4, 32, 10),
        created_at=dt.datetime(2026, 9, 9, 4, 22, 10),
    )
    assert inv.code == "418302"


def test_join_request_code_pattern():
    JoinRequest(code="418302")
    with pytest.raises(ValidationError):
        JoinRequest(code="12345")
    with pytest.raises(ValidationError):
        JoinRequest(code="12345a")


def test_join_request_rejects_unknown_field():
    with pytest.raises(ValidationError):
        JoinRequest(code="418302", ledger_id="whatever")


def test_transfer_ownership_request_requires_uuid():
    req = TransferOwnershipRequest(to_user_id=uuid.uuid4())
    assert isinstance(req.to_user_id, uuid.UUID)
    with pytest.raises(ValidationError):
        TransferOwnershipRequest(to_user_id="not-a-uuid")


# ---------------------------------------------------------------------------
# §4.5 UtcDatetime
# ---------------------------------------------------------------------------


class _Holder(BaseModel):
    at: UtcDatetime


def test_utc_datetime_serializes_with_z_and_microseconds():
    holder = _Holder(at=dt.datetime(2026, 9, 8, 11, 20, 31, 442000))
    assert holder.model_dump(mode="json")["at"] == "2026-09-08T11:20:31.442000Z"


def test_utc_datetime_serializes_zero_microseconds_padded():
    holder = _Holder(at=dt.datetime(2026, 9, 8, 11, 20, 31))
    assert holder.model_dump(mode="json")["at"] == "2026-09-08T11:20:31.000000Z"


def test_utc_datetime_parses_z_suffix():
    holder = _Holder.model_validate({"at": "2026-09-08T11:20:31.442000Z"})
    assert holder.at == dt.datetime(2026, 9, 8, 11, 20, 31, 442000)


def test_utc_datetime_parses_offset_and_converts_to_utc():
    # +08:00 03:20:31.442 == UTC 19:20:31.442 the previous day.
    holder = _Holder.model_validate({"at": "2026-09-08T03:20:31.442000+08:00"})
    assert holder.at == dt.datetime(2026, 9, 7, 19, 20, 31, 442000)
    assert holder.at.tzinfo is None


def test_utc_datetime_parses_naive_as_already_utc():
    holder = _Holder.model_validate({"at": "2026-09-08T11:20:31.442000"})
    assert holder.at == dt.datetime(2026, 9, 8, 11, 20, 31, 442000)


def test_utc_datetime_round_trip():
    original = "2026-09-08T11:20:31.442000Z"
    holder = _Holder.model_validate({"at": original})
    assert holder.model_dump(mode="json")["at"] == original


# ---------------------------------------------------------------------------
# ListResponse
# ---------------------------------------------------------------------------


def test_list_response_items_and_total():
    lst = ListResponse[MemberResponse](
        items=[
            MemberResponse(
                user_id=uuid.uuid4(),
                email="a@example.com",
                display_name=None,
                role="owner",
                joined_at=dt.datetime(2026, 9, 3, 5, 51, 45, 600000),
                is_me=True,
            )
        ],
        total=1,
    )
    dumped = lst.model_dump(mode="json")
    assert dumped["total"] == 1
    assert len(dumped["items"]) == 1
    assert dumped["items"][0]["joined_at"] == "2026-09-03T05:51:45.600000Z"
