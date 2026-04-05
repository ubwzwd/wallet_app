import os
import sys
from unittest.mock import MagicMock

# Set dummy env vars before any app imports
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test_db")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-tests-only")


def _mock_module(name: str, **attrs):
    m = MagicMock()
    for k, v in attrs.items():
        setattr(m, k, v)
    sys.modules[name] = m
    return m


# Mock psycopg2 (native PostgreSQL driver — not installed system-wide)
if "psycopg2" not in sys.modules:
    _mock_module("psycopg2")
    _mock_module("psycopg2.extensions", UNICODE=0)
    _mock_module("psycopg2.extras")

# Mock python-jose (JWT library — not installed system-wide)
if "jose" not in sys.modules:
    jose_mock = _mock_module("jose")
    jose_mock.JWTError = Exception
    jose_mock.jwt = MagicMock()
    _mock_module("jose.exceptions", JWTError=Exception)

# Mock passlib (password hashing — not installed system-wide)
if "passlib" not in sys.modules:
    _mock_module("passlib")
    _mock_module("passlib.context", CryptContext=MagicMock())
    _mock_module("passlib.hash")
