"""Structural tests locking down PROF-01 contract.
Runs against source text + imported modules; no live DB/HTTP required.
"""
import ast
import inspect
from pathlib import Path

import pytest

from app.schemas import user as user_schemas
from app.api import auth as auth_api

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _load_source(relative: str) -> str:
    return (BACKEND_ROOT / relative).read_text()


def test_user_update_schema_exists():
    assert hasattr(user_schemas, "UserUpdate"), \
        "UserUpdate schema must exist in app.schemas.user (D-05)"


def test_user_update_has_optional_base_currency_and_default_source_id():
    UserUpdate = user_schemas.UserUpdate
    fields = UserUpdate.model_fields
    assert "base_currency" in fields, "UserUpdate.base_currency required (D-05)"
    assert "default_source_id" in fields, "UserUpdate.default_source_id required (D-05)"
    # Both must be optional (None default acceptable via model_dump(exclude_unset=True))
    instance = UserUpdate()  # no required fields
    assert instance.base_currency is None
    assert instance.default_source_id is None


def test_user_update_base_currency_length_constraints():
    UserUpdate = user_schemas.UserUpdate
    # min_length=3, max_length=3 per D-05
    with pytest.raises(Exception):
        UserUpdate(base_currency="US")
    with pytest.raises(Exception):
        UserUpdate(base_currency="USDD")
    UserUpdate(base_currency="USD")  # valid


def test_user_response_includes_default_source_id():
    UserResponse = user_schemas.UserResponse
    assert "default_source_id" in UserResponse.model_fields, \
        "UserResponse must expose default_source_id (D-06)"


def test_patch_me_handler_exists_in_auth_module():
    src = _load_source("app/api/auth.py")
    assert '@router.patch("/me"' in src or "@router.patch('/me'" in src, \
        "PATCH /me route must be registered in auth.py (PROF-01)"


def test_patch_me_handler_uppercases_base_currency():
    src = _load_source("app/api/auth.py")
    # D-08: must call .upper() on base_currency
    assert ".upper()" in src and "base_currency" in src, \
        "PATCH /me must normalize base_currency to uppercase (D-08)"


def test_patch_me_handler_validates_default_source_ownership():
    src = _load_source("app/api/auth.py")
    # D-07: query FinanceSource filtered by current_user.id
    assert "FinanceSource" in src, \
        "auth.py must import FinanceSource for ownership check (D-07)"
    assert "user_id" in src and "current_user.id" in src, \
        "PATCH /me must filter FinanceSource by current_user.id (D-07)"


def test_patch_me_uses_model_dump_exclude_unset():
    src = _load_source("app/api/auth.py")
    assert "model_dump(exclude_unset=True)" in src, \
        "PATCH /me must use partial-update pattern model_dump(exclude_unset=True)"
