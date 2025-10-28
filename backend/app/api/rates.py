"""Currency and exchange rate API endpoints."""
from fastapi import APIRouter, Query
from datetime import date as date_type

from app.schemas.currency import (
    CurrencyList,
    ExchangeRateResponse,
    ConversionRequest,
    ConversionResult,
)
from app.services.rates import (
    get_supported_currencies,
    fetch_latest_rates,
    convert_amount,
)

router = APIRouter(prefix="/rates", tags=["Currency & Exchange Rates"])


@router.get("/currencies", response_model=CurrencyList)
def get_currencies():
    """
    Get list of supported currencies.
    
    Returns 31 currencies supported by Frankfurter API (ECB data).
    Includes: USD, EUR, CNY, SGD, HKD, GBP, JPY, and 24 others.
    """
    currencies = get_supported_currencies()
    return {"currencies": currencies}


@router.get("/latest", response_model=ExchangeRateResponse)
def get_latest_rates(
    base: str = Query(default="USD", description="Base currency code", min_length=3, max_length=3),
    symbols: str = Query(default="EUR,GBP,CNY", description="Comma-separated target currency codes")
):
    """
    Get latest exchange rates from base currency to target currencies.
    
    Uses real-time data from Frankfurter API (European Central Bank rates).
    
    - **base**: Base currency code (e.g., USD, EUR)
    - **symbols**: Comma-separated list of target currencies (e.g., EUR,GBP,CNY)
    
    Example:
        GET /rates/latest?base=USD&symbols=EUR,CNY,SGD
    """
    # Parse symbols into list
    symbol_list = [s.strip() for s in symbols.split(",") if s.strip()]
    
    # Fetch rates
    rates = fetch_latest_rates(base, symbol_list)
    
    # Get today's date for response
    today = date_type.today().isoformat()
    
    return {
        "base": base.upper(),
        "date": today,
        "rates": rates
    }


@router.post("/convert", response_model=ConversionResult)
def convert_currency(request: ConversionRequest):
    """
    Convert an amount from one currency to another.
    
    Uses latest exchange rates from Frankfurter API.
    
    Request body:
    ```json
    {
      "amount": 100.00,
      "from_currency": "USD",
      "to_currency": "EUR"
    }
    ```
    
    Response includes original amount, converted amount, and exchange rate used.
    """
    # Convert the amount
    converted = convert_amount(
        request.amount,
        request.from_currency,
        request.to_currency
    )
    
    # Get the rate for response
    if request.from_currency.upper() == request.to_currency.upper():
        rate = 1.0
    else:
        rates = fetch_latest_rates(request.from_currency, [request.to_currency])
        rate = rates[request.to_currency.upper()]
    
    today = date_type.today().isoformat()
    
    return {
        "amount": request.amount,
        "from_currency": request.from_currency.upper(),
        "to_currency": request.to_currency.upper(),
        "converted_amount": converted,
        "rate": rate,
        "date": today
    }

