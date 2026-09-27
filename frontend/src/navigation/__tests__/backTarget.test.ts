/**
 * Decisions §14.64 d / f, §14.65 d and §14.66 g: which pages are top-level (no back button)
 * and where every sub-page's back button leads when there is no history to step back
 * through. The paths name the page only, so no answer depends on which ledger is current.
 */
import { routes } from '@/domain/routes';

import { type BackTargetOptions, backTargetFor } from '../backTarget';

const TX = 'tx-1';
const PAIR = 'pair-1';
const SOURCE = 'source-1';
const BATCH = 'batch-1';

const NARROW: BackTargetOptions = { wide: false, hasLedgers: true };
const WIDE: BackTargetOptions = { ...NARROW, wide: true };
const NONE_NARROW: BackTargetOptions = { wide: false, hasLedgers: false };
const NONE_WIDE: BackTargetOptions = { wide: true, hasLedgers: false };

describe('top-level pages have no back button', () => {
  test.each([
    ['home', routes.home()],
    ['transactions', routes.transactions()],
    ['imports', routes.imports()],
    ['personal settings (with ledgers)', routes.settings()],
  ])('%s, at both widths', (_name, path) => {
    expect(backTargetFor(path, NARROW)).toBeNull();
    expect(backTargetFor(path, WIDE)).toBeNull();
  });

  test('/accounts is top-level on a wide screen only (the sidebar reaches it)', () => {
    expect(backTargetFor(routes.accounts(), WIDE)).toBeNull();
    expect(backTargetFor(routes.accounts(true), WIDE)).toBeNull();
  });

  test('/accounts on a narrow screen leads to /home', () => {
    // Screen 09 at 375 is 「‹ 账户」, and the tab bar has no accounts slot.
    const home = { href: routes.home(), parentKey: 'home' };
    expect(backTargetFor(routes.accounts(), NARROW)).toEqual(home);
    expect(backTargetFor(routes.accounts(true), NARROW)).toEqual(home);
  });

  test('/accounts has no back button for a user with no ledger (there is no home)', () => {
    expect(backTargetFor(routes.accounts(), NONE_NARROW)).toBeNull();
  });

  test('a query string or a trailing slash does not change the answer', () => {
    expect(backTargetFor(`${routes.transactions()}?kind=expense`, NARROW)).toBeNull();
    expect(backTargetFor(`${routes.home()}?month=2026-09`, NARROW)).toBeNull();
    expect(backTargetFor(`${routes.home()}/`, NARROW)).toBeNull();
  });
});

describe('every sub-page leads to its parent (§14.66 g)', () => {
  test.each([
    ['transaction detail', routes.transaction(TX), routes.transactions(), 'transactions'],
    ['transfer detail', routes.transfer(PAIR), routes.transactions(), 'transactions'],
    ['transaction edit', routes.transactionEdit(TX), routes.transaction(TX), 'transactions'],
    ['transfer edit', routes.transferEdit(PAIR), routes.transfer(PAIR), 'transactions'],
    ['new transaction', routes.transactionNew(), routes.transactions(), 'transactions'],
    ['new account', routes.accountNew(), routes.accounts(), 'sources'],
    ['new account preset to a ledger', routes.accountNew('ledger-a'), routes.accounts(), 'sources'],
    ['edit account', routes.accountEdit(SOURCE), routes.accounts(), 'sources'],
    ['import upload', routes.importsNew(), routes.imports(), 'imports'],
    ['import format guide', routes.importsGuide(), routes.importsNew(), 'imports'],
    ['import batch', routes.importBatch(BATCH), routes.imports(), 'imports'],
    ['ledger settings', routes.ledgerSettings(), routes.home(), 'home'],
    // §14.65 d: home, not a ledger-list page (there is none).
    ['new ledger', routes.ledgersNew(), routes.home(), 'home'],
    ['join a ledger', routes.ledgersJoin(), routes.home(), 'home'],
  ])('%s', (_name, path, href, parentKey) => {
    const expected = { href, parentKey };
    expect(backTargetFor(path, NARROW)).toEqual(expected);
    expect(backTargetFor(path, WIDE)).toEqual(expected);
  });

  test('new transaction keeps its parent when it carries a kind or a return address', () => {
    expect(
      backTargetFor(routes.transactionNew({ kind: 'transfer', next: '/home' }), NARROW),
    ).toEqual({ href: routes.transactions(), parentKey: 'transactions' });
  });
});

describe('the /ledgers pages and personal settings depend on the user’s ledgers', () => {
  test('`/ledgers` itself never has a back button: it redirects, or it is the onboarding', () => {
    expect(backTargetFor(routes.ledgers(), NARROW)).toBeNull();
    expect(backTargetFor(routes.ledgers(), WIDE)).toBeNull();
    expect(backTargetFor(routes.ledgers(), NONE_NARROW)).toBeNull();
  });

  test.each([
    ['new ledger', routes.ledgersNew()],
    ['join a ledger', routes.ledgersJoin()],
  ])('%s leads to the onboarding page for a user with no ledger at all', (_name, path) => {
    const onboarding = { href: routes.ledgers(), parentKey: 'ledgers' };
    expect(backTargetFor(path, NONE_WIDE)).toEqual(onboarding);
    expect(backTargetFor(path, NONE_NARROW)).toEqual(onboarding);
  });

  test('personal settings leads to the onboarding page for a user with no ledger', () => {
    const onboarding = { href: routes.ledgers(), parentKey: 'ledgers' };
    expect(backTargetFor(routes.settings(), NONE_NARROW)).toEqual(onboarding);
    expect(backTargetFor(routes.settings(), NONE_WIDE)).toEqual(onboarding);
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
    '/reports',
    `/transactions/${TX}/history`,
    `/transfers/${PAIR}/history`,
    `/imports/${BATCH}/rows`,
    '/sources',
    `/accounts/${SOURCE}`,
    `/accounts/${SOURCE}/edit/more`,
    '/accountsx',
    '/homes',
    '/ledgerx',
  ])('%s has no back target', (path) => {
    expect(backTargetFor(path, NARROW)).toBeNull();
  });
});
