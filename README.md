# Wallet App

A cross-platform expense tracking application with multi-currency support and AI-powered receipt parsing.

## 🎉 Status: M1 Core Complete ✅

The web application is **fully functional** with all core features implemented!

### ✅ What's Working Now

**User Management**
- ✅ User registration and login
- ✅ JWT authentication with persistent login
- ✅ Secure password hashing (bcrypt)

**Finance Sources**
- ✅ Create and manage payment sources (bank accounts, credit cards, cash, etc.)
- ✅ Archive/unarchive inactive sources
- ✅ Multi-currency support per source

**Transactions**
- ✅ Record income and expenses
- ✅ Multi-currency transactions (USD, EUR, GBP, CNY, SGD, HKD)
- ✅ Add tags, descriptions, and merchant info
- ✅ Edit and delete transactions
- ✅ Color-coded display (green for income, red for expense)
- ✅ Transfer transaction support with paired deletion

**Currency Support**
- ✅ 6 supported currencies with real-time exchange rates
- ✅ Frankfurter API integration (ECB data)
- ✅ Automatic retry on API failures

**User Experience**
- ✅ Clean, modern web interface
- ✅ Intuitive navigation with Home buttons
- ✅ Responsive design (mobile-ready)
- ✅ Pull-to-refresh on lists
- ✅ Empty states with helpful messages

## Features

- **Multi-Currency Support**: Track expenses in any currency with real-time exchange rates
- **Finance Source Management**: Support for checking accounts, credit cards, cash, investments, and more
- **Smart Tagging**: Organize transactions with flexible tags and categories
- **Persistent Login**: Stay logged in across browser sessions
- **AI-Powered OCR** (Coming in M3): Upload receipts and let AI automatically parse transaction details
- **Cross-Platform**: Web ready, Android/iOS via Expo (M2+)

## Tech Stack

### Frontend
- Expo (React Native + React Native Web)
- TypeScript
- NativeWind (Tailwind CSS)
- TanStack Query
- Zod

### Backend
- FastAPI
- PostgreSQL
- SQLAlchemy 2.0
- Alembic (migrations)
- Pydantic v2

### Infrastructure
- **Cloud**: AWS (ECS Fargate, RDS PostgreSQL, S3 + CloudFront)
- **Local Dev**: Docker Compose

## Roadmap

- ✅ **M1** (COMPLETED): Web core functionality (auth, finance sources, transactions, multi-currency)
- **M2** (NEXT): Android mobile app
- **M3**: AI-powered receipt parsing with OCR + LLM
- **M4**: Statistics dashboard with charts and insights
- **M5**: AI consumption analysis and recommendations
- **M6**: iOS and Windows support

## Getting Started

### Prerequisites
- Docker and Docker Compose
- Node.js 18+ (for frontend)
- Python 3.11+ (for backend)

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/ubwzwd/wallet_app.git
   cd wallet_app
   ```

2. **Start the backend**
   ```bash
   cd backend
   docker-compose up -d  # Start PostgreSQL
   poetry install        # Install dependencies
   alembic upgrade head  # Run migrations
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

3. **Start the frontend**
   ```bash
   cd frontend
   npm install
   npm run web
   ```

4. **Open your browser**
   - Navigate to `http://localhost:8081`
   - Register a new account or use demo: `user@test.com` / `password123`

### Test Account
- **Email**: `user@test.com`
- **Password**: `password123`

## Documentation

See [SPEC.md](./SPEC.md) for detailed product and engineering specifications.

## License

Copyright © 2025. All rights reserved.

This is a private project. Unauthorized copying, distribution, or use of this software is strictly prohibited.

