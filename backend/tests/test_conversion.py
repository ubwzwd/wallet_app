"""CONV-01/02/03: Unit tests for the _build_conversion_fields helper in transactions.py."""
import pytest
from decimal import Decimal
from unittest.mock import patch, MagicMock
from datetime import date
from fastapi import HTTPException

# Import the helper directly — it is a module-level function, not a route handler.
# The conftest.py sets a dummy DATABASE_URL so the engine creation succeeds lazily.
from app.api.transactions import _build_conversion_fields


class TestBuildConversionFieldsSameCurrency:
    """Returns (None, None, None) when tx_currency matches base_currency."""

    def test_same_currency_uppercase_returns_nulls(self):
        """CONV-01: same currency produces no conversion fields."""
        result = _build_conversion_fields("USD", Decimal("100.00"), "USD")
        assert result == (None, None, None)

    def test_same_currency_lowercase_tx_returns_nulls(self):
        """CONV-01: comparison is case-insensitive (lowercase tx_currency)."""
        result = _build_conversion_fields("usd", Decimal("100.00"), "USD")
        assert result == (None, None, None)

    def test_same_currency_lowercase_base_returns_nulls(self):
        """CONV-01: comparison is case-insensitive (lowercase base_currency)."""
        result = _build_conversion_fields("EUR", Decimal("50.00"), "eur")
        assert result == (None, None, None)

    def test_same_currency_mixed_case_returns_nulls(self):
        """CONV-01: comparison is case-insensitive (mixed case both sides)."""
        result = _build_conversion_fields("Gbp", Decimal("200.00"), "GBP")
        assert result == (None, None, None)


class TestBuildConversionFieldsCrossCurrency:
    """Returns (converted_amount, rate, date.today()) for cross-currency transactions."""

    def test_cross_currency_returns_non_null_converted_amount(self):
        """CONV-01: cross-currency transaction has a non-null converted_amount."""
        mock_converted = Decimal("92.0000")
        mock_rate = Decimal("0.920000")

        with patch("app.api.transactions.rates_service") as mock_svc:
            mock_svc.convert_amount.return_value = mock_converted
            mock_svc.fetch_latest_rates.return_value = {"EUR": mock_rate}

            conv_amount, conv_rate, conv_date = _build_conversion_fields(
                "USD", Decimal("100.00"), "EUR"
            )

        assert conv_amount is not None
        assert conv_amount == mock_converted

    def test_cross_currency_returns_non_null_rate(self):
        """CONV-01: cross-currency transaction has a non-null conversion_rate."""
        mock_converted = Decimal("92.0000")
        mock_rate = Decimal("0.920000")

        with patch("app.api.transactions.rates_service") as mock_svc:
            mock_svc.convert_amount.return_value = mock_converted
            mock_svc.fetch_latest_rates.return_value = {"EUR": mock_rate}

            _, conv_rate, _ = _build_conversion_fields("USD", Decimal("100.00"), "EUR")

        assert conv_rate is not None
        assert conv_rate == mock_rate

    def test_cross_currency_returns_todays_date(self):
        """CONV-01: conversion_date must be today's date."""
        mock_converted = Decimal("92.0000")
        mock_rate = Decimal("0.920000")

        with patch("app.api.transactions.rates_service") as mock_svc:
            mock_svc.convert_amount.return_value = mock_converted
            mock_svc.fetch_latest_rates.return_value = {"EUR": mock_rate}

            _, _, conv_date = _build_conversion_fields("USD", Decimal("100.00"), "EUR")

        assert conv_date == date.today()

    def test_cross_currency_calls_convert_amount_with_correct_args(self):
        """CONV-02: _build_conversion_fields calls rates_service.convert_amount(amount, FROM, TO)."""
        mock_converted = Decimal("92.0000")
        mock_rate = Decimal("0.920000")

        with patch("app.api.transactions.rates_service") as mock_svc:
            mock_svc.convert_amount.return_value = mock_converted
            mock_svc.fetch_latest_rates.return_value = {"EUR": mock_rate}

            _build_conversion_fields("USD", Decimal("100.00"), "EUR")

        mock_svc.convert_amount.assert_called_once_with(Decimal("100.00"), "USD", "EUR")

    def test_cross_currency_calls_fetch_latest_rates_with_correct_args(self):
        """CONV-02: _build_conversion_fields calls rates_service.fetch_latest_rates(FROM, [TO])."""
        mock_converted = Decimal("92.0000")
        mock_rate = Decimal("0.920000")

        with patch("app.api.transactions.rates_service") as mock_svc:
            mock_svc.convert_amount.return_value = mock_converted
            mock_svc.fetch_latest_rates.return_value = {"EUR": mock_rate}

            _build_conversion_fields("USD", Decimal("100.00"), "EUR")

        mock_svc.fetch_latest_rates.assert_called_once_with("USD", ["EUR"])

    def test_cross_currency_rate_looked_up_by_uppercase_key(self):
        """CONV-02: rate map is keyed by uppercase currency code."""
        mock_converted = Decimal("110.0000")
        # Simulate Frankfurter returning uppercase key
        mock_rate_map = {"JPY": Decimal("110.000000")}

        with patch("app.api.transactions.rates_service") as mock_svc:
            mock_svc.convert_amount.return_value = mock_converted
            mock_svc.fetch_latest_rates.return_value = mock_rate_map

            conv_amount, conv_rate, conv_date = _build_conversion_fields(
                "USD", Decimal("1.00"), "JPY"
            )

        assert conv_rate == Decimal("110.000000")


class TestBuildConversionFieldsAPIFailure:
    """Returns (None, None, None) when rates_service raises HTTPException."""

    def test_convert_amount_http_exception_returns_nulls(self):
        """CONV-03: HTTPException from convert_amount yields graceful (None, None, None)."""
        with patch("app.api.transactions.rates_service") as mock_svc:
            mock_svc.convert_amount.side_effect = HTTPException(
                status_code=503, detail="Frankfurter unavailable"
            )

            result = _build_conversion_fields("USD", Decimal("100.00"), "EUR")

        assert result == (None, None, None)

    def test_fetch_latest_rates_http_exception_returns_nulls(self):
        """CONV-03: HTTPException from fetch_latest_rates yields graceful (None, None, None)."""
        mock_converted = Decimal("92.0000")

        with patch("app.api.transactions.rates_service") as mock_svc:
            mock_svc.convert_amount.return_value = mock_converted
            mock_svc.fetch_latest_rates.side_effect = HTTPException(
                status_code=503, detail="Frankfurter unavailable"
            )

            result = _build_conversion_fields("USD", Decimal("100.00"), "EUR")

        assert result == (None, None, None)

    def test_api_failure_does_not_propagate_503(self):
        """CONV-03: The helper must not re-raise the HTTPException — caller sees None tuple."""
        with patch("app.api.transactions.rates_service") as mock_svc:
            mock_svc.convert_amount.side_effect = HTTPException(
                status_code=503, detail="Service unavailable"
            )

            # Must not raise — must return the null tuple
            try:
                result = _build_conversion_fields("GBP", Decimal("500.00"), "USD")
            except HTTPException:
                pytest.fail(
                    "_build_conversion_fields must not propagate HTTPException — "
                    "graceful fallback to (None, None, None) required"
                )

        assert result == (None, None, None)
