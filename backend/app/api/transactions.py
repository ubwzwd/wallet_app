"""API routes for transaction management."""
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.transaction import Transaction
from app.models.transaction_tag import TransactionTag
from app.models.finance_source import FinanceSource
from app.schemas.transaction import TransactionCreate, TransactionUpdate, TransactionResponse
from app.services import rates as rates_service

router = APIRouter(prefix="/transactions", tags=["Transactions"])


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
def create_transaction(
    transaction_data: TransactionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create a new transaction.
    
    - **source_id**: Finance source (optional, uses user's default if omitted)
    - **amount**: Positive for income, negative for expense
    - **currency**: Transaction currency (ISO 4217)
    - **occurred_at**: Transaction date
    - **description**: Optional description
    - **merchant**: Optional merchant name
    - **tags**: Optional list of tags for categorization
    """
    # Determine source_id: use provided or user's default
    source_id = transaction_data.source_id or current_user.default_source_id
    
    if not source_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No finance source specified and user has no default source. Please create a finance source first."
        )
    
    # Verify source belongs to user
    source = db.query(FinanceSource).filter(
        FinanceSource.id == source_id,
        FinanceSource.user_id == current_user.id
    ).first()
    
    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Finance source {source_id} not found or does not belong to you"
        )
    
    # Create transaction
    new_transaction = Transaction(
        user_id=current_user.id,
        source_id=source_id,
        amount=transaction_data.amount,
        currency=transaction_data.currency.upper(),
        occurred_at=transaction_data.occurred_at,
        description=transaction_data.description,
        merchant=transaction_data.merchant
    )
    
    db.add(new_transaction)
    db.flush()  # Get the ID before committing
    
    # Add tags if provided
    if transaction_data.tags:
        for tag in transaction_data.tags:
            tag_obj = TransactionTag(
                transaction_id=new_transaction.id,
                tag=tag.strip().lower()  # Normalize tags
            )
            db.add(tag_obj)
    
    db.commit()
    db.refresh(new_transaction)
    
    # Convert to response format (will add conversion logic later)
    response = TransactionResponse(
        id=new_transaction.id,
        user_id=new_transaction.user_id,
        source_id=new_transaction.source_id,
        amount=new_transaction.amount,
        currency=new_transaction.currency,
        occurred_at=new_transaction.occurred_at,
        description=new_transaction.description,
        merchant=new_transaction.merchant,
        created_at=new_transaction.created_at,
        tags=[tag.tag for tag in new_transaction.tags],
        converted_amount=None,  # TODO: Add conversion logic
        conversion_rate=None,
        conversion_date=None
    )
    
    return response


@router.get("", response_model=List[TransactionResponse])
def list_transactions(
    source_id: UUID = None,
    from_date: str = None,  # YYYY-MM-DD
    to_date: str = None,  # YYYY-MM-DD
    tag: str = None,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    List transactions with filters and pagination.
    
    - **source_id**: Filter by finance source (optional)
    - **from_date**: Filter transactions from this date (YYYY-MM-DD, optional)
    - **to_date**: Filter transactions up to this date (YYYY-MM-DD, optional)
    - **tag**: Filter by tag (optional)
    - **limit**: Number of results per page (default: 50, max: 100)
    - **offset**: Pagination offset (default: 0)
    
    Returns transactions ordered by occurred_at DESC (newest first).
    """
    # Validate limit
    if limit > 100:
        limit = 100
    
    # Build query
    query = db.query(Transaction).filter(Transaction.user_id == current_user.id)
    
    # Apply filters
    if source_id:
        # Verify source belongs to user
        source = db.query(FinanceSource).filter(
            FinanceSource.id == source_id,
            FinanceSource.user_id == current_user.id
        ).first()
        if not source:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Finance source {source_id} not found"
            )
        query = query.filter(Transaction.source_id == source_id)
    
    if from_date:
        from datetime import datetime
        try:
            from_dt = datetime.strptime(from_date, "%Y-%m-%d").date()
            query = query.filter(Transaction.occurred_at >= from_dt)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid from_date format. Use YYYY-MM-DD"
            )
    
    if to_date:
        from datetime import datetime
        try:
            to_dt = datetime.strptime(to_date, "%Y-%m-%d").date()
            query = query.filter(Transaction.occurred_at <= to_dt)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid to_date format. Use YYYY-MM-DD"
            )
    
    if tag:
        # Join with transaction_tags to filter by tag
        query = query.join(TransactionTag).filter(TransactionTag.tag == tag.lower())
    
    # Apply pagination and ordering
    transactions = query.order_by(Transaction.occurred_at.desc(), Transaction.created_at.desc()).offset(offset).limit(limit).all()
    
    # Convert to response format
    responses = []
    for tx in transactions:
        response = TransactionResponse(
            id=tx.id,
            user_id=tx.user_id,
            source_id=tx.source_id,
            amount=tx.amount,
            currency=tx.currency,
            occurred_at=tx.occurred_at,
            description=tx.description,
            merchant=tx.merchant,
            created_at=tx.created_at,
            tags=[tag_obj.tag for tag_obj in tx.tags],
            converted_amount=None,  # TODO: Add conversion logic
            conversion_rate=None,
            conversion_date=None
        )
        responses.append(response)
    
    return responses


@router.get("/{transaction_id}", response_model=TransactionResponse)
def get_transaction(
    transaction_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get a specific transaction by ID.
    
    Only the owner can access their transaction.
    """
    transaction = db.query(Transaction).filter(
        Transaction.id == transaction_id,
        Transaction.user_id == current_user.id  # Security: owner check
    ).first()
    
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction {transaction_id} not found"
        )
    
    # Convert to response format
    response = TransactionResponse(
        id=transaction.id,
        user_id=transaction.user_id,
        source_id=transaction.source_id,
        amount=transaction.amount,
        currency=transaction.currency,
        occurred_at=transaction.occurred_at,
        description=transaction.description,
        merchant=transaction.merchant,
        created_at=transaction.created_at,
        tags=[tag.tag for tag in transaction.tags],
        converted_amount=None,  # TODO: Add conversion logic
        conversion_rate=None,
        conversion_date=None
    )
    
    return response


@router.patch("/{transaction_id}", response_model=TransactionResponse)
def update_transaction(
    transaction_id: UUID,
    transaction_data: TransactionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Update a transaction (partial update).
    
    Only the owner can update their transaction.
    Supports updating:
    - **amount**: Transaction amount
    - **currency**: Transaction currency
    - **occurred_at**: Transaction date
    - **description**: Description
    - **merchant**: Merchant name
    - **tags**: Tags list (replaces all existing tags)
    """
    # Fetch transaction with owner check
    transaction = db.query(Transaction).filter(
        Transaction.id == transaction_id,
        Transaction.user_id == current_user.id  # Security: owner check
    ).first()
    
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction {transaction_id} not found"
        )
    
    # Update only provided fields (partial update)
    update_data = transaction_data.model_dump(exclude_unset=True)
    
    # Handle tags separately
    new_tags = update_data.pop('tags', None)
    
    # Update basic fields
    for field, value in update_data.items():
        if field == 'currency':
            value = value.upper()
        setattr(transaction, field, value)
    
    # Update tags if provided
    if new_tags is not None:
        # Delete existing tags
        db.query(TransactionTag).filter(TransactionTag.transaction_id == transaction_id).delete()
        
        # Add new tags
        for tag in new_tags:
            tag_obj = TransactionTag(
                transaction_id=transaction_id,
                tag=tag.strip().lower()
            )
            db.add(tag_obj)
    
    db.commit()
    db.refresh(transaction)
    
    # Convert to response format
    response = TransactionResponse(
        id=transaction.id,
        user_id=transaction.user_id,
        source_id=transaction.source_id,
        amount=transaction.amount,
        currency=transaction.currency,
        occurred_at=transaction.occurred_at,
        description=transaction.description,
        merchant=transaction.merchant,
        created_at=transaction.created_at,
        tags=[tag.tag for tag in transaction.tags],
        converted_amount=None,  # TODO: Add conversion logic
        conversion_rate=None,
        conversion_date=None
    )
    
    return response

