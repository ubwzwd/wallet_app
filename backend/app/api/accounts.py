"""API routes for account management."""
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.account import Account
from app.schemas.account import AccountCreate, AccountUpdate, AccountResponse

router = APIRouter(prefix="/accounts", tags=["Accounts"])


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(
    account_data: AccountCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create a new account for the current user.
    
    - **name**: Account name (e.g., "Chase Checking")
    - **type**: Account type (checking, savings, credit, other)
    - **default_currency**: Default currency code (e.g., "USD")
    """
    # Create new account
    new_account = Account(
        user_id=current_user.id,
        name=account_data.name,
        type=account_data.type,
        default_currency=account_data.default_currency.upper(),
        archived=False
    )
    
    db.add(new_account)
    db.commit()
    db.refresh(new_account)
    
    return new_account


@router.get("", response_model=List[AccountResponse])
def list_accounts(
    include_archived: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    List all accounts for the current user.
    
    - **include_archived**: If True, include archived accounts (default: False)
    """
    query = db.query(Account).filter(Account.user_id == current_user.id)
    
    if not include_archived:
        query = query.filter(Account.archived == False)
    
    accounts = query.order_by(Account.created_at.desc()).all()
    return accounts


@router.get("/{account_id}", response_model=AccountResponse)
def get_account(
    account_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get a specific account by ID.
    
    Only the owner can access their account.
    """
    account = db.query(Account).filter(
        Account.id == account_id,
        Account.user_id == current_user.id  # Security: owner check
    ).first()
    
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account {account_id} not found"
        )
    
    return account


@router.patch("/{account_id}", response_model=AccountResponse)
def update_account(
    account_id: UUID,
    account_data: AccountUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Update an account (partial update).
    
    Only the owner can update their account.
    Supports updating:
    - **name**: Account name
    - **archived**: Archive status
    """
    # Fetch account with owner check
    account = db.query(Account).filter(
        Account.id == account_id,
        Account.user_id == current_user.id  # Security: owner check
    ).first()
    
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account {account_id} not found"
        )
    
    # Update only provided fields (partial update)
    update_data = account_data.model_dump(exclude_unset=True)
    
    for field, value in update_data.items():
        setattr(account, field, value)
    
    db.commit()
    db.refresh(account)
    
    return account

