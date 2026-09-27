/** 04 §1.2 route table (decision §14.66 a), §1.5 rule 1 (safeNext). */
import * as routeModule from '../routes';
import { routes, safeNext } from '../routes';

const LID = '2f1c1111-2222-3333-4444-555566667777';

describe('routes table matches 04 §1.2 verbatim (§14.66 a)', () => {
  test('top-level routes', () => {
    expect(routes.login()).toBe('/login');
    expect(routes.login('/transactions/tx1')).toBe('/login?next=%2Ftransactions%2Ftx1');
    expect(routes.register()).toBe('/register');
    expect(routes.register('/home')).toBe('/register?next=%2Fhome');
    expect(routes.ledgers()).toBe('/ledgers');
    expect(routes.ledgersNew()).toBe('/ledgers/new');
    expect(routes.ledgersJoin()).toBe('/ledgers/join');
    expect(routes.settings()).toBe('/settings');
  });

  test('accounts live outside any ledger (decision §14.62)', () => {
    expect(routes.accounts()).toBe('/accounts');
    expect(routes.accounts(true)).toBe('/accounts?include_archived=1');
    expect(routes.accountNew()).toBe('/accounts/new');
    expect(routes.accountNew(LID)).toBe(`/accounts/new?ledger=${LID}`);
    expect(routes.accountEdit('s1')).toBe('/accounts/s1/edit');
  });

  test('the ledger pages name the page, never the ledger', () => {
    expect(routes.home()).toBe('/home');
    expect(routes.transactions()).toBe('/transactions');
    expect(routes.transaction('tx1')).toBe('/transactions/tx1');
    expect(routes.transactionEdit('tx1')).toBe('/transactions/tx1/edit');
    expect(routes.transfer('pair1')).toBe('/transfers/pair1');
    expect(routes.transferEdit('pair1')).toBe('/transfers/pair1/edit');
    expect(routes.imports()).toBe('/imports');
    expect(routes.importsNew()).toBe('/imports/new');
    expect(routes.importsGuide()).toBe('/imports/guide');
    expect(routes.importBatch('b1')).toBe('/imports/b1');
    expect(routes.ledgerSettings()).toBe('/ledger');
  });

  test('记一笔 keeps the parameters that only matter on entry (§14.66 f)', () => {
    expect(routes.transactionNew()).toBe('/transactions/new');
    expect(routes.transactionNew({ kind: 'expense', source_id: 's1' })).toBe(
      '/transactions/new?kind=expense&source_id=s1',
    );
    expect(routes.transactionNew({ kind: 'refund', refund_of: 'tx1', next: '/transactions' })).toBe(
      '/transactions/new?kind=refund&refund_of=tx1&next=%2Ftransactions',
    );
    expect(routes.transactionNew({ copy_of: 'tx1' })).toBe('/transactions/new?copy_of=tx1');
    expect(routes.transactionNew({ kind: 'expense', copy_of: 'tx1', next: '/home' })).toBe(
      '/transactions/new?kind=expense&copy_of=tx1&next=%2Fhome',
    );
  });

  test('the URL-rewriting helpers went with the ledger segment: only the table and safeNext', () => {
    expect(Object.keys(routeModule).sort()).toEqual(['routes', 'safeNext']);
  });

  test('no per-ledger builder survives: the ledger is the tab\'s, not the address\'s', () => {
    const table = routes as Record<string, unknown>;
    expect(table.l).toBeUndefined();
    // The ledger-scoped account builders are gone, not kept as aliases (§14.42).
    expect(table.sources).toBeUndefined();
    expect(table.sourceNew).toBeUndefined();
    expect(table.sourceEdit).toBeUndefined();
  });
});

describe('safeNext (04 §1.5 rule 1)', () => {
  test('rejects protocol-relative, foreign schemes, backslashes, control chars', () => {
    expect(safeNext('//evil')).toBeNull();
    expect(safeNext('https://x')).toBeNull();
    expect(safeNext('/\\x')).toBeNull();
    expect(safeNext('javascript:alert(1)')).toBeNull();
    expect(safeNext('/ok\nmore')).toBeNull();
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext('')).toBeNull();
    expect(safeNext('relative/path')).toBeNull(); // must start with '/'
  });

  test('rejects every ASCII control character, not just CR/LF', () => {
    expect(safeNext('/ok\u0000evil')).toBeNull();
    expect(safeNext('/ok\tevil')).toBeNull();
    expect(safeNext('/ok\u001bevil')).toBeNull();
    expect(safeNext('/ok\u007fevil')).toBeNull();
    expect(safeNext('/ok\revil')).toBeNull();
  });

  test('rejects `..` path segments', () => {
    expect(safeNext('/../admin')).toBeNull();
    expect(safeNext('/transactions/abc/../../admin')).toBeNull();
    expect(safeNext('/transactions/abc/..')).toBeNull();
    // A dotted name that is not a traversal segment is fine.
    expect(safeNext('/transactions/a..b')).toBe('/transactions/a..b');
  });

  test('accepts a plain site-relative path, with or without query', () => {
    expect(safeNext('/transactions/new?kind=expense')).toBe('/transactions/new?kind=expense');
    expect(safeNext('/ledgers')).toBe('/ledgers');
  });

  test('takes the first element when given an array (repeated query key)', () => {
    expect(safeNext(['/ledgers', '/other'])).toBe('/ledgers');
  });
});
