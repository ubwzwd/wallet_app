/**
 * `LedgerContext` (04 §2.2): the URL is the only source of truth, `switchTo` keeps the
 * shape of the route while dropping the filters that cannot cross a ledger boundary, and
 * the chosen ledger is remembered for the next landing redirect (04 §1.5 rule 2).
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

// `expo-font` reaches for `expo-asset`, which is not in the dependency tree (see the task
// notes); fonts never gate rendering anyway, so the root layout's `useAppFonts()` is stubbed.
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

import RootLayout from '../../../app/_layout';
import AppGroupLayout from '../../../app/(app)/_layout';
import LedgerLayout from '../../../app/(app)/l/[ledgerId]/_layout';

import { setAuthToken } from '@/api/client';
import { initI18n } from '@/i18n';
import { queryClient } from '@/queries';
import { useLedgerContext } from '@/store';
import { makeLedger, makeUser } from '@/test/fixtures';
import { mockApi, mockGet, type MockApi } from '@/test/mockApi';
import { toast } from '@/ui';
import { PREF_NAMES, getPref, setPref } from '@/utils/prefs';

import { resetLedgerGone } from '../RequireLedger';

const LEDGER_A = 'ledger-a';
const LEDGER_B = 'ledger-b';

/** A stub transactions page that exposes the whole context to the test. */
function TransactionsProbe(): React.JSX.Element {
  const { ledgerId, ledger, myRole, baseCurrency, ledgers, switchTo } = useLedgerContext();
  return (
    <>
      <Text testID="probe-id">{ledgerId}</Text>
      <Text testID="probe-name">{ledger.name}</Text>
      <Text testID="probe-role">{myRole}</Text>
      <Text testID="probe-currency">{baseCurrency}</Text>
      <Text testID="probe-count">{String(ledgers.length)}</Text>
      <Pressable testID="switch-to-b" onPress={() => switchTo(LEDGER_B)}>
        <Text>switch</Text>
      </Pressable>
    </>
  );
}

const ROUTES = {
  _layout: RootLayout,
  index: () => <Text>landing</Text>,
  '(app)/_layout': AppGroupLayout,
  '(app)/ledgers/index': () => <Text>ledgers-page</Text>,
  '(app)/l/[ledgerId]/_layout': LedgerLayout,
  '(app)/l/[ledgerId]/index': () => <Text>ledger-home</Text>,
  '(app)/l/[ledgerId]/transactions/index': TransactionsProbe,
};

let api: MockApi;

beforeEach(async () => {
  api = mockApi();
  queryClient.clear();
  resetLedgerGone();
  await initI18n();
  await i18next.changeLanguage('zh');
  await setPref(PREF_NAMES.lastLedgerId, null);
  await setAuthToken('test-access-token');
  mockGet('/me', makeUser());
  mockGet('/ledgers', {
    items: [
      makeLedger({ id: LEDGER_A, name: '家庭账本', base_currency: 'CNY', role: 'owner' }),
      makeLedger({ id: LEDGER_B, name: '旅行账本', base_currency: 'SGD', role: 'member' }),
    ],
    total: 2,
  });
});

afterEach(() => {
  api.restore();
  toast.clear();
});

test('the context is derived from the URL, not from state', async () => {
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_B}/transactions` });

  expect(await router.findByTestId('probe-id')).toHaveTextContent(LEDGER_B);
  expect(router.getByTestId('probe-name')).toHaveTextContent('旅行账本');
  expect(router.getByTestId('probe-role')).toHaveTextContent('member');
  expect(router.getByTestId('probe-currency')).toHaveTextContent('SGD');
  expect(router.getByTestId('probe-count')).toHaveTextContent('2');
});

test('switchTo keeps the route shape and drops the id-shaped filters', async () => {
  const router = renderRouter(ROUTES, {
    initialUrl: `/l/${LEDGER_A}/transactions?kind=expense&source_id=s1`,
  });

  await router.findByTestId('switch-to-b');
  fireEvent.press(router.getByTestId('switch-to-b'));

  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_B}/transactions`));
  expect(router.getSearchParams().kind).toBe('expense');
  expect(router.getSearchParams().source_id).toBeUndefined();
  expect(router.getByTestId('probe-id')).toHaveTextContent(LEDGER_B);
});

test('the ledger in the URL is remembered as last_ledger_id, and switching rewrites it', async () => {
  const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions` });

  await router.findByTestId('switch-to-b');
  await waitFor(async () => {
    expect(await getPref(PREF_NAMES.lastLedgerId)).toBe(LEDGER_A);
  });

  fireEvent.press(router.getByTestId('switch-to-b'));

  await waitFor(async () => {
    expect(await getPref(PREF_NAMES.lastLedgerId)).toBe(LEDGER_B);
  });
});
