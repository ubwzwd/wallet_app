"""
FastAPI application entry point.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.errors import install_error_handlers
from app.api import rates

# Create FastAPI app
app = FastAPI(
    title=settings.PROJECT_NAME,
    debug=settings.DEBUG,
    version="3.0.0-dev",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

install_error_handlers(app)

# Include routers
app.include_router(rates.router, prefix="/api/v1")


@app.get("/health")
def health_check():
    """Health check endpoint for monitoring and load balancers."""
    return {
        "status": "healthy",
        "environment": settings.ENVIRONMENT,
        "version": "3.0.0-dev"
    }


@app.get("/")
def root():
    """Root endpoint with API information."""
    return {
        "message": "Wallet App API",
        "version": "3.0.0-dev",
        "docs": "/docs",
        "health": "/health"
    }

