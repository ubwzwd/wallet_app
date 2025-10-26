# Wallet App

A cross-platform expense tracking application with multi-currency support and AI-powered receipt parsing.

## Features

- **Multi-Currency Support**: Track expenses in any currency with automatic conversion based on transaction-day exchange rates
- **Multi-Account Management**: Support for checking accounts, credit cards, and other account types
- **Smart Tagging**: Organize transactions with flexible tags and categories
- **AI-Powered OCR** (Coming in M3): Upload receipts and let AI automatically parse transaction details
- **Cross-Platform**: Web, Android, iOS support via Expo

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

- **M1**: Web core functionality (auth, accounts, transactions, currency conversion)
- **M2**: Android mobile app
- **M3**: AI-powered receipt parsing with OCR + LLM
- **M4**: Statistics dashboard with charts and insights
- **M5**: AI consumption analysis and recommendations
- **M6**: iOS and Windows support

## Documentation

See [SPEC.md](./SPEC.md) for detailed product and engineering specifications.

## License

Private project - All rights reserved

