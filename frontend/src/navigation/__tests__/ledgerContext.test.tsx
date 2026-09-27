/**
 * The current ledger (04 §2.2, decision §14.66 b–d) on the real signed-in layout: it comes
 * from the tab's memory, not from the URL; `switchTo` changes the context and nothing else —
 * the path stays and the history does not grow, so the back button walks pages, never
 * ledgers; a record page falls back to its list; a ledger the server gave up on is left for
 * another one, with a toast.
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import { router as expoRouter } from 'expo-router';
import i18next from 'i18next';

// `expo-font` reaches for `expo-asset`, which is not in the dependency tree (see the task
// notes); fonts never gate rendering anyway, so the root layout's `useAppFonts()` is stubbed.
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

import RootLayout from '../../../app/_layout';
import AppGroupLayout from '../../../app/(app)/_layout';

import { setAuthToken } from '@/api/client';
import { initI18n } from '@/i18n';
import { qk, queryClient } from '@/queries';
import { markLedgerUnavailable, resetLedgerUnavailable, useLedgerContext } from '@/store';
import { makeLedger, makeUser } from '@/test/fixtures';
import { apiUrl, mockApi, mockGet, type MockApi } from '@/test/mockApi';
import { toast } from '@/ui';
import { PREF_NAMES, getPref, setPref, setSessionPref } from '@/utils/prefs';

const LEDGER_A = 'ledger-a';
const LEDGER_B = 'ledger-b';

/** A stub page that exposes the whole context and a switch to each ledger. */
function probe(name: string) {
  return function Probe(): React.JSX.Element {
    const { ledgerId, ledger, myRole, baseCurrency, ledgers, switchTo } = useLedgerContext();
    return (
      <>
        <Text>{name}</Text>
        <Text testID="probe-id">{ledgerId}</Text>
        <Text testID="probe-name">{ledger.name}</Text>
        <Text testID="probe-role">{myRole}</Text>
        <Text testID="probe-currency">{baseCurrency}</Text>
        <Text testID="probe-count">{String(ledgers.length)}</Text>
        <Pressable testID="switch-to-a" onPress={() => switchTo(LEDGER_A)}>
          <Text>a</Text>
        </Pressable>
        <Pressable testID="switch-to-b" onPress={() => switchTo(LEDGER_B)}>
          <Text>b</Text>
        </Pressable>
      </>
    );
  };
}

const ROUTES = {
  _layout: RootLayout,
  index: () => <Text>landing</Text>,
  '(app)/_layout': AppGroupLayout,
  '(app)/ledgers/index': () => <Text>ledgers-page</Text>,
  '(app)/home': probe('home-page'),
  '(app)/transactions/index': probe('transactions-page'),
  '(app)/transactions/[txId]/index': probe('detail-page'),
  '(app)/imports/index': probe('imports-page'),
  '(app)/imports/[batchId]': probe('batch-page'),
};

type Router = ReturnType<typeof renderRouter>;

interface StateLike {
  index?: number;
  routes: { state?: StateLike }[];
}

/** How many entries the history holds: every route on the focused path's stacks. */
function historyLength(router: Router): number {
  let count = 0;
  let state = router.getRouterState() as StateLike | undefined;
  while (state) {
    count += state.routes.length;
    state = state.routes[state.index ?? state.routes.length - 1]?.state;
  }
  return count;
}

let api: MockApi;

beforeEach(async () => {
  api = mockApi();
  queryClient.clear();
  resetLedgerUnavailable();
  await initI18n();
  await i18next.changeLanguage('zh');
  await setPref(PREF_NAMES.lastLedgerId, null);
  await setSessionPref(PREF_NAMES.currentLedgerId, null);
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

describe('which ledger is current (§14.66 b)', () => {
  test('the remembered ledger, with no ledger anywhere in the URL', async () => {
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_B);
    const router = renderRouter(ROUTES, { initialUrl: '/transactions' });

    expect(await router.findByTestId('probe-id')).toHaveTextContent(LEDGER_B);
    expect(router.getByTestId('probe-name')).toHaveTextContent('旅行账本');
    expect(router.getByTestId('probe-role')).toHaveTextContent('member');
    expect(router.getByTestId('probe-currency')).toHaveTextContent('SGD');
    expect(router.getByTestId('probe-count')).toHaveTextContent('2');
    expect(router.getPathname()).toBe('/transactions');
  });

  test('nothing remembered: the first ledger, written back to both stores', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/home' });

    expect(await router.findByTestId('probe-id')).toHaveTextContent(LEDGER_A);
    await waitFor(async () => expect(await getPref(PREF_NAMES.lastLedgerId)).toBe(LEDGER_A));
    // Native has no tabs: the per-tab pref degrades to an ordinary one.
    expect(await getPref(PREF_NAMES.currentLedgerId)).toBe(LEDGER_A);
  });

  test('a remembered ledger that is no longer ours falls back to the first', async () => {
    await setPref(PREF_NAMES.lastLedgerId, 'ledger-that-was-deleted');
    const router = renderRouter(ROUTES, { initialUrl: '/home' });

    expect(await router.findByTestId('probe-id')).toHaveTextContent(LEDGER_A);
    await waitFor(async () => expect(await getPref(PREF_NAMES.lastLedgerId)).toBe(LEDGER_A));
  });

  test('while the ledger list is on its way nothing is guessed', async () => {
    api.mock.onGet(apiUrl('/ledgers')).reply(() => new Promise(() => undefined));
    const router = renderRouter(ROUTES, { initialUrl: '/home' });

    expect(await router.findByTestId('app-skeleton')).toBeTruthy();
    expect(router.queryByText('home-page')).toBeNull();
  });

  test('a list that fails to load offers a retry', async () => {
    mockGet('/ledgers', { detail: 'boom', code: 'internal_error' }, 500);
    const router = renderRouter(ROUTES, { initialUrl: '/home' });

    expect(await router.findByTestId('ledgers-unavailable')).toBeTruthy();
    expect(router.queryByText('home-page')).toBeNull();
    expect(router.getPathname()).toBe('/home');
  });
});

describe('switchTo (§14.66 d)', () => {
  test('keeps the page and makes no history entry', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/home' });
    await router.findByTestId('probe-id');
    act(() => expoRouter.push('/transactions'));
    expect(await router.findByText('transactions-page')).toBeTruthy();
    const depth = historyLength(router);
    const couldGoBack = expoRouter.canGoBack();

    fireEvent.press(router.getByTestId('switch-to-b'));

    await waitFor(() => expect(router.getByTestId('probe-id')).toHaveTextContent(LEDGER_B));
    expect(router.getPathname()).toBe('/transactions');
    expect(router.getPathnameWithParams()).toBe('/transactions');
    expect(historyLength(router)).toBe(depth);
    expect(expoRouter.canGoBack()).toBe(couldGoBack);
  });

  test('back and forth between two ledgers, then back: the previous page, not a ledger', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/home' });
    await router.findByTestId('probe-id');
    act(() => expoRouter.push('/transactions'));
    expect(await router.findByText('transactions-page')).toBeTruthy();

    for (const target of ['switch-to-b', 'switch-to-a', 'switch-to-b']) {
      fireEvent.press(router.getByTestId(target));
    }
    await waitFor(() => expect(router.getByTestId('probe-id')).toHaveTextContent(LEDGER_B));

    act(() => expoRouter.back());
    await waitFor(() => expect(router.getPathname()).toBe('/home'));
    // Back walked a page; the ledger is still the one picked last.
    expect(await router.findByText('home-page')).toBeTruthy();
    expect(router.getByTestId('probe-id')).toHaveTextContent(LEDGER_B);
    expect(expoRouter.canGoBack()).toBe(false);
  });

  test('writes the pick to this tab and to the device', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/home' });
    await router.findByTestId('probe-id');

    fireEvent.press(router.getByTestId('switch-to-b'));

    await waitFor(async () => expect(await getPref(PREF_NAMES.lastLedgerId)).toBe(LEDGER_B));
    expect(await getPref(PREF_NAMES.currentLedgerId)).toBe(LEDGER_B);
  });

  test.each([
    ['/transactions/tx-1', '/transactions', 'transactions-page'],
    ['/imports/batch-1', '/imports', 'imports-page'],
  ])('on %s, whose record is the old ledger’s, falls back to %s', async (url, list, page) => {
    const router = renderRouter(ROUTES, { initialUrl: url });
    await router.findByTestId('probe-id');

    fireEvent.press(router.getByTestId('switch-to-b'));

    await waitFor(() => expect(router.getPathname()).toBe(list));
    expect(await router.findByText(page)).toBeTruthy();
    expect(router.getByTestId('probe-id')).toHaveTextContent(LEDGER_B);
  });
});

describe('a ledger the server gave up on (§14.66 c)', () => {
  test('the tab moves to another ledger, stays on the page, and says so', async () => {
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_A);
    const router = renderRouter(ROUTES, { initialUrl: '/transactions' });
    expect(await router.findByTestId('probe-id')).toHaveTextContent(LEDGER_A);

    const txKey = qk.ledger(LEDGER_A).tx('tx-1');
    queryClient.setQueryData(txKey, { id: 'tx-1' });
    queryClient.setQueryData(qk.ledger(LEDGER_B).tx('tx-2'), { id: 'tx-2' });

    // What the query cache's ledger-gone handler does on a 404 from `GET /ledgers/{id}`.
    act(() => markLedgerUnavailable(LEDGER_A));

    await waitFor(() => expect(router.getByTestId('probe-id')).toHaveTextContent(LEDGER_B));
    expect(router.getPathname()).toBe('/transactions');
    await waitFor(() =>
      expect(toast.peek().map((item) => item.message)).toContain('账本不可用，已切到 旅行账本'),
    );
    // Everything cached under the lost ledger is dropped; another ledger's is left alone.
    await waitFor(() => expect(queryClient.getQueryData(txKey)).toBeUndefined());
    expect(queryClient.getQueryData(qk.ledger(LEDGER_B).tx('tx-2'))).toEqual({ id: 'tx-2' });
  });

  test('on one of its records, the tab also leaves for the list', async () => {
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_A);
    const router = renderRouter(ROUTES, { initialUrl: '/transactions/tx-1' });
    expect(await router.findByTestId('probe-id')).toHaveTextContent(LEDGER_A);

    act(() => markLedgerUnavailable(LEDGER_A));

    await waitFor(() => expect(router.getPathname()).toBe('/transactions'));
    expect(router.getByTestId('probe-id')).toHaveTextContent(LEDGER_B);
  });

  test('a flag on some other ledger does not disturb the current one', async () => {
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_A);
    const router = renderRouter(ROUTES, { initialUrl: '/transactions' });
    expect(await router.findByTestId('probe-id')).toHaveTextContent(LEDGER_A);

    act(() => markLedgerUnavailable(LEDGER_B));

    await waitFor(() => expect(router.getByTestId('probe-count')).toHaveTextContent('1'));
    expect(router.getByTestId('probe-id')).toHaveTextContent(LEDGER_A);
    expect(toast.peek()).toHaveLength(0);
  });

  test('with no other ledger to go to, a ledger page goes to the onboarding', async () => {
    mockGet('/ledgers', {
      items: [makeLedger({ id: LEDGER_A, name: '家庭账本' })],
      total: 1,
    });
    const router = renderRouter(ROUTES, { initialUrl: '/transactions' });
    expect(await router.findByTestId('probe-id')).toHaveTextContent(LEDGER_A);

    act(() => markLedgerUnavailable(LEDGER_A));

    await waitFor(() => expect(router.getPathname()).toBe('/ledgers'));
    expect(await router.findByText('ledgers-page')).toBeTruthy();
  });
});
