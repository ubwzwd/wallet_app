/** 04 §1.2 route table, §1.5 rule 1 (safeNext), §2.2 (withLedger). */
import { routes, safeNext, withLedger } from '../routes';

const LID = '2f1c1111-2222-3333-4444-555566667777';

describe('routes table matches 04 §1.2 verbatim', () => {
  test('top-level routes', () => {
    expect(routes.login()).toBe('/login');
    expect(routes.login('/l/abc/transactions')).toBe(
      '/login?next=%2Fl%2Fabc%2Ftransactions'
    );
    expect(routes.register()).toBe('/register');
    expect(routes.ledgers()).toBe('/ledgers');
    expect(routes.ledgersNew()).toBe('/ledgers/new');
    expect(routes.ledgersJoin()).toBe('/ledgers/join');
    expect(routes.settings()).toBe('/settings');
  });

  test('ledger-scoped routes', () => {
    const l = routes.l(LID);
    expect(l.home()).toBe(`/l/${LID}`);
    expect(l.home('2026-08')).toBe(`/l/${LID}?month=2026-08`);
    expect(l.transactions()).toBe(`/l/${LID}/transactions`);
    expect(l.transactions({ kind: ['expense', 'refund'], source_id: ['s1'] })).toBe(
      `/l/${LID}/transactions?kind=expense&kind=refund&source_id=s1`
    );
    expect(l.transactionNew()).toBe(`/l/${LID}/transactions/new`);
    expect(l.transactionNew({ kind: 'expense', source_id: 's1' })).toBe(
      `/l/${LID}/transactions/new?kind=expense&source_id=s1`
    );
    expect(l.transactionNew({ kind: 'refund', refund_of: 'tx1', next: '/l/x/transactions' })).toBe(
      `/l/${LID}/transactions/new?kind=refund&refund_of=tx1&next=%2Fl%2Fx%2Ftransactions`
    );
    expect(l.transactionNew({ copy_of: 'tx1' })).toBe(
      `/l/${LID}/transactions/new?copy_of=tx1`
    );
    expect(l.transactionNew({ kind: 'expense', copy_of: 'tx1', next: '/l/x' })).toBe(
      `/l/${LID}/transactions/new?kind=expense&copy_of=tx1&next=%2Fl%2Fx`
    );
    expect(l.transaction('tx1')).toBe(`/l/${LID}/transactions/tx1`);
    expect(l.transactionEdit('tx1')).toBe(`/l/${LID}/transactions/tx1/edit`);
    expect(l.transfer('pair1')).toBe(`/l/${LID}/transfers/pair1`);
    expect(l.transferEdit('pair1')).toBe(`/l/${LID}/transfers/pair1/edit`);
    expect(l.sources()).toBe(`/l/${LID}/sources`);
    expect(l.sources(true)).toBe(`/l/${LID}/sources?include_archived=1`);
    expect(l.sourceNew()).toBe(`/l/${LID}/sources/new`);
    expect(l.sourceEdit('s1')).toBe(`/l/${LID}/sources/s1/edit`);
    expect(l.imports()).toBe(`/l/${LID}/imports`);
    expect(l.importsGuide()).toBe(`/l/${LID}/imports/guide`);
    expect(l.importsNew()).toBe(`/l/${LID}/imports/new`);
    expect(l.importBatch('b1')).toBe(`/l/${LID}/imports/b1`);
    expect(l.importBatch('b1', { row: 'r1', filter: 'uncategorized' })).toBe(
      `/l/${LID}/imports/b1?row=r1&filter=uncategorized`
    );
    expect(l.settings()).toBe(`/l/${LID}/settings`);
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
    expect(safeNext('/l/abc/../../admin')).toBeNull();
    expect(safeNext('/l/abc/..')).toBeNull();
    // A dotted name that is not a traversal segment is fine.
    expect(safeNext('/l/abc/a..b')).toBe('/l/abc/a..b');
  });

  test('accepts a plain site-relative path, with or without query', () => {
    expect(safeNext('/l/abc/transactions?kind=expense')).toBe('/l/abc/transactions?kind=expense');
    expect(safeNext('/ledgers')).toBe('/ledgers');
  });

  test('takes the first element when given an array (repeated query key)', () => {
    expect(safeNext(['/ledgers', '/other'])).toBe('/ledgers');
  });
});

describe('withLedger (04 §2.2)', () => {
  const FROM = 'ledger-a';
  const TO = 'ledger-b';

  test('drops id-scoped query params (source_id, import_batch_id, offset)', () => {
    const input = `/l/${FROM}/transactions?kind=expense&source_id=s1&import_batch_id=b1&offset=50&from=2026-08-01`;
    expect(withLedger(input, FROM, TO)).toBe(
      `/l/${TO}/transactions?kind=expense&from=2026-08-01`
    );
  });

  test('drops a path-embedded resource id, falling back to that resource\'s list page', () => {
    expect(withLedger(`/l/${FROM}/transactions/tx1`, FROM, TO)).toBe(`/l/${TO}/transactions`);
    expect(withLedger(`/l/${FROM}/transactions/tx1/edit`, FROM, TO)).toBe(`/l/${TO}/transactions`);
    expect(withLedger(`/l/${FROM}/sources/s1/edit`, FROM, TO)).toBe(`/l/${TO}/sources`);
    expect(withLedger(`/l/${FROM}/imports/b1`, FROM, TO)).toBe(`/l/${TO}/imports`);
    expect(withLedger(`/l/${FROM}/transfers/p1`, FROM, TO)).toBe(`/l/${TO}/transactions`);
  });

  test('preserves shape for id-free pages', () => {
    expect(withLedger(`/l/${FROM}`, FROM, TO)).toBe(`/l/${TO}`);
    expect(withLedger(`/l/${FROM}/transactions/new?kind=income`, FROM, TO)).toBe(
      `/l/${TO}/transactions/new?kind=income`
    );
    expect(withLedger(`/l/${FROM}/imports/guide`, FROM, TO)).toBe(`/l/${TO}/imports/guide`);
    expect(withLedger(`/l/${FROM}/settings`, FROM, TO)).toBe(`/l/${TO}/settings`);
  });

  test('leaves a path scoped to a different ledger untouched', () => {
    expect(withLedger('/ledgers', FROM, TO)).toBe('/ledgers');
  });
});
