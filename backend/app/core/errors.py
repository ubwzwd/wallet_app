"""Unified error body and exception handlers.

Every non-2xx response body has the shape ``{"detail": str, "code": str}``
(see docs/target-design/03-backend-api.md §4.1). ``ErrorCode`` is the single
registry of all ``code`` values (§4.2); new codes must be added there first.
"""
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ErrorCode:
    """Single registry of all error codes (docs/target-design/03-backend-api.md §4.2)."""

    VALIDATION_ERROR = "validation_error"
    UNAUTHORIZED = "unauthorized"
    INVALID_CREDENTIALS = "invalid_credentials"
    NOT_FOUND = "not_found"
    FORBIDDEN = "forbidden"
    NOT_OWNER = "not_owner"
    REGISTRATION_CLOSED = "registration_closed"
    EMAIL_EXISTS = "email_exists"
    STALE_UPDATE = "stale_update"
    USE_TRANSFER_ENDPOINT = "use_transfer_endpoint"
    LEDGER_LIMIT_REACHED = "ledger_limit_reached"
    MEMBER_LIMIT_REACHED = "member_limit_reached"
    ALREADY_MEMBER = "already_member"
    OWNER_MUST_TRANSFER = "owner_must_transfer"
    CANNOT_REMOVE_OWNER = "cannot_remove_owner"
    MEMBER_NOT_FOUND = "member_not_found"
    INVITE_INVALID = "invite_invalid"
    INVITE_EXPIRED = "invite_expired"
    INVITE_RATE_LIMITED = "invite_rate_limited"
    LOGIN_RATE_LIMITED = "login_rate_limited"
    REGISTER_RATE_LIMITED = "register_rate_limited"
    IMPORT_RATE_LIMITED = "import_rate_limited"
    SOURCE_ARCHIVED = "source_archived"
    SOURCE_HAS_TRANSACTIONS = "source_has_transactions"
    CURRENCY_LOCKED = "currency_locked"
    SAME_SOURCE = "same_source"
    REPAYMENT_TARGET_NOT_CREDIT = "repayment_target_not_credit"
    CATEGORY_INVALID = "category_invalid"
    CATEGORY_KIND_MISMATCH = "category_kind_mismatch"
    KIND_CHANGE_NOT_ALLOWED = "kind_change_not_allowed"
    REFUND_TARGET_INVALID = "refund_target_invalid"
    TRANSFER_PAIR_INCOMPLETE = "transfer_pair_incomplete"
    PAIR_INVALID = "pair_invalid"
    UNPAIR_INVALID = "unpair_invalid"
    SKILL_OUTDATED = "skill_outdated"
    IMPORT_FORMAT_INVALID = "import_format_invalid"
    FILE_TOO_LARGE = "file_too_large"
    ROWS_EXCEED_LIMIT = "rows_exceed_limit"
    BATCH_NOT_READY = "batch_not_ready"
    BATCH_ALREADY_COMMITTED = "batch_already_committed"
    ROWS_UNCATEGORIZED = "rows_uncategorized"
    ROWS_ALL_SKIPPED = "rows_all_skipped"
    FX_UNAVAILABLE = "fx_unavailable"
    INTERNAL_ERROR = "internal_error"


class ApiError(Exception):
    """A domain error carrying an explicit HTTP status, code, and detail."""

    def __init__(self, status_code: int, code: str, detail: str) -> None:
        self.status_code = status_code
        self.code = code
        self.detail = detail
        super().__init__(detail)


def _http_status_to_code(status_code: int) -> str:
    """Map a bare HTTPException's status code to a stable error code."""
    if status_code == status.HTTP_401_UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED
    if status_code == status.HTTP_403_FORBIDDEN:
        return ErrorCode.FORBIDDEN
    if status_code == status.HTTP_404_NOT_FOUND:
        return ErrorCode.NOT_FOUND
    if status_code >= 500:
        return ErrorCode.INTERNAL_ERROR
    return ErrorCode.VALIDATION_ERROR


def _format_validation_error(exc: RequestValidationError) -> str:
    """Compress pydantic's error array into one sentence, e.g.
    ``"body.amount: Input should be greater than 0"``. Multiple errors are
    joined with "; " (§4.1).
    """
    parts: list[str] = []
    for error in exc.errors():
        loc = ".".join(str(part) for part in error.get("loc", ()))
        msg = error.get("msg", "")
        parts.append(f"{loc}: {msg}" if loc else msg)
    return "; ".join(parts) or "Request validation failed"


async def _api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "code": exc.code},
    )


async def _http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": detail, "code": _http_status_to_code(exc.status_code)},
        headers=getattr(exc, "headers", None),
    )


async def _validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "detail": _format_validation_error(exc),
            "code": ErrorCode.VALIDATION_ERROR,
        },
    )


async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error", "code": ErrorCode.INTERNAL_ERROR},
    )


def install_error_handlers(app: FastAPI) -> None:
    """Register handlers so every error response body is {"detail", "code"} (§4.1)."""
    app.add_exception_handler(ApiError, _api_error_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_exception_handler)
    app.add_exception_handler(Exception, _unhandled_exception_handler)
