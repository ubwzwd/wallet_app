# Phase 1: Wire, Fix, and Harden - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the discussion.

**Date:** 2026-04-05
**Phase:** 01-wire-fix-and-harden
**Mode:** discuss
**Areas analyzed:** Rate freshness, Currency picker on native, List conversion performance

## Gray Areas Identified

| Area | Status |
|------|--------|
| Rate freshness for conversion | Skipped — Claude's discretion |
| Currency picker on native | Discussed |
| List conversion performance | Discussed |

## Assumptions Accepted (Skipped)

### Rate freshness
- **Decision:** Use `/latest` (today's rate). `conversion_date = date.today()`.
- **Reason:** `rates.py` already calls `/latest`; no historical endpoint needed; accurate enough for display.
- **Status:** Claude's discretion — user did not select for discussion.

## Decisions Made

### Currency picker on native
- **Options presented:** FlatList modal (no new deps), Web-only + TextInput on native, TextInput with search
- **User selected:** FlatList modal (Recommended)
- **Decision:** Full-screen `Modal` + `FlatList` on native; `<select>` on web. No new dependencies.

### List conversion performance
- **Options presented:** Batch by currency pair, Skip conversion on list, Single rates fetch for all
- **User selected:** Batch by currency pair (Recommended)
- **Decision:** Collect unique `tx.currency` values, call `fetch_latest_rates` once per request, apply in memory.

## Corrections Made

No corrections — first-time context capture.

---

*Discussion log: 2026-04-05*
