"""Personal account endpoints ``/sources*`` (03-backend-api.md §5.20-§5.24, §10.2).

Accounts belong to people (decision §14.62): every case here talks to
``/api/v1/sources`` as the owner, and somebody else's account is a 404 even
when it is shared into a ledger the caller belongs to. Sharing itself and the
per-ledger list live in ``test_source_sharing_api.py``.

Everything goes through HTTP: the ``client`` fixture hands the app the very
session the case reads from, so an assertion right after a request sees what
the endpoint committed.

The fake Frankfurter of ``conftest.py`` quotes one USD at 7.2 CNY and 0.92
EUR, which makes EUR -> CNY ``7.2 / 0.92`` — :data:`EUR_TO_CNY` below, rounded
to the eight decimals §4.5 gives a rate. Expected balances are built from that
constant rather than copied from a run, so a change in the arithmetic shows up
as a failing assertion instead of a silently updated literal.
"""
import datetime as dt
import uuid
from decimal import ROUND_HALF_UP, Decimal

import httpx
import pytest
from sqlalchemy import select

from app.core.clock import utcnow
from app.models.finance_source import FinanceSource
from app.models.import_batch import ImportBatch
from app.models.ledger_source import LedgerSource
from app.models.transaction import Transaction
from tests.conftest import FAKE_RATE_DAY

# One EUR in CNY, quantized the way §4.5 quantizes a rate.
EUR_TO_CNY = (Decimal("7.2") / Decimal("0.92")).quantize(
    Decimal("0.00000001"), rounding=ROUND_HALF_UP
)


def money(value: Decimal | str) -> str:
    """The 4 decimal string every money field is serialized as (§4.5)."""
    return str(Decimal(value).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))


def in_cny(amount: str) -> Decimal:
    """``amount`` EUR converted to CNY the way ``fx`` converts it."""
    return (Decimal(amount) * EUR_TO_CNY).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP
    )


URL = "/api/v1/sources"


@pytest.fixture()
def world(user_factory, ledger_factory, auth_headers):
    """An owner (CNY), a member and a CNY ledger the two of them share.

    ``source_factory(world.ledger, ...)`` makes an account owned by
    ``world.owner`` and shared into ``world.ledger``.
    """

    class World:
        pass

    world = World()
    world.owner = user_factory(base_currency="CNY")
    world.member = user_factory()
    world.ledger = ledger_factory(world.owner, base_currency="CNY", members=[world.member])
    world.headers = auth_headers(world.owner)
    world.member_headers = auth_headers(world.member)
    world.url = URL
    return world


def item_by_name(payload: dict, name: str) -> dict:
    return next(item for item in payload["items"] if item["name"] == name)


# ---------------------------------------------------------------------------
# §5.20 GET /sources
# ---------------------------------------------------------------------------


def test_balance_sums_opening_balance_and_every_transaction(
    client, world, source_factory, transaction_factory, pair_factory
):
    """``balance`` = opening + Σ transactions converted to the account currency.

    The account is in CNY and carries a same-currency expense, a EUR expense
    that has to be converted on its own ``occurred_at`` (decision §14.2, §8),
    and one leg of a one-leg transfer — which counts like anything else
    (§5.20).
    """
    checking = source_factory(
        world.ledger, name="招商 储蓄卡", type="checking", opening_balance=Decimal("1000")
    )
    other = source_factory(world.ledger, name="现金", type="cash")
    transaction_factory(world.ledger, checking, amount=Decimal("-200.0000"))
    transaction_factory(
        world.ledger, checking, amount=Decimal("-10.0000"), currency="EUR"
    )
    # A one-leg transfer (no pair) still moves money out of the account.
    transaction_factory(
        world.ledger,
        checking,
        kind="transfer",
        amount=Decimal("-50.0000"),
        counterparty="家人",
    )
    # The other leg of a two-leg transfer lands on its own account only.
    pair_factory(world.ledger, checking, other, amount_out=Decimal("-30.0000"))

    response = client.get(world.url, headers=world.headers)
    assert response.status_code == 200, response.text

    row = item_by_name(response.json(), "招商 储蓄卡")
    expected = Decimal("1000") - Decimal("200") + in_cny("-10") - Decimal("50") - Decimal("30")
    assert row["balance"] == money(expected)
    assert row["rate_missing_count"] == 0
    # Same currency as the ledger: rate 1, quoted for today (§5.20).
    assert row["balance_base"] == money(expected)
    assert row["balance_rate"] == "1.00000000"
    assert row["balance_rate_date"] == utcnow().date().isoformat()

    assert item_by_name(response.json(), "现金")["balance"] == money(Decimal("30"))


def test_balance_base_uses_the_latest_rate_while_rows_use_their_own_day(
    client, world, source_factory, transaction_factory
):
    """A foreign-currency account: balance in its own currency, base at latest."""
    eur = source_factory(
        world.ledger,
        name="Revolut EUR",
        type="other",
        currency="EUR",
        opening_balance=Decimal("100"),
    )
    transaction_factory(
        world.ledger,
        eur,
        amount=Decimal("-45.5000"),
        currency="EUR",
        occurred_at=dt.date(2026, 9, 3),
    )

    row = item_by_name(client.get(world.url, headers=world.headers).json(), "Revolut EUR")

    assert row["balance"] == money(Decimal("54.5"))            # opening + the EUR row
    assert row["balance_base"] == money(in_cny("54.5"))        # latest rate, to CNY
    assert row["balance_rate"] == str(EUR_TO_CNY)
    assert row["balance_rate_date"] == FAKE_RATE_DAY


def test_totals_cover_the_active_accounts_only(
    client, world, source_factory, transaction_factory
):
    """§14.50: assets + liabilities = net worth, and archived counts for none of it."""
    checking = source_factory(
        world.ledger, name="储蓄卡", type="checking", opening_balance=Decimal("1000")
    )
    source_factory(
        world.ledger, name="信用卡", type="credit", opening_balance=Decimal("-2300")
    )
    source_factory(
        world.ledger,
        name="旧欧元户",
        type="other",
        currency="EUR",
        opening_balance=Decimal("100"),
        archived=True,
    )
    transaction_factory(world.ledger, checking, amount=Decimal("-100.0000"))

    payload = client.get(
        world.url, params={"include_archived": "true"}, headers=world.headers
    ).json()

    assert payload["base_currency"] == "CNY"
    assert payload["total"] == 3
    assert payload["assets"] == money(Decimal("900"))
    assert payload["liabilities"] == money(Decimal("-2300"))
    assert payload["net_worth"] == money(Decimal("-1400"))
    # The archived account is in the list, with a balance, and in none of the totals.
    assert item_by_name(payload, "旧欧元户")["balance"] == money(Decimal("100"))


def test_include_archived_filters_and_the_order_is_archived_type_name(
    client, world, source_factory
):
    """Default hides archived; ``archived ASC, type ASC, name ASC`` otherwise."""
    source_factory(world.ledger, name="Zebra 现金", type="cash")
    source_factory(world.ledger, name="Alpha 现金", type="cash")
    source_factory(world.ledger, name="Beta 储蓄", type="checking")
    source_factory(world.ledger, name="Alpha 信用", type="credit")
    source_factory(world.ledger, name="Old 现金", type="cash", archived=True)

    active = client.get(world.url, headers=world.headers).json()
    assert [item["name"] for item in active["items"]] == [
        "Alpha 现金",
        "Zebra 现金",
        "Beta 储蓄",
        "Alpha 信用",
    ]
    assert active["total"] == 4

    everything = client.get(
        world.url, params={"include_archived": "true"}, headers=world.headers
    ).json()
    assert [item["name"] for item in everything["items"]] == [
        "Alpha 现金",
        "Zebra 现金",
        "Beta 储蓄",
        "Alpha 信用",
        "Old 现金",
    ]


def test_an_unreachable_upstream_nulls_the_base_figures_but_still_answers_200(
    client, world, source_factory, monkeypatch
):
    """§5.20's fallback branch: ``balance`` survives, the base figures do not."""
    from app.services import fx

    source_factory(
        world.ledger,
        name="Revolut EUR",
        type="other",
        currency="EUR",
        opening_balance=Decimal("100"),
    )

    dead = httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(503)),
        base_url="https://frankfurter.test/v1",
    )
    monkeypatch.setattr(fx, "HTTP_RETRY_ATTEMPTS", 1)
    fx.reset_state()
    monkeypatch.setattr(fx, "client_factory", lambda: dead)
    try:
        response = client.get(world.url, headers=world.headers)
    finally:
        dead.close()
        fx.reset_state()

    assert response.status_code == 200, response.text
    payload = response.json()
    row = item_by_name(payload, "Revolut EUR")
    assert row["balance"] == money(Decimal("100"))
    assert row["balance_base"] is None
    assert row["balance_rate"] is None
    assert row["balance_rate_date"] is None
    assert payload["assets"] is None
    assert payload["liabilities"] is None
    assert payload["net_worth"] is None


def test_a_currency_with_no_rate_at_all_is_excluded_and_counted_once(
    client, world, source_factory, transaction_factory
):
    """One account's row in an unconvertible currency: excluded, counted, isolated (§6.3).

    The fake Frankfurter of ``conftest.py`` (``FAKE_RATES_PER_USD``) does not
    know AUD, so an AUD row has no rate at all. ``balance`` leaves that row
    out entirely and ``rate_missing_count`` is exactly the one transaction it
    belongs to; a second, unrelated account (even one holding only ordinary
    CNY) is not touched by the other account's missing currency.
    """
    checking = source_factory(
        world.ledger, name="招商 储蓄卡", type="checking", opening_balance=Decimal("1000")
    )
    other = source_factory(world.ledger, name="现金", type="cash", opening_balance=Decimal("50"))
    transaction_factory(world.ledger, checking, amount=Decimal("-100.0000"))
    transaction_factory(world.ledger, checking, amount=Decimal("-20.0000"), currency="AUD")

    payload = client.get(world.url, headers=world.headers).json()

    row = item_by_name(payload, "招商 储蓄卡")
    assert row["balance"] == money(Decimal("900"))     # the AUD row is simply left out
    assert row["rate_missing_count"] == 1

    other_row = item_by_name(payload, "现金")
    assert other_row["balance"] == money(Decimal("50"))
    assert other_row["rate_missing_count"] == 0


def test_only_the_callers_own_accounts_are_listed(
    client, world, user_factory, ledger_factory, source_factory
):
    """Somebody else's card is not in my list, even shared into my ledger (§5.20)."""
    other_ledger = ledger_factory(user_factory(), name="别人的账本")
    source_factory(other_ledger, name="别人的卡")
    source_factory(world.ledger, name="成员共享的卡", created_by=world.member.id)
    source_factory(world.ledger, name="我的卡")

    payload = client.get(world.url, headers=world.headers).json()
    assert [item["name"] for item in payload["items"]] == ["我的卡"]
    assert payload["items"][0]["owner_id"] == str(world.owner.id)


def test_a_user_without_accounts_gets_an_empty_list_in_their_currency(
    client, user_factory, auth_headers
):
    """No ledger needed: the list and totals are personal (§14.62 d)."""
    loner = user_factory(base_currency="EUR")
    response = client.get(URL, headers=auth_headers(loner))

    assert response.status_code == 200, response.text
    assert response.json() == {
        "items": [],
        "total": 0,
        "base_currency": "EUR",
        "assets": "0.0000",
        "liabilities": "0.0000",
        "net_worth": "0.0000",
    }


def test_the_balance_adds_up_the_account_in_every_ledger(
    client, world, ledger_factory, source_factory, transaction_factory
):
    """Decision §14.62 f: one card in two ledgers has one balance, the sum."""
    trip = ledger_factory(world.owner, name="旅行账本", base_currency="CNY")
    card = source_factory(world.ledger, name="招商 储蓄卡", opening_balance=Decimal("1000"))
    transaction_factory(world.ledger, card, amount=Decimal("-120.0000"))
    transaction_factory(trip, card, amount=Decimal("-80.0000"))

    payload = client.get(world.url, headers=world.headers).json()

    row = item_by_name(payload, "招商 储蓄卡")
    assert row["balance"] == money(Decimal("800"))
    assert payload["net_worth"] == money(Decimal("800"))

    one = client.get(f"{world.url}/{card.id}", headers=world.headers).json()
    assert one["balance"] == money(Decimal("800"))


def test_balance_base_is_in_the_owners_currency_not_the_ledgers(
    client, user_factory, ledger_factory, auth_headers, source_factory, transaction_factory
):
    """A EUR owner of a CNY card in a CNY ledger: base figures are in EUR (§14.62 f)."""
    owner = user_factory(base_currency="EUR")
    ledger = ledger_factory(owner, base_currency="CNY")
    card = source_factory(ledger, name="人民币卡", opening_balance=Decimal("720"))
    transaction_factory(ledger, card, amount=Decimal("-72.0000"))

    payload = client.get(URL, headers=auth_headers(owner)).json()

    cny_to_eur = (Decimal("0.92") / Decimal("7.2")).quantize(
        Decimal("0.00000001"), rounding=ROUND_HALF_UP
    )
    expected_base = (Decimal("648") * cny_to_eur).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP
    )
    row = item_by_name(payload, "人民币卡")
    assert payload["base_currency"] == "EUR"
    assert row["balance"] == money(Decimal("648"))              # still in CNY
    assert row["balance_rate"] == str(cny_to_eur)
    assert row["balance_base"] == money(expected_base)
    assert payload["assets"] == money(expected_base)
    assert payload["net_worth"] == money(expected_base)


def test_shared_to_lists_only_ledgers_the_owner_still_belongs_to(
    client, world, user_factory, ledger_factory, source_factory, share_source
):
    """§5.20: a share into a ledger the owner is not in is not reported."""
    card = source_factory(world.ledger, name="储蓄卡")
    elsewhere = ledger_factory(user_factory(), name="别人的账本")
    share_source(elsewhere, card)    # a leftover row: the owner is no member there

    row = item_by_name(client.get(world.url, headers=world.headers).json(), "储蓄卡")
    assert row["shared_to"] == [str(world.ledger.id)]


def test_the_list_needs_a_token(client, world):
    assert client.get(world.url).status_code == 401


# ---------------------------------------------------------------------------
# §5.21 POST /sources
# ---------------------------------------------------------------------------


def test_create_returns_201_and_writes_the_row(client, world, db):
    response = client.post(
        world.url,
        json={
            "name": "  招商 信用卡  ",
            "type": "credit",
            "default_currency": "cny",
            "opening_balance": "-2300.00",
        },
        headers=world.headers,
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "招商 信用卡"                       # stripped
    assert body["default_currency"] == "CNY"                   # upper-cased
    assert body["opening_balance"] == "-2300.0000"             # negative debt, §14.52 A13
    assert body["archived"] is False
    assert body["archived_at"] is None
    assert body["balance"] == "-2300.0000"                     # opening, no transactions
    assert body["balance_base"] == "-2300.0000"
    assert body["balance_rate"] == "1.00000000"
    assert body["rate_missing_count"] == 0
    assert body["created_by"] == str(world.owner.id)
    assert body["updated_by"] == str(world.owner.id)
    assert body["owner_id"] == str(world.owner.id)
    assert body["shared_to"] == []
    assert "ledger_id" not in body

    row = db.get(FinanceSource, uuid.UUID(body["id"]))
    assert row is not None and row.owner_id == world.owner.id
    # Without share_to nothing is shared: the owner can use it everywhere anyway.
    assert db.execute(select(LedgerSource)).scalars().all() == []
    assert row.opening_balance == Decimal("-2300.0000")
    # The opening balance is a column, never a transaction (decision §14.52 B5).
    assert db.execute(select(Transaction)).scalars().all() == []


def test_a_negative_opening_balance_lands_in_liabilities(client, world):
    client.post(
        world.url,
        json={
            "name": "信用卡",
            "type": "credit",
            "default_currency": "CNY",
            "opening_balance": "-2300",
        },
        headers=world.headers,
    )
    payload = client.get(world.url, headers=world.headers).json()

    assert payload["liabilities"] == "-2300.0000"
    assert payload["assets"] == "0.0000"
    assert payload["net_worth"] == "-2300.0000"


def test_opening_balance_defaults_to_zero(client, world):
    body = client.post(
        world.url,
        json={"name": "现金", "type": "cash", "default_currency": "CNY"},
        headers=world.headers,
    ).json()
    assert body["opening_balance"] == "0.0000"


def test_savings_is_not_one_of_the_four_types(client, world):
    """Decision §14.48 removed ``savings``; the schema is what refuses it."""
    response = client.post(
        world.url,
        json={"name": "储蓄", "type": "savings", "default_currency": "CNY"},
        headers=world.headers,
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_a_blank_name_is_refused(client, world):
    response = client.post(
        world.url,
        json={"name": "   ", "type": "cash", "default_currency": "CNY"},
        headers=world.headers,
    )
    assert response.status_code == 422


def test_an_unsupported_currency_is_400(client, world):
    """AUD is not in the fake upstream's list, so §5.21 refuses it."""
    response = client.post(
        world.url,
        json={"name": "澳元户", "type": "other", "default_currency": "AUD"},
        headers=world.headers,
    )
    assert response.status_code == 400
    assert response.json()["code"] == "validation_error"


def test_create_needs_a_token(client, db):
    response = client.post(
        URL, json={"name": "现金", "type": "cash", "default_currency": "CNY"}
    )
    assert response.status_code == 401
    assert db.execute(select(FinanceSource)).scalars().all() == []


def test_share_to_shares_the_new_account_and_counts_duplicates_once(
    client, world, db, ledger_factory
):
    trip = ledger_factory(world.member, name="旅行账本", members=[world.owner])
    response = client.post(
        world.url,
        json={
            "name": "中信 信用卡",
            "type": "credit",
            "default_currency": "CNY",
            "share_to": [str(world.ledger.id), str(trip.id), str(world.ledger.id)],
        },
        headers=world.headers,
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert sorted(body["shared_to"]) == sorted([str(world.ledger.id), str(trip.id)])
    shares = db.execute(select(LedgerSource)).scalars().all()
    assert {(share.ledger_id, share.shared_by) for share in shares} == {
        (world.ledger.id, world.owner.id),
        (trip.id, world.owner.id),
    }


@pytest.mark.parametrize("which", ["not_a_member", "no_such_ledger"])
def test_share_to_a_ledger_the_caller_is_not_in_is_404_and_creates_nothing(
    client, world, db, user_factory, ledger_factory, which
):
    """§5.21: one bad ledger fails the whole request — no half-shared account."""
    bad = (
        ledger_factory(user_factory(), name="别人的账本").id
        if which == "not_a_member"
        else uuid.uuid4()
    )
    response = client.post(
        world.url,
        json={
            "name": "偷偷共享",
            "type": "cash",
            "default_currency": "CNY",
            "share_to": [str(world.ledger.id), str(bad)],
        },
        headers=world.headers,
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    assert db.execute(select(FinanceSource)).scalars().all() == []
    assert db.execute(select(LedgerSource)).scalars().all() == []


def test_the_limit_counts_archived_accounts_and_only_the_callers(
    client, world, db, owned_source_factory, monkeypatch
):
    """``MAX_SOURCES_PER_USER`` counts archived accounts too (§5.21)."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "MAX_SOURCES_PER_USER", 3)
    owned_source_factory(world.owner, name="一")
    owned_source_factory(world.owner, name="二")
    owned_source_factory(world.owner, name="旧", archived=True)
    # Somebody else's accounts do not count against the owner.
    owned_source_factory(world.member, name="成员的")

    response = client.post(
        world.url,
        json={"name": "第四个", "type": "cash", "default_currency": "CNY"},
        headers=world.headers,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "source_limit_reached"
    assert db.execute(
        select(FinanceSource).where(FinanceSource.name == "第四个")
    ).scalar_one_or_none() is None

    member_ok = client.post(
        world.url,
        json={"name": "成员第二个", "type": "cash", "default_currency": "CNY"},
        headers=world.member_headers,
    )
    assert member_ok.status_code == 201


def test_the_default_limit_is_fifty(client, world, owned_source_factory):
    for index in range(49):
        owned_source_factory(world.owner, name=f"账户 {index}")
    fiftieth = client.post(
        world.url,
        json={"name": "第五十个", "type": "cash", "default_currency": "CNY"},
        headers=world.headers,
    )
    assert fiftieth.status_code == 201, fiftieth.text

    response = client.post(
        world.url,
        json={"name": "第五十一个", "type": "cash", "default_currency": "CNY"},
        headers=world.headers,
    )
    assert response.status_code == 409
    assert response.json()["code"] == "source_limit_reached"


# ---------------------------------------------------------------------------
# §5.22 GET /sources/{sid}
# ---------------------------------------------------------------------------


def test_get_one_account_has_the_balance_fields_and_no_ledger_totals(
    client, world, source_factory, transaction_factory
):
    source = source_factory(world.ledger, name="储蓄卡", opening_balance=Decimal("500"))
    transaction_factory(world.ledger, source, amount=Decimal("-125.5000"))

    response = client.get(f"{world.url}/{source.id}", headers=world.headers)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == str(source.id)
    assert body["balance"] == money(Decimal("374.5"))
    assert body["balance_base"] == money(Decimal("374.5"))
    assert body["balance_rate"] == "1.00000000"
    assert "assets" not in body and "liabilities" not in body and "net_worth" not in body


def test_somebody_elses_account_is_404_even_when_shared_into_my_ledger(
    client, world, source_factory
):
    """§5.22: the personal endpoints are the owner's only (§3.3)."""
    theirs = source_factory(world.ledger, name="成员的卡", created_by=world.member.id)
    response = client.get(f"{world.url}/{theirs.id}", headers=world.headers)
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_an_unknown_account_is_404(client, world):
    response = client.get(f"{world.url}/{uuid.uuid4()}", headers=world.headers)
    assert response.status_code == 404


def test_a_stranger_cannot_read_one_account(
    client, world, source_factory, user_factory, auth_headers
):
    source = source_factory(world.ledger)
    response = client.get(
        f"{world.url}/{source.id}", headers=auth_headers(user_factory())
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# §5.23 PATCH /sources/{sid}
# ---------------------------------------------------------------------------


def stamp(source: FinanceSource) -> str:
    """The version stamp as §4.4 wants it back: ISO-8601 UTC, microseconds kept."""
    return source.updated_at.isoformat() + "Z"


def test_patch_renames_and_retypes(client, world, source_factory, db):
    source = source_factory(world.ledger, name="旧名", type="cash")
    before = source.updated_at

    response = client.patch(
        f"{world.url}/{source.id}",
        json={"name": "新名", "type": "checking", "updated_at": stamp(source)},
        headers=world.headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "新名"
    assert body["type"] == "checking"
    assert body["updated_by"] == str(world.owner.id)
    assert body["shared_to"] == [str(world.ledger.id)]     # sharing is untouched
    db.refresh(source)
    assert source.name == "新名"
    assert source.updated_at > before


def test_patch_changes_the_opening_balance_and_the_balance_follows(
    client, world, source_factory, transaction_factory
):
    source = source_factory(world.ledger, opening_balance=Decimal("100"))
    transaction_factory(world.ledger, source, amount=Decimal("-40.0000"))

    body = client.patch(
        f"{world.url}/{source.id}",
        json={"opening_balance": "250.00", "updated_at": stamp(source)},
        headers=world.headers,
    ).json()

    assert body["opening_balance"] == "250.0000"
    assert body["balance"] == money(Decimal("210"))


def test_default_currency_in_the_body_is_refused_even_when_unchanged(
    client, world, source_factory, db
):
    """Decision §14.50: the account currency is fixed once the account exists."""
    source = source_factory(world.ledger, currency="EUR", name="欧元户")

    response = client.patch(
        f"{world.url}/{source.id}",
        json={"default_currency": "EUR", "updated_at": stamp(source)},
        headers=world.headers,
    )

    assert response.status_code == 400
    assert response.json()["code"] == "currency_locked"
    db.refresh(source)
    assert source.default_currency == "EUR"


def test_a_different_default_currency_is_refused_too(client, world, source_factory, db):
    source = source_factory(world.ledger, currency="EUR", name="欧元户")

    response = client.patch(
        f"{world.url}/{source.id}",
        json={"default_currency": "USD", "name": "改名", "updated_at": stamp(source)},
        headers=world.headers,
    )

    assert response.status_code == 400
    assert response.json()["code"] == "currency_locked"
    db.refresh(source)
    # Nothing else was written either.
    assert source.default_currency == "EUR"
    assert source.name == "欧元户"


def test_archiving_stamps_archived_at_and_un_archiving_clears_it(
    client, world, source_factory, db
):
    source = source_factory(world.ledger, name="Revolut EUR", currency="EUR")
    assert source.archived_at is None

    archived = client.patch(
        f"{world.url}/{source.id}",
        json={"archived": True, "updated_at": stamp(source)},
        headers=world.headers,
    ).json()
    assert archived["archived"] is True
    assert archived["archived_at"] is not None
    db.refresh(source)
    assert source.archived_at is not None

    restored = client.patch(
        f"{world.url}/{source.id}",
        json={"archived": False, "updated_at": stamp(source)},
        headers=world.headers,
    ).json()
    assert restored["archived"] is False
    assert restored["archived_at"] is None
    db.refresh(source)
    assert source.archived_at is None


def test_archiving_takes_the_account_out_of_the_totals(
    client, world, source_factory
):
    source = source_factory(
        world.ledger, name="储蓄卡", opening_balance=Decimal("1000")
    )

    before = client.get(world.url, headers=world.headers).json()
    assert before["net_worth"] == money(Decimal("1000"))

    client.patch(
        f"{world.url}/{source.id}",
        json={"archived": True, "updated_at": stamp(source)},
        headers=world.headers,
    )

    after = client.get(
        world.url, params={"include_archived": "true"}, headers=world.headers
    ).json()
    assert after["total"] == 1
    assert after["assets"] == "0.0000"
    assert after["net_worth"] == "0.0000"


def test_a_stale_version_stamp_is_409(client, world, source_factory, db):
    source = source_factory(world.ledger, name="旧名")
    old = stamp(source)

    client.patch(
        f"{world.url}/{source.id}",
        json={"name": "别人改的", "updated_at": old},
        headers=world.headers,
    )
    response = client.patch(
        f"{world.url}/{source.id}",
        json={"name": "我改的", "updated_at": old},
        headers=world.headers,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "stale_update"
    db.refresh(source)
    assert source.name == "别人改的"


def test_the_version_stamp_is_required(client, world, source_factory):
    source = source_factory(world.ledger)
    response = client.patch(
        f"{world.url}/{source.id}", json={"name": "新名"}, headers=world.headers
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_patch_refuses_share_to_and_owner_id(client, world, source_factory):
    """§5.23: sharing has its own endpoints; ``extra=forbid`` answers 422."""
    source = source_factory(world.ledger)
    for extra in ({"share_to": []}, {"owner_id": str(world.member.id)}):
        response = client.patch(
            f"{world.url}/{source.id}",
            json={**extra, "updated_at": stamp(source)},
            headers=world.headers,
        )
        assert response.status_code == 422


def test_patch_refuses_an_explicit_null_name(client, world, source_factory):
    source = source_factory(world.ledger)
    response = client.patch(
        f"{world.url}/{source.id}",
        json={"name": None, "updated_at": stamp(source)},
        headers=world.headers,
    )
    assert response.status_code == 422


def test_a_member_cannot_patch_an_account_shared_with_them(
    client, world, source_factory, db
):
    """Shared means usable, not editable: only the owner changes it (§5.23)."""
    source = source_factory(world.ledger, name="原名")
    response = client.patch(
        f"{world.url}/{source.id}",
        json={"name": "改别人的", "updated_at": stamp(source)},
        headers=world.member_headers,
    )
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    db.refresh(source)
    assert source.name == "原名"


def test_a_non_member_cannot_patch(
    client, world, source_factory, user_factory, auth_headers, db
):
    source = source_factory(world.ledger, name="原名")
    response = client.patch(
        f"{world.url}/{source.id}",
        json={"name": "改名", "updated_at": stamp(source)},
        headers=auth_headers(user_factory()),
    )
    assert response.status_code == 404
    db.refresh(source)
    assert source.name == "原名"


# ---------------------------------------------------------------------------
# §5.24 DELETE /sources/{sid}
# ---------------------------------------------------------------------------


def test_delete_without_transactions_is_204_and_takes_the_shares_along(
    client, world, source_factory, db
):
    source = source_factory(world.ledger)
    source_id = source.id

    response = client.delete(f"{world.url}/{source_id}", headers=world.headers)

    assert response.status_code == 204
    assert response.content == b""
    db.expire_all()
    assert db.get(FinanceSource, source_id) is None
    assert db.execute(select(LedgerSource)).scalars().all() == []


def test_a_transaction_in_a_ledger_the_owner_cannot_see_blocks_the_delete(
    client, world, db, user_factory, ledger_factory, owned_source_factory,
    transaction_factory,
):
    """§5.24: the reference check has no ledger condition.

    The owner left (or never joined) the ledger the card was used in; its
    transaction still keeps the account alive.
    """
    card = owned_source_factory(world.owner, name="旧卡")
    elsewhere = ledger_factory(user_factory(), name="别人的账本")
    transaction_factory(elsewhere, card, amount=Decimal("-10.0000"))

    response = client.delete(f"{world.url}/{card.id}", headers=world.headers)

    assert response.status_code == 409
    assert response.json()["code"] == "source_has_transactions"
    assert db.get(FinanceSource, card.id) is not None


def test_an_import_batch_blocks_the_delete(client, world, db, source_factory):
    """An import targeting the account refers to it too (§5.24)."""
    card = source_factory(world.ledger, name="导入过的卡")
    now = utcnow()
    db.add(
        ImportBatch(
            ledger_id=world.ledger.id,
            source_id=card.id,
            created_by=world.owner.id,
            source="csv",
            filename="cmb.csv",
            size_bytes=1024,
            skill_version="2026-09-10",
            status="ready",
            row_count=0,
            created_at=now,
            updated_at=now,
        )
    )
    db.flush()

    response = client.delete(f"{world.url}/{card.id}", headers=world.headers)

    assert response.status_code == 409
    assert response.json()["code"] == "source_has_transactions"
    assert db.get(FinanceSource, card.id) is not None


def test_delete_with_transactions_is_409_and_says_how_many(
    client, world, source_factory, transaction_factory, db
):
    source = source_factory(world.ledger)
    transaction_factory(world.ledger, source, amount=Decimal("-10.0000"))
    transaction_factory(world.ledger, source, amount=Decimal("-20.0000"))

    response = client.delete(f"{world.url}/{source.id}", headers=world.headers)

    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "source_has_transactions"
    assert "2" in body["detail"]
    assert db.get(FinanceSource, source.id) is not None


def test_an_archived_account_without_transactions_can_still_be_deleted(
    client, world, source_factory, db
):
    source = source_factory(world.ledger, archived=True)
    assert client.delete(f"{world.url}/{source.id}", headers=world.headers).status_code == 204
    assert db.get(FinanceSource, source.id) is None


def test_transactions_of_another_account_do_not_block_the_delete(
    client, world, source_factory, transaction_factory, db
):
    empty = source_factory(world.ledger, name="空账户")
    used = source_factory(world.ledger, name="用过的账户")
    transaction_factory(world.ledger, used, amount=Decimal("-10.0000"))

    assert client.delete(f"{world.url}/{empty.id}", headers=world.headers).status_code == 204
    assert db.get(FinanceSource, used.id) is not None


def test_deleting_twice_is_404(client, world, source_factory):
    source = source_factory(world.ledger)
    assert client.delete(f"{world.url}/{source.id}", headers=world.headers).status_code == 204
    second = client.delete(f"{world.url}/{source.id}", headers=world.headers)
    assert second.status_code == 404
    assert second.json()["code"] == "not_found"


def test_a_member_cannot_delete_an_account_shared_with_them(
    client, world, source_factory, db
):
    shared = source_factory(world.ledger)
    response = client.delete(f"{world.url}/{shared.id}", headers=world.member_headers)
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    assert db.get(FinanceSource, shared.id) is not None


def test_a_non_member_cannot_delete(
    client, world, source_factory, user_factory, auth_headers, db
):
    source = source_factory(world.ledger)
    response = client.delete(
        f"{world.url}/{source.id}", headers=auth_headers(user_factory())
    )
    assert response.status_code == 404
    assert db.get(FinanceSource, source.id) is not None
