/**
 * Decision §14.65 f: the five form pages that draw no bottom tab bar on a narrow screen.
 */
import { routes } from '@/domain/routes';

import { isFormRoute } from '../formRoute';

const l = routes.l('ledger-a');

describe('isFormRoute', () => {
  test.each([
    ['new transaction', l.transactionNew()],
    ['new transaction with a kind and ?next=', l.transactionNew({ kind: 'income', next: '/x' })],
    ['edit a transaction', l.transactionEdit('tx-1')],
    ['edit a transfer pair', l.transferEdit('pair-1')],
    ['new account', l.sourceNew()],
    ['edit an account', l.sourceEdit('src-1')],
  ])('%s is a form', (_name, path) => {
    expect(isFormRoute(path)).toBe(true);
  });

  test('a trailing slash does not change the answer', () => {
    expect(isFormRoute(`${l.transactionNew()}/`)).toBe(true);
    expect(isFormRoute(`${l.sourceEdit('src-1')}/`)).toBe(true);
  });

  test.each([
    ['home', l.home()],
    ['transactions', l.transactions()],
    ['a transaction detail', l.transaction('tx-1')],
    ['a transfer detail', l.transfer('pair-1')],
    ['accounts', l.sources()],
    ['imports', l.imports()],
    ['import upload', l.importsNew()],
    ['an import batch', l.importBatch('batch-1')],
    ['ledger settings', l.settings()],
    ['personal settings', routes.settings()],
    ['new ledger', routes.ledgersNew()],
    ['join a ledger', routes.ledgersJoin()],
    ['the landing page', '/'],
    ['something after edit', `${l.transactionEdit('tx-1')}/more`],
    ['an edit with no id', '/l/ledger-a/transactions//edit'],
    ['an account id with no edit', '/l/ledger-a/sources/src-1'],
    ['no ledger id', '/l//transactions/new'],
  ])('%s is not a form', (_name, path) => {
    expect(isFormRoute(path)).toBe(false);
  });
});
