# UI Redesign v2 — Design Package

**Source:** Claude Design (Claude.ai)
**Captured:** 2026-05-24
**Original archive:** `wallet-ui-design.zip` (369 KB, repo root, gitignored)

## What this is

A self-contained UI redesign proposal for the Wallet App frontend — clean fintech aesthetic with bottom-tab navigation, dashboard-style home, and a centralized design-token system. Produced by Claude Design after reading the repo at branch `gsd/phase-05-pwa-ify-frontend-mobile-polish`.

## What's inside

- `spec.md` — Full design specification (Chinese): tokens, components, screen layouts, implementation notes. ~390 lines.
- `images/01-current-home.png` — Faithful render of the current home screen (pre-redesign baseline).
- `images/02-new-home.png` — Proposed dashboard home with bottom tabs + center FAB.
- `images/03-transactions-and-form.png` — Proposed transactions list (grouped by date, swipe actions) + add-transaction form (segmented control + large amount input).
- `images/04-login.png` — Proposed login screen with brand logo + leading-icon inputs.

## Scope vs Phase 5 (read before planning)

Per the spec's own §6.1, this redesign is **larger than Phase 5's scope** ("PWA-ify + mobile polish"). Phase 5 is locked to incremental polish on the current UI (PWA manifest, service worker, 44×44 touch targets, safe-area insets, 16px input font-size). This redesign overlays:

- **Information architecture changes:** dashboard home, bottom tab nav, new ListRow / SegmentedControl / FilterChip / BottomTabBar components.
- **Backend dependency:** the dashboard's "total balance", "monthly in/out", "per-account balance" require aggregation endpoints that **don't exist yet** (spec §6.3). A backend phase must precede the redesign phase.
- **Compatible with Phase 5 conclusions:** `minHeight: 44, minWidth: 44` (MOBUI-01) and `fontSize: 16` on inputs (MOBUI-03) are already in the new spec — no conflict.

Suggested phase sequencing:

1. **Phase 5** (current, locked) — PWA-ify on the existing UI.
2. **Phase 6 (new)** — Backend aggregation: `GET /summary` + `finance-sources[].balance` field.
3. **Phase 7+ (new)** — Frontend redesign per this spec (tokens → ListRow → BottomTabBar → dashboard → transactions list → add-transaction form → login).

## How to use this in future planning

When opening `/gsd:discuss-phase` for Phase 6 or Phase 7, point CONTEXT at this directory:

```
.planning/research/ui-redesign-v2/spec.md
.planning/research/ui-redesign-v2/images/02-new-home.png
```

The spec is highly opinionated and concrete — it's an executable design contract for the redesign work, not just an inspiration board. Tokens in §2 are the single source of truth (the spec explicitly says so).

## Limitations / open questions for the redesign phase

- The spec is mobile-first. Tablet / desktop web (≥1024px) layouts are not specified — Phase 7 should define those.
- Dark mode is mentioned (§6.6) as a token-table extension but not designed.
- The Stats tab is reserved but not designed (per spec §4.5, deferred to SPEC M4).
- The Transfer mode of the add-transaction form is described in text (§4.3) but not visualized — designer must extend.
- Swipe gestures on the transactions list (§6.5) have no Web fallback designed — spec suggests "row-end menu or hover-reveal", but layout is not drawn.
