"""Currency and exchange rate endpoints (03-backend-api.md §5.45-§5.47).

All three are public (no auth, as today) and all three go through
``services/fx.py`` so there is a single conversion formula (decision §8).
"""
import datetime as dt
from decimal import ROUND_HALF_UP

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import ApiError, ErrorCode
from app.schemas.currency import (
    ConversionRequest,
    ConversionResult,
    CurrencyList,
    ExchangeRateResponse,
)
from app.services import fx

router = APIRouter(prefix="/rates", tags=["Currency & Exchange Rates"])


@router.get("/currencies", response_model=CurrencyList)
def get_currencies() -> CurrencyList:
    """List the currencies Frankfurter supports (§5.45).

    Fetched at most once per process; 503 ``fx_unavailable`` while upstream is
    down and nothing has been cached yet.
    """
    return CurrencyList(currencies=fx.supported_currencies())


@router.get("/latest", response_model=ExchangeRateResponse)
def get_latest_rates(
    base: str = Query("USD", pattern=r"^[A-Za-z]{3}$", description="Base currency code"),
    symbols: str = Query("EUR,GBP,CNY", description="Comma separated target currency codes"),
    db: Session = Depends(get_db),
) -> ExchangeRateResponse:
    """Latest rates from ``base`` to each of ``symbols`` (§5.46).

    ``date`` is the upstream quotation day, and every rate fetched is cached in
    ``exchange_rates``.
    """
    codes = [code.strip().upper() for code in symbols.split(",") if code.strip()]
    if not codes:
        raise ApiError(
            422, ErrorCode.VALIDATION_ERROR, "query.symbols: at least one currency is required"
        )

    rates, rate_date = fx.latest_rates(db, base, codes)
    db.commit()
    return ExchangeRateResponse(base=base.upper(), date=rate_date, rates=rates)


@router.post("/convert", response_model=ConversionResult)
def convert_currency(
    payload: ConversionRequest, db: Session = Depends(get_db)
) -> ConversionResult:
    """Convert one amount between two currencies (§5.47).

    Uses ``on``'s rate when given, otherwise the latest published day; exactly
    one upstream call at most, and ``date`` is the rate's own day.
    """
    on = payload.on or dt.datetime.now(dt.UTC).date()
    converted, rate, rate_date = fx.convert(
        db, payload.amount, payload.from_currency, payload.to_currency, on
    )
    db.commit()
    return ConversionResult(
        amount=payload.amount,
        from_currency=payload.from_currency.upper(),
        to_currency=payload.to_currency.upper(),
        converted_amount=converted.quantize(fx.AMOUNT_QUANTUM, rounding=ROUND_HALF_UP),
        rate=fx.quantize_rate(rate),
        date=rate_date,
    )
