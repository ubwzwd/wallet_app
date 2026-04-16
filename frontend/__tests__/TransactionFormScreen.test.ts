/**
 * XFER-01/02/03: Transfer creation wizard static analysis tests.
 *
 * Verifies that TransactionFormScreen.tsx implements the full two-step transfer
 * wizard: enabled Transfer tab (XFER-03), two-step flow with source pickers
 * (XFER-01), and paired sequential POST creation with rollback (XFER-02).
 *
 * Uses static source analysis (fs.readFileSync + toContain) — same pattern as
 * CurrencyPicker.test.ts.
 */
import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(
  path.join(__dirname, '../src/screens/TransactionFormScreen.tsx'),
  'utf8'
);

// ─── XFER-03: Transfer button enabled ────────────────────────────────────────

describe('XFER-03: Transfer button enabled', () => {
  it('does not contain hardcoded "Transfer support coming soon" text', () => {
    expect(SOURCE).not.toContain('Transfer support coming soon');
  });

  it('contains single-source guard hint for users with one source', () => {
    expect(SOURCE).toContain('Add another finance source to enable transfers.');
  });

  it('disables Transfer button conditionally based on sources count', () => {
    expect(SOURCE).toContain('sources.length <= 1');
  });
});

// ─── XFER-01: Two-step wizard ─────────────────────────────────────────────────

describe('XFER-01: Two-step wizard', () => {
  it('contains Step 1 of 2 step indicator', () => {
    expect(SOURCE).toContain('Step 1 of 2');
  });

  it('contains Step 2 of 2 step indicator', () => {
    expect(SOURCE).toContain('Step 2 of 2');
  });

  it('contains destinationSourceId state variable', () => {
    expect(SOURCE).toContain('destinationSourceId');
  });

  it('contains Select Destination modal title', () => {
    expect(SOURCE).toContain('Select Destination');
  });

  it('contains Next button for advancing to step 2', () => {
    expect(SOURCE).toContain('Next');
  });

  it('contains Back button for returning to step 1', () => {
    expect(SOURCE).toContain('Back');
  });

  it('contains Create Transfer submit button text', () => {
    expect(SOURCE).toContain('Create Transfer');
  });
});

// ─── XFER-02: Paired transfer creation ───────────────────────────────────────

describe('XFER-02: Paired transfer creation', () => {
  it('uses crypto.randomUUID() for client-side pair ID generation', () => {
    expect(SOURCE).toContain('crypto.randomUUID()');
  });

  it('passes transfer_pair_id to both transaction legs', () => {
    expect(SOURCE).toContain('transfer_pair_id');
  });

  it('negates amount for debit leg', () => {
    expect(SOURCE).toContain('-absAmount');
  });

  it('calls deleteTransaction for rollback on partial failure', () => {
    expect(SOURCE).toContain('deleteTransaction');
  });

  it('shows Transfer partially created message on rollback failure', () => {
    expect(SOURCE).toContain('Transfer partially created');
  });

  it('shows Transfer created successfully! on success', () => {
    expect(SOURCE).toContain('Transfer created successfully!');
  });
});

// ─── D-10/D-11: Transfer edit mode ───────────────────────────────────────────

describe('D-10/D-11: Transfer edit mode', () => {
  it('shows "Update Transfer" button text for edit mode', () => {
    expect(SOURCE).toContain('Update Transfer');
  });

  it('shows read-only note about source and currency', () => {
    expect(SOURCE).toContain('Source and currency cannot be changed on an existing transfer.');
  });

  it('uses queryClient.getQueryData to find paired leg from cache', () => {
    expect(SOURCE).toContain('getQueryData');
  });

  it('calls updateTransaction for the paired leg', () => {
    expect(SOURCE).toContain('updateTransaction(pairedLeg.id');
  });

  it('shows "Transfer updated successfully!" on success', () => {
    expect(SOURCE).toContain('Transfer updated successfully!');
  });

  it('has a fallback fetch when cache is empty', () => {
    expect(SOURCE).toContain('getTransactions()');
  });
});
