"""Settings tests: SECRET_KEY validation, defaults, DEBUG/echo gating (BUG-04, §2.1)."""
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def _settings(**overrides) -> Settings:
    """Build a Settings instance isolated from backend/.env, with a valid SECRET_KEY."""
    kwargs = {"_env_file": None, "SECRET_KEY": "test-secret-key-for-tests-only"}
    kwargs.update(overrides)
    return Settings(**kwargs)


def test_debug_defaults_to_false():
    """BUG-04a: DEBUG must default to False so SQL echo is off in production."""
    s = _settings()
    assert s.DEBUG is False, "DEBUG must default to False for production safety"


def test_sql_echo_off_by_default():
    """BUG-04b: With default settings (ENVIRONMENT=development, DEBUG=False), echo must evaluate False."""
    s = _settings()
    echo_value = s.ENVIRONMENT == "development" and s.DEBUG
    assert echo_value is False, (
        f"echo gate must be False by default; got ENVIRONMENT={s.ENVIRONMENT!r} DEBUG={s.DEBUG!r}"
    )


def test_debug_can_be_enabled_via_env(monkeypatch):
    """BUG-04c: Setting DEBUG=true in env activates SQL echo for development."""
    monkeypatch.setenv("DEBUG", "true")
    monkeypatch.setenv("ENVIRONMENT", "development")
    s = _settings()
    assert s.DEBUG is True, "DEBUG should be True when env var DEBUG=true"
    assert (s.ENVIRONMENT == "development" and s.DEBUG) is True, (
        "SQL echo gate must be True when ENVIRONMENT=development and DEBUG=True"
    )


def test_debug_true_in_production_does_not_echo(monkeypatch):
    """BUG-04d: Even if DEBUG=True, echo must be False when ENVIRONMENT != development."""
    monkeypatch.setenv("DEBUG", "true")
    monkeypatch.setenv("ENVIRONMENT", "production")
    s = _settings()
    echo_value = s.ENVIRONMENT == "development" and s.DEBUG
    assert echo_value is False, (
        "SQL echo must be off in production even when DEBUG=True"
    )


def test_secret_key_missing_raises(monkeypatch):
    """H-08: SECRET_KEY has no default; omitting it must fail startup."""
    monkeypatch.delenv("SECRET_KEY", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


@pytest.mark.parametrize(
    "sentinel",
    [
        "",
        "CHANGE_ME",
        "CHANGE_ME_please",
        "CHANGE_ME_GENERATE_VIA_openssl_rand_-hex_32",
    ],
)
def test_secret_key_sentinel_rejected(sentinel):
    """H-08: empty or CHANGE_ME_* sentinel values must raise at construction time."""
    with pytest.raises(ValidationError):
        Settings(_env_file=None, SECRET_KEY=sentinel)


def test_secret_key_real_value_accepted():
    s = _settings(SECRET_KEY="a-real-random-secret")
    assert s.SECRET_KEY == "a-real-random-secret"


def test_new_field_defaults_match_design():
    """§2.1: ten new fields must default exactly as specified."""
    s = _settings()
    assert s.REGISTRATION_OPEN is True
    assert s.MAX_UPLOAD_MB == 2
    assert s.IMPORT_MAX_ROWS == 2000
    assert s.FX_HTTP_TIMEOUT_SECONDS == 10
    assert s.RATE_LIMIT_LOGIN_PER_MINUTE == 10
    assert s.RATE_LIMIT_REGISTER_PER_HOUR == 5
    assert s.RATE_LIMIT_JOIN_QPS == 1
    assert s.RATE_LIMIT_IMPORTS_PER_HOUR == 10
    assert s.MAX_LEDGERS_PER_USER == 10
    assert s.MAX_MEMBERS_PER_LEDGER == 10


def test_env_example_secret_key_placeholder_is_rejected():
    """env.example's SECRET_KEY must be a sentinel that Settings rejects, so a careless
    `cp env.example .env` cannot leave a guessable/public key in production (H-08)."""
    env_example_path = Path(__file__).resolve().parent.parent / "env.example"
    placeholder = None
    for line in env_example_path.read_text().splitlines():
        if line.startswith("SECRET_KEY="):
            placeholder = line.split("=", 1)[1]
            break
    assert placeholder is not None, "SECRET_KEY line not found in backend/env.example"
    with pytest.raises(ValidationError):
        Settings(_env_file=None, SECRET_KEY=placeholder)


def test_exchange_rate_api_url_default():
    """§2.1: default base URL fixed to frankfurter.dev/v1 (H-03 fix, no more 301 redirect)."""
    s = _settings()
    assert s.EXCHANGE_RATE_API_URL == "https://api.frankfurter.dev/v1"


def test_join_qps_must_be_positive():
    """RATE_LIMIT_JOIN_QPS feeds a division in the join bucket; 0 or negative is rejected."""
    import pytest
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(_env_file=None, SECRET_KEY="x" * 32, RATE_LIMIT_JOIN_QPS=0)
    assert Settings(_env_file=None, SECRET_KEY="x" * 32, RATE_LIMIT_JOIN_QPS=2.5).RATE_LIMIT_JOIN_QPS == 2.5
