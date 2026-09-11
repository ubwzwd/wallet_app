"""The two anonymous endpoints (03-backend-api.md §5.5-§5.6, §10.2).

``GET /categories`` is the frozen table plus its caching contract, and
``GET /config`` is the single registration switch. Neither takes a token, and
neither is allowed to start needing one.
"""
import pytest

from app.core import categories as category_constants
from app.core.categories import CATEGORY_VERSION
from app.core.config import settings

CATEGORIES_URL = "/api/v1/categories"
CONFIG_URL = "/api/v1/config"

ETAG = f'"{CATEGORY_VERSION}"'


@pytest.fixture()
def table(client):
    """The parsed ``GET /categories`` body, fetched anonymously."""
    response = client.get(CATEGORIES_URL)
    assert response.status_code == 200
    return response.json()


# ---------------------------------------------------------------------------
# §5.5 GET /categories
# ---------------------------------------------------------------------------


def test_categories_lists_twenty_two_top_level_categories(table):
    assert len(table["expense"]) == 16
    assert len(table["income"]) == 6
    assert len(table["expense"]) + len(table["income"]) == 22


def test_every_code_in_the_table_is_unique(table):
    codes = []
    for l1 in table["expense"] + table["income"]:
        codes.append(l1["code"])
        codes.extend(child["code"] for child in l1["children"])

    assert len(codes) == len(set(codes))


def test_every_child_sits_under_the_right_parent(table):
    for l1 in table["expense"] + table["income"]:
        parent = category_constants.find(l1["code"])
        assert parent is not None, l1["code"]
        expected = [child.code for child in parent.children]
        assert [child["code"] for child in l1["children"]] == expected


def test_descriptions_are_present_on_l1_and_null_on_l2(table):
    for l1 in table["expense"] + table["income"]:
        # Decision §14.21: the front end shows the l1 description unconditionally.
        assert l1["desc_zh"], l1["code"]
        assert l1["desc_en"], l1["code"]
        for child in l1["children"]:
            assert child["desc_zh"] is None, child["code"]
            assert child["desc_en"] is None, child["code"]


def test_children_is_always_a_list_and_never_nests_three_deep(table):
    for l1 in table["expense"] + table["income"]:
        assert isinstance(l1["children"], list)
        for child in l1["children"]:
            assert child["children"] == []


def test_expense_and_income_sides_are_not_mixed_up(table):
    for l1 in table["expense"]:
        assert category_constants.category_side(l1["code"]) == "expense"
    for l1 in table["income"]:
        assert category_constants.category_side(l1["code"]) == "income"


def test_version_matches_the_constant_and_is_the_etag(client, table):
    response = client.get(CATEGORIES_URL)

    assert table["version"] == CATEGORY_VERSION
    assert response.headers["ETag"] == ETAG


def test_categories_are_cached_immutably(client):
    response = client.get(CATEGORIES_URL)

    assert response.headers["Cache-Control"] == "public, max-age=31536000, immutable"


@pytest.mark.parametrize(
    "if_none_match",
    [ETAG, f"W/{ETAG}", f'"2026-01-01", {ETAG}', "*"],
)
def test_a_matching_if_none_match_gets_an_empty_304(client, if_none_match):
    response = client.get(CATEGORIES_URL, headers={"If-None-Match": if_none_match})

    assert response.status_code == 304
    assert response.content == b""
    # The validators are repeated so the client can keep caching (§5.5).
    assert response.headers["ETag"] == ETAG
    assert response.headers["Cache-Control"] == "public, max-age=31536000, immutable"


def test_a_stale_if_none_match_gets_the_whole_table(client):
    response = client.get(CATEGORIES_URL, headers={"If-None-Match": '"2026-01-01"'})

    assert response.status_code == 200
    assert response.json()["version"] == CATEGORY_VERSION


def test_categories_need_no_token_and_ignore_a_bad_one(client):
    response = client.get(CATEGORIES_URL, headers={"Authorization": "Bearer not-a-jwt"})

    assert response.status_code == 200


# ---------------------------------------------------------------------------
# §5.6 GET /config
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("registration_open", [True, False])
def test_config_reports_the_registration_switch(client, monkeypatch, registration_open):
    monkeypatch.setattr(settings, "REGISTRATION_OPEN", registration_open)

    response = client.get(CONFIG_URL)

    assert response.status_code == 200
    # Exactly one field: nothing identity-bound belongs here (§5.6).
    assert response.json() == {"registration_open": registration_open}


def test_config_is_never_cached(client):
    response = client.get(CONFIG_URL)

    assert response.headers["Cache-Control"] == "no-store"


def test_config_is_readable_anonymously(client):
    # No Authorization header at all, and none demanded.
    assert client.get(CONFIG_URL).status_code == 200
