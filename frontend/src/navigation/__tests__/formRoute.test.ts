/**
 * Decision §14.65 f: the five form pages that draw no bottom tab bar on a narrow screen, at
 * their §14.66 paths.
 */
import { routes } from '@/domain/routes';

import { isFormRoute } from '../formRoute';

describe('isFormRoute', () => {
  test.each([
    ['new transaction', routes.transactionNew()],
    [
      'new transaction with a kind and ?next=',
      routes.transactionNew({ kind: 'income', next: '/transactions' }),
    ],
    ['edit a transaction', routes.transactionEdit('tx-1')],
    ['edit a transfer pair', routes.transferEdit('pair-1')],
    ['new account', routes.accountNew()],
    ['new account preset to a ledger', routes.accountNew('ledger-a')],
    ['edit an account', routes.accountEdit('src-1')],
  ])('%s is a form', (_name, path) => {
    expect(isFormRoute(path)).toBe(true);
  });

  test('a trailing slash does not change the answer', () => {
    expect(isFormRoute(`${routes.transactionNew()}/`)).toBe(true);
    expect(isFormRoute(`${routes.accountEdit('src-1')}/`)).toBe(true);
    expect(isFormRoute(`${routes.accountNew()}/`)).toBe(true);
  });

  test.each([
    ['home', routes.home()],
    ['transactions', routes.transactions()],
    ['a transaction detail', routes.transaction('tx-1')],
    ['a transfer detail', routes.transfer('pair-1')],
    ['accounts', routes.accounts()],
    ['archived accounts', routes.accounts(true)],
    ['imports', routes.imports()],
    ['import upload', routes.importsNew()],
    ['an import batch', routes.importBatch('batch-1')],
    ['ledger settings', routes.ledgerSettings()],
    ['personal settings', routes.settings()],
    ['new ledger', routes.ledgersNew()],
    ['join a ledger', routes.ledgersJoin()],
    ['the landing page', '/'],
    ['something after edit', `${routes.transactionEdit('tx-1')}/more`],
    ['an edit with no id', '/transactions//edit'],
    ['a transfer edit with no id', '/transfers//edit'],
    ['an account id with no edit', '/accounts/src-1'],
    ['an account edit with no id', '/accounts//edit'],
    ['the old ledger-scoped account form', '/sources/new'],
  ])('%s is not a form', (_name, path) => {
    expect(isFormRoute(path)).toBe(false);
  });
});
