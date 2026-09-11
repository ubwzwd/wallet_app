"""Statistics endpoints: category summary and expense trend (03 §5.35-§5.36).

Both are member-only, read-only reports built entirely by
``app.services.stats``; the endpoints here only parse the two ``YYYY-MM``
query parameters (FastAPI's own ``Query`` validation turns a bad pattern or an
out-of-range ``months`` into 422 ``validation_error`` without any code here)
and default them to the current UTC month. ``db.commit()`` still runs at the
end of each request because valuation may upsert freshly fetched exchange
rates into the cache as a side effect of converting (§6.3) — the request is
read-only from the caller's point of view, but the cache write is real.
"""
import datetime as dt

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import LedgerContext, get_ledger_member
from app.schemas.stats import SummaryResponse, TrendResponse
from app.services import stats as stats_service

router = APIRouter(prefix="/ledgers/{id}/stats", tags=["Stats"])

# Both query params share this shape (§5.35, §5.36).
MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


def _current_month() -> dt.date:
    """The first day of the current UTC month, used as the default for both params."""
    today = dt.datetime.now(dt.UTC).date()
    return today.replace(day=1)


def _parse_month(value: str) -> dt.date:
    """``"YYYY-MM"`` (already pattern-validated) to the first day of that month."""
    year, month = value.split("-")
    return dt.date(int(year), int(month), 1)


@router.get("/summary", response_model=SummaryResponse)
def get_summary(
    month: str | None = Query(
        None, pattern=MONTH_PATTERN, description="YYYY-MM, default the current UTC month"
    ),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> SummaryResponse:
    """Expense / income by level-1 category for one month (§5.35)."""
    target = _parse_month(month) if month else _current_month()
    body = stats_service.summary(db, ctx.ledger, target)
    db.commit()
    return SummaryResponse(**body)


@router.get("/trend", response_model=TrendResponse)
def get_trend(
    months: int = Query(12, ge=1, le=36, description="How many months to return, 1..36"),
    end: str | None = Query(
        None,
        pattern=MONTH_PATTERN,
        description="YYYY-MM, the last month of the series; default the current UTC month",
    ),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> TrendResponse:
    """Expense-only monthly trend, most recent ``months`` months (§5.36)."""
    target_end = _parse_month(end) if end else _current_month()
    body = stats_service.trend(db, ctx.ledger, months, target_end)
    db.commit()
    return TrendResponse(**body)
