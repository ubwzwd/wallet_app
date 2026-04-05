"""API routes for transaction management."""
from datetime import date
from decimal import Decimal
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


def _build_conversion_fields(
    tx_currency: str,
    tx_amount: Decimal,
    base_currency: str,
) -> tuple[Decimal | None, Decimal | None, date | None]:
    """
    Compute (converted_amount, conversion_rate, conversion_date) for a single transaction.

    Returns (None, None, None) when:
    - tx_currency == base_currency (same currency, per D-03)
    - Frankfurter API is unreachable (graceful fallback, per D-04)

    Rate direction: calls convert_amount(amount, FROM=tx_currency, TO=base_currency).
    Also fetches the rate separately for the conversion_rate field.
    """
    if tx_currency.upper() == base_currency.upper():
        return None, None, None

    try:
        converted = rates_service.convert_amount(tx_amount, tx_currency, base_currency)
        # fetch_latest_rates(FROM, [TO]) returns {TO: rate} where rate = 1 FROM = rate TO
        rate_map = rates_service.fetch_latest_rates(tx_currency, [base_currency])
        conversion_rate = rate_map.get(base_currency.upper())
        return converted, conversion_rate, date.today()
    except HTTPException:
        # Frankfurter unavailable — graceful fallback per D-04; never propagate 503
        return None, None, None


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
        merchant=transaction_data.merchant,
        transfer_pair_id=transaction_data.transfer_pair_id  # For transfer linking
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

    # Build conversion fields (per D-01, D-03, D-04)
    conv_amount, conv_rate, conv_date = _build_conversion_fields(
        new_transaction.currency,
        new_transaction.amount,
        current_user.base_currency,
    )

    response = TransactionResponse(
        id=new_transaction.id,
        user_id=new_transaction.user_id,
        source_id=new_transaction.source_id,
        amount=new_transaction.amount,
        currency=new_transaction.currency,
        occurred_at=new_transaction.occurred_at,
        description=new_transaction.description,
        merchant=new_transaction.merchant,
        transfer_pair_id=new_transaction.transfer_pair_id,
        created_at=new_transaction.created_at,
        tags=[tag.tag for tag in new_transaction.tags],
        converted_amount=conv_amount,
        conversion_rate=conv_rate,
        conversion_date=conv_date,
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

    # Batch conversion: one HTTP call for all unique currencies (per D-05)
    unique_currencies = {
        tx.currency.upper()
        for tx in transactions
        if tx.currency.upper() != current_user.base_currency.upper()
    }

    batch_rates: dict | None = None
    if unique_currencies:
        try:
            # fetch_latest_rates(FROM=base, TO=[tx_currencies])
            # Returns {TX_CURRENCY: rate} where rate means: 1 base_currency = rate tx_currency
            # To convert tx.amount (in tx_currency) to base: tx.amount / rate  (per D-05, RESEARCH Pitfall 1)
            batch_rates = rates_service.fetch_latest_rates(
                current_user.base_currency,
                list(unique_currencies),
            )
        except HTTPException:
            batch_rates = None  # All conversions null for this request (per D-06)

    # Build responses
    responses = []
    for tx in transactions:
        conv_amount = None
        conv_rate = None
        conv_date = None

        if (
            tx.currency.upper() != current_user.base_currency.upper()
            and batch_rates is not None
        ):
            rate = batch_rates.get(tx.currency.upper())
            if rate is not None:
                # rate = how many tx_currency per 1 base_currency
                # converted = tx.amount / rate  (direction: tx_currency -> base_currency)
                conv_amount = (tx.amount / rate).quantize(Decimal("0.0001"))
                # Inverse rate: 1 tx_currency = (1/rate) base_currency
                conv_rate = (Decimal("1") / rate).quantize(Decimal("0.000001"))
                conv_date = date.today()

        response = TransactionResponse(
            id=tx.id,
            user_id=tx.user_id,
            source_id=tx.source_id,
            amount=tx.amount,
            currency=tx.currency,
            occurred_at=tx.occurred_at,
            description=tx.description,
            merchant=tx.merchant,
            transfer_pair_id=tx.transfer_pair_id,
            created_at=tx.created_at,
            tags=[tag_obj.tag for tag_obj in tx.tags],
            converted_amount=conv_amount,
            conversion_rate=conv_rate,
            conversion_date=conv_date,
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

    # Build conversion fields (per D-01, D-03, D-04)
    conv_amount, conv_rate, conv_date = _build_conversion_fields(
        transaction.currency,
        transaction.amount,
        current_user.base_currency,
    )

    response = TransactionResponse(
        id=transaction.id,
        user_id=transaction.user_id,
        source_id=transaction.source_id,
        amount=transaction.amount,
        currency=transaction.currency,
        occurred_at=transaction.occurred_at,
        description=transaction.description,
        merchant=transaction.merchant,
        transfer_pair_id=transaction.transfer_pair_id,
        created_at=transaction.created_at,
        tags=[tag.tag for tag in transaction.tags],
        converted_amount=conv_amount,
        conversion_rate=conv_rate,
        conversion_date=conv_date,
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

    # Build conversion fields (per D-01, D-03, D-04)
    conv_amount, conv_rate, conv_date = _build_conversion_fields(
        transaction.currency,
        transaction.amount,
        current_user.base_currency,
    )

    response = TransactionResponse(
        id=transaction.id,
        user_id=transaction.user_id,
        source_id=transaction.source_id,
        amount=transaction.amount,
        currency=transaction.currency,
        occurred_at=transaction.occurred_at,
        description=transaction.description,
        merchant=transaction.merchant,
        transfer_pair_id=transaction.transfer_pair_id,
        created_at=transaction.created_at,
        tags=[tag.tag for tag in transaction.tags],
        converted_amount=conv_amount,
        conversion_rate=conv_rate,
        conversion_date=conv_date,
    )

    return response


@router.delete("/{transaction_id}")
def delete_transaction(
    transaction_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Delete a transaction.

    If the transaction is part of a transfer (has transfer_pair_id),
    all paired transactions will be deleted together.

    Only the owner can delete their transactions.

    Returns:
        - deleted_count: Number of transactions deleted (1 for regular, 2 for transfers)
        - message: Success message
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

    # Check if this is a transfer (has transfer_pair_id)
    if transaction.transfer_pair_id:
        # Delete all transactions with the same transfer_pair_id
        deleted_count = db.query(Transaction).filter(
            Transaction.transfer_pair_id == transaction.transfer_pair_id,
            Transaction.user_id == current_user.id  # Security: ensure all belong to user
        ).delete()

        db.commit()

        return {
            "deleted_count": deleted_count,
            "message": f"Transfer deleted successfully ({deleted_count} transactions)"
        }
    else:
        # Delete single transaction
        db.delete(transaction)
        db.commit()

        return {
            "deleted_count": 1,
            "message": "Transaction deleted successfully"
        }
