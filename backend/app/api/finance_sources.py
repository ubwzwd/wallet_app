"""API routes for finance source management."""
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.finance_source import FinanceSource
from app.schemas.finance_source import FinanceSourceCreate, FinanceSourceUpdate, FinanceSourceResponse

router = APIRouter(prefix="/finance-sources", tags=["Finance Sources"])


@router.post("", response_model=FinanceSourceResponse, status_code=status.HTTP_201_CREATED)
def create_finance_source(
    source_data: FinanceSourceCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create a new finance source for the current user.
    
    - **name**: Finance source name (e.g., "Chase Checking")
    - **type**: Finance source type (checking, savings, credit, other)
    - **default_currency**: Default currency code (e.g., "USD")
    """
    # Create new finance source
    new_source = FinanceSource(
        user_id=current_user.id,
        name=source_data.name,
        type=source_data.type,
        default_currency=source_data.default_currency.upper(),
        archived=False
    )
    
    db.add(new_source)
    db.commit()
    db.refresh(new_source)

    # PROF-03 / D-09: auto-set default_source_id when this is the user's first finance source
    source_count = db.query(FinanceSource).filter(
        FinanceSource.user_id == current_user.id
    ).count()
    if source_count == 1:
        current_user.default_source_id = new_source.id
        db.commit()

    return new_source


@router.get("", response_model=List[FinanceSourceResponse])
def list_finance_sources(
    include_archived: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    List all finance sources for the current user.
    
    - **include_archived**: If True, include archived finance sources (default: False)
    """
    query = db.query(FinanceSource).filter(FinanceSource.user_id == current_user.id)
    
    if not include_archived:
        query = query.filter(FinanceSource.archived == False)
    
    sources = query.order_by(FinanceSource.created_at.desc()).all()
    return sources


@router.get("/{source_id}", response_model=FinanceSourceResponse)
def get_finance_source(
    source_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get a specific finance source by ID.
    
    Only the owner can access their finance source.
    """
    source = db.query(FinanceSource).filter(
        FinanceSource.id == source_id,
        FinanceSource.user_id == current_user.id  # Security: owner check
    ).first()
    
    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Finance source {source_id} not found"
        )
    
    return source


@router.patch("/{source_id}", response_model=FinanceSourceResponse)
def update_finance_source(
    source_id: UUID,
    source_data: FinanceSourceUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Update a finance source (partial update).
    
    Only the owner can update their finance source.
    Supports updating:
    - **name**: Finance source name
    - **archived**: Archive status
    """
    # Fetch finance source with owner check
    source = db.query(FinanceSource).filter(
        FinanceSource.id == source_id,
        FinanceSource.user_id == current_user.id  # Security: owner check
    ).first()
    
    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Finance source {source_id} not found"
        )
    
    # Update only provided fields (partial update)
    update_data = source_data.model_dump(exclude_unset=True)
    
    for field, value in update_data.items():
        setattr(source, field, value)
    
    db.commit()
    db.refresh(source)
    
    return source

