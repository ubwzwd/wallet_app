"""BUG-04: DEBUG defaults to False; SQL echo gated on ENVIRONMENT+DEBUG."""
import pytest
from app.core.config import Settings


def test_debug_defaults_to_false():
    """BUG-04a: DEBUG must default to False so SQL echo is off in production."""
    s = Settings()
    assert s.DEBUG is False, "DEBUG must default to False for production safety"


def test_sql_echo_off_by_default():
    """BUG-04b: With default settings (ENVIRONMENT=development, DEBUG=False), echo must evaluate False."""
    s = Settings()
    echo_value = s.ENVIRONMENT == "development" and s.DEBUG
    assert echo_value is False, (
        f"echo gate must be False by default; got ENVIRONMENT={s.ENVIRONMENT!r} DEBUG={s.DEBUG!r}"
    )


def test_debug_can_be_enabled_via_env(monkeypatch):
    """BUG-04c: Setting DEBUG=true in env activates SQL echo for development."""
    monkeypatch.setenv("DEBUG", "true")
    monkeypatch.setenv("ENVIRONMENT", "development")
    s = Settings()
    assert s.DEBUG is True, "DEBUG should be True when env var DEBUG=true"
    assert (s.ENVIRONMENT == "development" and s.DEBUG) is True, (
        "SQL echo gate must be True when ENVIRONMENT=development and DEBUG=True"
    )


def test_debug_true_in_production_does_not_echo(monkeypatch):
    """BUG-04d: Even if DEBUG=True, echo must be False when ENVIRONMENT != development."""
    monkeypatch.setenv("DEBUG", "true")
    monkeypatch.setenv("ENVIRONMENT", "production")
    s = Settings()
    echo_value = s.ENVIRONMENT == "development" and s.DEBUG
    assert echo_value is False, (
        "SQL echo must be off in production even when DEBUG=True"
    )
