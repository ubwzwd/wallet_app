---
status: complete
phase: 01-wire-fix-and-harden
source: 01-01-SUMMARY.md, 01-02-SUMMARY.md
started: 2026-04-20T00:00:00Z
updated: 2026-04-20T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Transaction list shows conversion fields
expected: |
  Open the transactions list. For any transaction in a different currency than your base currency, verify that the row shows:
  - converted_amount: a numeric value (not null)
  - conversion_rate: a numeric value (not null)
  - conversion_date: a date string (not null)
  
  If the Frankfurter API is unreachable, the transaction should still load with HTTP 200 (not 503), but those fields may be null.
result: pass

### 2. Single transaction delete confirmation
expected: |
  In the transactions list, delete a single (non-transfer) transaction. A dialog should appear with:
  - title: "Delete Transaction"
  - message: "Are you sure you want to delete this transaction?"
  - cancel button: "Keep Transaction" (cancel style)
  - confirm button: "Delete Transaction" (destructive/red style)
  
  Verify the destructive button style (red color).
result: pass

### 3. Transfer delete confirmation
expected: |
  In the transactions list, delete a transfer (paired transaction with transfer_pair_id). A dialog should appear with:
  - title: "Delete Transfer"
  - message: "This will delete BOTH sides of the transfer. Continue?"
  - cancel button: "Keep Transfer" (cancel style)
  - confirm button: "Delete Transfer" (destructive/red style)
  
  Verify the destructive button style (red color).
result: pass

### 4. Archive finance source error dialog
expected: |
  If archiving a finance source fails (e.g., network error), a native error dialog should appear with:
  - title: "Error"
  - message: "Failed to update finance source. Check your connection and try again."
  
  The dialog should be dismissible and allow retry.
result: skipped
reason: Requires triggering a network failure, defer for now

### 5. Web currency picker shows 31+ currencies
expected: |
  On web (browser): open the transaction form and focus on the currency field. A horizontal scrollable row of currency buttons should appear showing:
  - At least 31 distinct currency codes (USD, EUR, GBP, etc.)
  - Buttons are interactive and selectable
  - No hardcoded 6-item limit visible
  
  Scroll through and verify the list is comprehensive, not truncated.
result: pass

### 6. Native currency picker modal with full list
expected: |
  On iOS/Android: open the transaction form and tap the currency picker. A full-screen modal should appear with:
  - title: "Select Currency" at the top
  - "Close" button in the top-right
  - A scrollable list showing 31+ items in format "CODE - Full Name" (e.g., "USD - US Dollar", "EUR - Euro")
  - Selected item background color is light blue (#eff6ff)
  - Modal dismisses when tapping "Close" or selecting a currency
  
  Scroll to verify all 31+ currencies are present, not truncated.
result: pass

## Summary

total: 6
passed: 5
issues: 0
pending: 0
skipped: 1
blocked: 0

## Gaps

[none yet]
