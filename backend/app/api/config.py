"""Public, identity-free configuration (03-backend-api.md §5.6).

Only switches that are harmless to read anonymously belong here: the login and
registration pages need to know whether signing up is open *before* rendering
the form (decision §14.46). This is a hint, not the gate — the real refusal is
the 403 ``registration_closed`` of §5.1.
"""
from fastapi import APIRouter, Response

from app.core.config import settings
from app.schemas.common import ApiModel

router = APIRouter(prefix="/config", tags=["Public Config"])


class PublicConfigResponse(ApiModel):
    """§5.6 response: one flag today, and anything added must stay anonymous."""

    registration_open: bool


@router.get("", response_model=PublicConfigResponse)
def get_config(response: Response) -> PublicConfigResponse:
    """Report whether registration is open (§5.6).

    ``no-store``: flipping ``REGISTRATION_OPEN`` has to take effect on the next
    page load, and there is nothing here worth caching.
    """
    response.headers["Cache-Control"] = "no-store"
    return PublicConfigResponse(registration_open=settings.REGISTRATION_OPEN)
