/**
 * Decisions §14.64 d / f and §14.65 d: which pages are top-level (no back button) and where
 * every sub-page's back button leads when there is no history to step back through.
 */
import { routes } from '@/domain/routes';

import { type BackTargetOptions, backTargetFor } from '../backTarget';

const L = 'ledger-a';
const RECENT = 'ledger-b';
const TX = 'tx-1';
const PAIR = 'pair-1';
const SOURCE = 'source-1';
const BATCH = 'batch-1';

const l = routes.l(L);
const NARROW: BackTargetOptions = { wide: false, chromeLedgerId: RECENT, hasLedgers: true };
const WIDE: BackTargetOptions = { ...NARROW, wide: true };

describe('top-level pages have no back button', () => {
  test.each([
    ['home', l.home()],
    ['transactions', l.transactions()],
    ['imports', l.imports()],
    ['personal settings (with ledgers)', routes.settings()],
  ])('%s, at both widths', (_name, path) => {
    expect(backTargetFor(path, NARROW)).toBeNull();
    expect(backTargetFor(path, WIDE)).toBeNull();
  });

  test('/accounts is top-level on a wide screen only (the sidebar reaches it)', () => {
    expect(backTargetFor(routes.accounts(), WIDE)).toBeNull();
    expect(backTargetFor(routes.accounts(true), WIDE)).toBeNull();
  });

  test('/accounts on a narrow screen leads home — the home of the ledger the chrome names', () => {
    // Screen 09 at 375 is 「‹ 账户」, and the tab bar has no accounts slot. Accounts are
    // not in any ledger (decision §14.62), so the parent is the chrome's ledger.
    expect(backTargetFor(routes.accounts(), NARROW)).toEqual({
      href: routes.l(RECENT).home(),
      parentKey: 'home',
    });
    expect(backTargetFor(routes.accounts(true), NARROW)).toEqual({
      href: routes.l(RECENT).home(),
      parentKey: 'home',
    });
  });

  test('/accounts has no back button while the chrome’s ledger is unknown', () => {
    expect(backTargetFor(routes.accounts(), { ...NARROW, chromeLedgerId: null })).toBeNull();
    expect(
      backTargetFor(routes.accounts(), { wide: false, chromeLedgerId: null, hasLedgers: false }),
    ).toBeNull();
  });

  test('a query string does not change the answer', () => {
    expect(backTargetFor(`${l.transactions()}?kind=expense`, NARROW)).toBeNull();
    expect(backTargetFor(`${l.home()}?month=2026-09`, NARROW)).toBeNull();
  });
});

describe('every sub-page leads to its parent (the table in §14.64 f)', () => {
  test.each([
    ['transaction detail', l.transaction(TX), l.transactions(), 'transactions'],
    ['transfer detail', l.transfer(PAIR), l.transactions(), 'transactions'],
    ['transaction edit', l.transactionEdit(TX), l.transaction(TX), 'transactions'],
    ['transfer edit', l.transferEdit(PAIR), l.transfer(PAIR), 'transactions'],
    ['new transaction', l.transactionNew(), l.transactions(), 'transactions'],
    ['new account', routes.accountNew(), routes.accounts(), 'sources'],
    ['new account preset to a ledger', routes.accountNew(L), routes.accounts(), 'sources'],
    ['edit account', routes.accountEdit(SOURCE), routes.accounts(), 'sources'],
    ['import upload', l.importsNew(), l.imports(), 'imports'],
    ['import format guide', l.importsGuide(), l.importsNew(), 'imports'],
    ['import batch', l.importBatch(BATCH), l.imports(), 'imports'],
    ['ledger settings', l.settings(), l.home(), 'home'],
    // §14.65 d: the recent ledger's home, not a ledger-list page (there is none).
    ['new ledger', routes.ledgersNew(), routes.l(RECENT).home(), 'home'],
    ['join a ledger', routes.ledgersJoin(), routes.l(RECENT).home(), 'home'],
  ])('%s', (_name, path, href, parentKey) => {
    const expected = { href, parentKey };
    expect(backTargetFor(path, NARROW)).toEqual(expected);
    expect(backTargetFor(path, WIDE)).toEqual(expected);
  });

  test('new transaction keeps its parent when it carries a kind or a return address', () => {
    expect(backTargetFor(l.transactionNew({ kind: 'transfer' }), NARROW)).toEqual({
      href: l.transactions(),
      parentKey: 'transactions',
    });
  });

  test('an import batch deep-linked to one row still leads to the history', () => {
    expect(backTargetFor(l.importBatch(BATCH, { row: '3' }), WIDE)).toEqual({
      href: l.imports(),
      parentKey: 'imports',
    });
  });
});

describe('the /ledgers pages and personal settings depend on the user’s ledgers', () => {
  test('`/ledgers` itself never has a back button: it redirects, or it is the onboarding', () => {
    expect(backTargetFor(routes.ledgers(), NARROW)).toBeNull();
    expect(backTargetFor(routes.ledgers(), WIDE)).toBeNull();
    const none = { wide: false, chromeLedgerId: null, hasLedgers: false };
    expect(backTargetFor(routes.ledgers(), none)).toBeNull();
  });

  test.each([
    ['new ledger', routes.ledgersNew()],
    ['join a ledger', routes.ledgersJoin()],
  ])('%s has no back button while the recent ledger is still unknown', (_name, path) => {
    expect(backTargetFor(path, { ...NARROW, chromeLedgerId: null })).toBeNull();
    expect(backTargetFor(path, { ...WIDE, chromeLedgerId: null })).toBeNull();
  });

  test.each([
    ['new ledger', routes.ledgersNew()],
    ['join a ledger', routes.ledgersJoin()],
  ])('%s leads to the onboarding page for a user with no ledger at all', (_name, path) => {
    const none = { wide: true, chromeLedgerId: null, hasLedgers: false };
    expect(backTargetFor(path, none)).toEqual({ href: routes.ledgers(), parentKey: 'ledgers' });
  });

  test('personal settings leads to the onboarding list for a user with no ledger', () => {
    const none = { wide: false, chromeLedgerId: null, hasLedgers: false };
    expect(backTargetFor(routes.settings(), none)).toEqual({
      href: routes.ledgers(),
      parentKey: 'ledgers',
    });
    expect(backTargetFor(routes.settings(), { ...none, wide: true })).toEqual({
      href: routes.ledgers(),
      parentKey: 'ledgers',
    });
  });

  test('personal settings is top-level for a user with ledgers', () => {
    expect(backTargetFor(routes.settings(), NARROW)).toBeNull();
  });
});

describe('unknown paths', () => {
  test.each([
    '/',
    '/login',
    '/register',
    '/nowhere',
    `/l/${L}/reports`,
    `/l/${L}/transactions/${TX}/history`,
    `/l/${L}/sources`,
    `/l/${L}/sources/new`,
    `/l/${L}/sources/${SOURCE}/edit`,
    `/accounts/${SOURCE}`,
    `/accounts/${SOURCE}/edit/more`,
    '/accountsx',
    `/l/${L}/imports/${BATCH}/rows`,
    '/l/',
  ])('%s has no back target', (path) => {
    expect(backTargetFor(path, NARROW)).toBeNull();
  });
});
