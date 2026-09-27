/** Decision §14.66 b: the one rule for which ledger a tab shows. */
import { makeLedger } from '@/test/fixtures';

import { pickCurrentLedger } from '../LedgerContext';

const A = makeLedger({ id: 'ledger-a' });
const B = makeLedger({ id: 'ledger-b' });
const C = makeLedger({ id: 'ledger-c' });
const LEDGERS = [A, B, C];

test('the tab’s own choice wins', () => {
  expect(pickCurrentLedger(LEDGERS, C.id, B.id)).toBe(C);
});

test('without one, the device’s last ledger', () => {
  expect(pickCurrentLedger(LEDGERS, null, B.id)).toBe(B);
});

test('a tab choice that is no longer in the list falls through to the last ledger', () => {
  expect(pickCurrentLedger(LEDGERS, 'deleted-ledger', B.id)).toBe(B);
});

test('with neither (or neither still ours), the first ledger', () => {
  expect(pickCurrentLedger(LEDGERS, null, null)).toBe(A);
  expect(pickCurrentLedger(LEDGERS, 'gone-1', 'gone-2')).toBe(A);
});

test('no ledgers at all: null, whatever is remembered', () => {
  expect(pickCurrentLedger([], A.id, B.id)).toBeNull();
});
