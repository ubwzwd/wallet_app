/**
 * Decision §14.66 a / c / d: which paths are the ledger pages, and where a ledger switch
 * leaves the page it happens on.
 */
import { routes } from '@/domain/routes';

import { barePath, isLedgerRoute, ledgerSwitchTarget } from '../ledgerRoute';

describe('isLedgerRoute — the pages RequireLedger guards', () => {
  test.each([
    routes.home(),
    routes.transactions(),
    routes.transactionNew({ kind: 'income' }),
    routes.transaction('tx-1'),
    routes.transactionEdit('tx-1'),
    routes.transfer('pair-1'),
    routes.transferEdit('pair-1'),
    routes.imports(),
    routes.importsNew(),
    routes.importsGuide(),
    routes.importBatch('b-1'),
    routes.ledgerSettings(),
    `${routes.home()}/`,
  ])('%s is a ledger page', (path) => {
    expect(isLedgerRoute(path)).toBe(true);
  });

  test.each([
    '/',
    routes.settings(),
    routes.accounts(),
    routes.accountNew('ledger-a'),
    routes.accountEdit('src-1'),
    routes.ledgers(),
    routes.ledgersNew(),
    routes.ledgersJoin(),
    routes.login('/home'),
    '/homes',
    '/transactionsx',
    '/nowhere',
  ])('%s opens with no ledger at all', (path) => {
    expect(isLedgerRoute(path)).toBe(false);
  });
});

describe('ledgerSwitchTarget — a switch keeps the page unless it names an old record', () => {
  test.each([
    [routes.transaction('tx-1'), routes.transactions()],
    [routes.transactionEdit('tx-1'), routes.transactions()],
    // There is no transfer list: the transaction list is the closest one.
    [routes.transfer('pair-1'), routes.transactions()],
    [routes.transferEdit('pair-1'), routes.transactions()],
    [routes.importBatch('b-1'), routes.imports()],
  ])('%s falls back to %s', (path, list) => {
    expect(ledgerSwitchTarget(path)).toBe(list);
  });

  test.each([
    routes.home(),
    routes.transactions(),
    routes.transactionNew(),
    routes.transactionNew({ kind: 'income', next: '/home' }),
    routes.imports(),
    routes.importsNew(),
    routes.importsGuide(),
    routes.ledgerSettings(),
    routes.settings(),
    routes.accounts(),
    routes.accountEdit('src-1'),
    routes.ledgersNew(),
  ])('%s stays put', (path) => {
    expect(ledgerSwitchTarget(path)).toBeNull();
  });
});

describe('ledgerSwitchTarget — 记一笔 drops the entry parameters naming old records', () => {
  test.each([
    // The account, the refunded original and the copied entry are the old ledger's.
    [
      routes.transactionNew({ kind: 'income', source_id: 's-1' }),
      routes.transactionNew({ kind: 'income' }),
    ],
    [routes.transactionNew({ copy_of: 'tx-1' }), routes.transactionNew()],
    [
      routes.transactionNew({
        kind: 'expense',
        source_id: 's-1',
        next: '/imports/b-1',
      }),
      routes.transactionNew({ kind: 'expense' }),
    ],
    // `?refund_of=` alone opened the refund tab: the tab is kept, spelled out.
    [routes.transactionNew({ refund_of: 'tx-1' }), routes.transactionNew({ kind: 'refund' })],
    [
      routes.transactionNew({
        kind: 'refund',
        refund_of: 'tx-1',
        next: '/transactions/tx-1',
      }),
      routes.transactionNew({ kind: 'refund' }),
    ],
  ])('%s → %s', (url, target) => {
    expect(ledgerSwitchTarget(url)).toBe(target);
  });

  test('the query can come from the router instead, since usePathname() has none', () => {
    const path = routes.transactionNew();
    expect(ledgerSwitchTarget(path, { kind: 'transfer', source_id: 's-1' })).toBe(
      routes.transactionNew({ kind: 'transfer' }),
    );
    expect(ledgerSwitchTarget(path, { copy_of: ['tx-1', 'tx-2'] })).toBe(routes.transactionNew());
    expect(ledgerSwitchTarget(path, '?refund_of=tx-1')).toBe(
      routes.transactionNew({ kind: 'refund' }),
    );
    // Only the kind and `next`: nothing of the old ledger's to drop.
    expect(ledgerSwitchTarget(path, { kind: 'income', next: '/home' })).toBeNull();
    expect(ledgerSwitchTarget(path, { source_id: '' })).toBeNull();
  });

  test('an unknown kind is not carried over', () => {
    expect(ledgerSwitchTarget('/transactions/new?kind=bogus&source_id=s-1')).toBe(
      routes.transactionNew(),
    );
  });
});

test('barePath drops the query, the hash and a trailing slash — but never the root', () => {
  expect(barePath('/transactions/new?kind=income#top')).toBe('/transactions/new');
  expect(barePath('/home/')).toBe('/home');
  expect(barePath('/')).toBe('/');
});
