"""
Currency exchange rate service using Frankfurter API.
Frankfurter provides ECB (European Central Bank) exchange rates.
"""
from decimal import Decimal
from typing import Dict, List, Optional
import httpx
from fastapi import HTTPException, status

from app.core.config import settings


# Cache for supported currencies (static data, rarely changes)
_SUPPORTED_CURRENCIES_CACHE: Optional[Dict[str, str]] = None


def get_supported_currencies() -> Dict[str, str]:
    """
    Get list of supported currencies from Frankfurter API.
    Returns a dict mapping currency code to currency name.
    
    Example:
        {"USD": "United States Dollar", "EUR": "Euro", ...}
    """
    global _SUPPORTED_CURRENCIES_CACHE
    
    # Return cached data if available
    if _SUPPORTED_CURRENCIES_CACHE is not None:
        return _SUPPORTED_CURRENCIES_CACHE
    
    try:
        url = f"{settings.EXCHANGE_RATE_API_URL}/currencies"
        response = httpx.get(url, timeout=10.0)
        response.raise_for_status()
        
        currencies = response.json()
        _SUPPORTED_CURRENCIES_CACHE = currencies
        return currencies
        
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to fetch supported currencies: {str(e)}"
        )


def fetch_latest_rates(base: str, symbols: List[str]) -> Dict[str, Decimal]:
    """
    Fetch latest exchange rates from Frankfurter API.
    
    Args:
        base: Base currency code (e.g., "USD")
        symbols: List of target currency codes (e.g., ["EUR", "GBP"])
    
    Returns:
        Dict mapping currency codes to exchange rates as Decimal
        Example: {"EUR": Decimal("0.92"), "GBP": Decimal("0.79")}
    
    Raises:
        HTTPException: If API call fails
    """
    try:
        url = f"{settings.EXCHANGE_RATE_API_URL}/latest"
        params = {
            "from": base.upper(),
            "to": ",".join([s.upper() for s in symbols])
        }
        
        response = httpx.get(url, params=params, timeout=10.0)
        response.raise_for_status()
        
        data = response.json()
        rates = data.get("rates", {})
        
        # Convert to Decimal for precision
        return {code: Decimal(str(rate)) for code, rate in rates.items()}
        
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to fetch exchange rates: {str(e)}"
        )


def convert_amount(
    amount: Decimal,
    from_currency: str,
    to_currency: str
) -> Decimal:
    """
    Convert an amount from one currency to another using latest rates.
    
    Args:
        amount: Amount to convert
        from_currency: Source currency code (e.g., "USD")
        to_currency: Target currency code (e.g., "EUR")
    
    Returns:
        Converted amount as Decimal
    
    Example:
        convert_amount(Decimal("100"), "USD", "EUR")
        # Returns Decimal("92.00") if rate is 0.92
    """
    # If same currency, no conversion needed
    if from_currency.upper() == to_currency.upper():
        return amount
    
    # Fetch rate from base to target
    rates = fetch_latest_rates(from_currency, [to_currency])
    
    if to_currency.upper() not in rates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Exchange rate not available for {from_currency} to {to_currency}"
        )
    
    rate = rates[to_currency.upper()]
    converted = amount * rate
    
    # Round to 4 decimal places for currency precision
    return converted.quantize(Decimal("0.0001"))


def get_multiple_rates(base: str, targets: List[str]) -> Dict[str, Decimal]:
    """
    Get exchange rates from base currency to multiple target currencies.
    This is a convenience wrapper around fetch_latest_rates.
    
    Args:
        base: Base currency code
        targets: List of target currency codes
    
    Returns:
        Dict of currency codes to rates
    """
    if not targets:
        return {}
    
    return fetch_latest_rates(base, targets)

