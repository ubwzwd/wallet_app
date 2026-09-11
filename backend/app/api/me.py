"""The signed-in user's own profile (03-backend-api.md §5.3-§5.4).

``/me`` is the only entry point for the profile; the ``auth`` router no longer
carries aliases for it (decision §14.42). The user object does not take part in
optimistic concurrency — nobody but its owner can change it (§5.4).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.user import MePatch, MeResponse
from app.services import fx, ledger_service

router = APIRouter(prefix="/me", tags=["Me"])


def _profile(db: Session, user: User) -> MeResponse:
    """Build the §5.3 body; ``ledger_count`` is one ``count(*)``."""
    return MeResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        base_currency=user.base_currency,
        language=user.language,
        created_at=user.created_at,
        ledger_count=ledger_service.user_ledger_count(db, user.id),
    )


@router.get("", response_model=MeResponse)
def get_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeResponse:
    """The caller's profile plus how many ledgers they belong to (§5.3).

    ``display_name`` is handed back exactly as stored: NULL stays NULL, and the
    front end decides to show the email prefix instead (decision §14.40).
    """
    return _profile(db, current_user)


@router.patch("", response_model=MeResponse)
def patch_me(
    payload: MePatch,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeResponse:
    """Update default currency, language and display name (§5.4).

    ``exclude_unset`` semantics: an omitted field is left alone, while an
    explicit ``null`` is meaningful for exactly two fields — ``language`` back
    to "follow the system" (decision §14.6) and ``display_name`` cleared
    (decision §14.40). ``base_currency`` rejects ``null`` in the schema and a
    code upstream does not quote here.
    """
    changes = payload.model_dump(exclude_unset=True)

    if "base_currency" in changes:
        # The validator already upper-cased it; it still has to be a currency
        # the exchange rate provider knows about (§5.4). Passing the currency
        # in effect means switching *back* to it still works while upstream is
        # down — the same rule the ledger endpoints follow.
        current_user.base_currency = fx.ensure_supported(
            changes["base_currency"], current_user.base_currency
        )

    if "language" in changes:
        current_user.language = changes["language"]

    if "display_name" in changes:
        # The validator turned a blank string into None, so both spellings of
        # "clear it" arrive here as None.
        current_user.display_name = changes["display_name"]

    current_user.updated_at = utcnow()
    db.commit()

    return _profile(db, current_user)
