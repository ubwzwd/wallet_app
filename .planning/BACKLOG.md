# Backlog

Ideas and future milestone scope captured from original SPEC.md (2025-10-26).

## Future Milestones

### M2 — Android Mobile Polish
- Expo EAS internal Android build
- Mobile UX polish (existing Expo app already targets native)

### M3 — Receipt OCR + LLM Auto-Book
- Upload photo/PDF → synchronous OCR + LLM parse → user confirms/edits → insert
- No file storage needed (temp processing only)
- API: `POST /ingest/parse-receipt` (multipart) → parsed_transactions[]
- API: `POST /transactions/batch` — bulk create confirmed transactions
- LLM: OpenAI/Gemini via LiteLLM or provider SDK
- OCR: Tesseract or PaddleOCR; PDFs: pdfplumber/pypdf

### M4 — Charts & Tags
- Manual tags + LLM auto-categorization (suggested primary tag, user can override)
- Recommended tag set: Clothing, Food, Housing, Transport, Entertainment, Healthcare, Education, Utilities, Travel, Other
- Stats API: `GET /stats/summary`, `/stats/by-category`, `/stats/time-series?granularity=day|week|month`
- Charting lib TBD: Victory, Recharts (web), react-native-svg-based (native)

### M5 — LLM Insights
- Habit analysis, spend suggestions, anomaly detection

### M6 — iOS + Windows
- iOS: Expo EAS build
- Windows: PWA or optional Electron wrapper

## Infrastructure

**AWS Production Target:**
- Backend: ECS Fargate (0.25 vCPU / 0.5GB RAM) behind ALB
- Database: RDS PostgreSQL (db.t4g.micro)
- Frontend: S3 + CloudFront
- Secrets: AWS Secrets Manager or Parameter Store
- Estimated cost: ~$20-35/month after free tier

## Open Questions

- Which charting library? (Victory, Recharts for Web, react-native-svg for native)
- Tag localization strategy?
- CSV/JSON export for power users?

---
*Sourced from SPEC.md on 2026-04-05*
