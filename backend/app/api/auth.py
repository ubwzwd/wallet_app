"""Authentication endpoints for user registration and login."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.database import get_db
from app.core.security import (
    get_password_hash,
    authenticate_user,
    create_access_token,
    get_current_user,
)
from app.models.user import User
from app.models.finance_source import FinanceSource
from app.schemas.user import UserCreate, UserLogin, UserResponse, Token, UserUpdate

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """
    Register a new user and return access token.
    
    - **email**: Valid email address (must be unique)
    - **password**: At least 8 characters
    - **base_currency**: ISO 4217 currency code (e.g., USD, EUR, GBP)
    
    Returns JWT access token for immediate login.
    """
    # Check if user already exists
    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new user
    hashed_password = get_password_hash(user_data.password)
    
    new_user = User(
        email=user_data.email,
        password_hash=hashed_password,
        base_currency=user_data.base_currency.upper(),  # Normalize to uppercase
    )
    
    try:
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create access token for immediate login
    access_token = create_access_token(data={"sub": str(new_user.id)})
    
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/login", response_model=Token)
def login(user_credentials: UserLogin, db: Session = Depends(get_db)):
    """
    Authenticate user and return JWT access token.
    
    - **email**: Registered email address
    - **password**: User's password
    
    Returns a JWT token that should be included in subsequent requests as:
    `Authorization: Bearer <token>`
    """
    user = authenticate_user(db, user_credentials.email, user_credentials.password)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Create JWT token with user ID as subject
    access_token = create_access_token(data={"sub": str(user.id)})
    
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
def get_current_user_info(current_user: User = Depends(get_current_user)):
    """
    Get current authenticated user information.

    Requires valid JWT token in Authorization header.
    """
    return current_user


@router.patch("/me", response_model=UserResponse)
def update_current_user(
    user_data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Update current user profile (partial update).

    - **base_currency**: ISO 4217 currency code (normalized to uppercase)
    - **default_source_id**: ID of the user's default finance source (must be owned by user)
    """
    # D-07: ownership check when default_source_id is provided
    if user_data.default_source_id is not None:
        source = db.query(FinanceSource).filter(
            FinanceSource.id == user_data.default_source_id,
            FinanceSource.user_id == current_user.id,
        ).first()
        if not source:
            raise HTTPException(status_code=404, detail="Finance source not found")

    update_fields = user_data.model_dump(exclude_unset=True)

    # D-08: normalize base_currency to uppercase
    if "base_currency" in update_fields and update_fields["base_currency"]:
        update_fields["base_currency"] = update_fields["base_currency"].upper()

    for field, value in update_fields.items():
        setattr(current_user, field, value)

    db.commit()
    db.refresh(current_user)
    return current_user

