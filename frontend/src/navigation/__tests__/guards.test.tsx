/**
 * The six guard rules of 04 §1.5, exercised through the real route tree: `renderRouter`
 * mounts the actual `app/_layout` provider stack and the actual guards, and only the leaf
 * pages are stubs (they belong to other tasks).
 */
import React from 'react';
import { Text } from 'react-native';
import { act, renderRouter, waitFor } from 'expo-router/testing-library';

// `expo-font` reaches for `expo-asset`, which is not in the dependency tree (see the task
// notes); fonts never gate rendering anyway, so the root layout's `useAppFonts()` is stubbed.
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

import i18next from 'i18next';

import RootLayout from '../../../app/_layout';
import AuthGroupLayout from '../../../app/(auth)/_layout';
import AppGroupLayout from '../../../app/(app)/_layout';
import LedgerLayout from '../../../app/(app)/l/[ledgerId]/_layout';
import LandingRoute from '../../../app/index';
import NotFoundRoute from '../../../app/+not-found';

import { clearAuthToken, setAuthToken } from '@/api/client';
import { queryClient } from '@/queries';
import { initI18n } from '@/i18n';
import { makeLedger, makeUser } from '@/test/fixtures';
import { mockApi, mockGet, type MockApi } from '@/test/mockApi';
import { toast } from '@/ui';
import { PREF_NAMES, setPref } from '@/utils/prefs';

import { markLedgerGone, resetLedgerGone } from '../RequireLedger';

const LEDGER_A = 'ledger-a';
const LEDGER_B = 'ledger-b';

const stub = (label: string) => () => <Text>{label}</Text>;

const ROUTES = {
  _layout: RootLayout,
  index: LandingRoute,
  '+not-found': NotFoundRoute,
  '(auth)/_layout': AuthGroupLayout,
  '(auth)/login': stub('login-page'),
  '(app)/_layout': AppGroupLayout,
  '(app)/ledgers/index': stub('ledgers-page'),
  '(app)/l/[ledgerId]/_layout': LedgerLayout,
  '(app)/l/[ledgerId]/index': stub('ledger-home'),
  '(app)/l/[ledgerId]/transactions/index': stub('transactions-page'),
};

function mockLedgers(ids: string[]): void {
  mockGet('/ledgers', {
    items: ids.map((id, i) => makeLedger({ id, name: `账本 ${i + 1}` })),
    total: ids.length,
  });
}

let api: MockApi;

beforeEach(async () => {
  api = mockApi();
  queryClient.clear();
  resetLedgerGone();
  await initI18n();
  await i18next.changeLanguage('zh');
  await setPref(PREF_NAMES.lastLedgerId, null);
  await clearAuthToken();
});

afterEach(() => {
  api.restore();
  toast.clear();
});

async function signIn(): Promise<void> {
  await setAuthToken('test-access-token');
  mockGet('/me', makeUser());
}

describe('rule 1 — anonymous visitors keep their destination', () => {
  test('a deep link lands on /login with an encoded ?next', async () => {
    mockLedgers([LEDGER_A]);
    const router = renderRouter(ROUTES, { initialUrl: '/l/x/transactions' });

    await waitFor(() => expect(router.getPathname()).toBe('/login'));
    expect(router.getSearchParams().next).toBe('/l/x/transactions');
    expect(router.getPathnameWithParams()).toBe('/login?next=%2Fl%2Fx%2Ftransactions');
  });

  test('the query string of the original URL survives in ?next', async () => {
    mockLedgers([LEDGER_A]);
    const router = renderRouter(ROUTES, {
      initialUrl: '/l/x/transactions?kind=expense',
    });

    await waitFor(() => expect(router.getPathname()).toBe('/login'));
    expect(router.getSearchParams().next).toBe('/l/x/transactions?kind=expense');
  });
});

describe('rule 2 — the landing redirect', () => {
  test('/ goes to the remembered ledger when it is still ours', async () => {
    await signIn();
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_B);
    mockLedgers([LEDGER_A, LEDGER_B]);

    const router = renderRouter(ROUTES, { initialUrl: '/' });
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_B}`));
  });

  test('/ falls back to the first ledger when the remembered one is gone', async () => {
    await signIn();
    await setPref(PREF_NAMES.lastLedgerId, 'ledger-that-was-deleted');
    mockLedgers([LEDGER_A, LEDGER_B]);

    const router = renderRouter(ROUTES, { initialUrl: '/' });
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_A}`));
  });

  test('/ goes to the ledger list when there is not a single ledger', async () => {
    await signIn();
    mockLedgers([]);

    const router = renderRouter(ROUTES, { initialUrl: '/' });
    await waitFor(() => expect(router.getPathname()).toBe('/ledgers'));
  });

  test('/login redirects a signed-in user through the same landing logic', async () => {
    await signIn();
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_B);
    mockLedgers([LEDGER_A, LEDGER_B]);

    const router = renderRouter(ROUTES, { initialUrl: '/login' });
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_B}`));
  });
});

describe('rule 3 — an unreachable ledger is explained, never silently redirected', () => {
  test('an id outside the list renders the notice and leaves the URL alone', async () => {
    await signIn();
    mockLedgers([LEDGER_A]);

    const router = renderRouter(ROUTES, { initialUrl: '/l/not-mine/transactions' });

    expect(
      await router.findByText('这个账本不存在，或者你不在它的成员里'),
    ).toBeTruthy();
    expect(router.getPathname()).toBe('/l/not-mine/transactions');
    expect(router.queryByText('transactions-page')).toBeNull();
  });

  test('with zero ledgers there is nothing to explain, so /ledgers takes over', async () => {
    await signIn();
    mockLedgers([]);

    const router = renderRouter(ROUTES, { initialUrl: '/l/not-mine/transactions' });
    await waitFor(() => expect(router.getPathname()).toBe('/ledgers'));
  });

  test('a ledger in the list renders its page', async () => {
    await signIn();
    mockLedgers([LEDGER_A]);

    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions` });
    expect(await router.findByText('transactions-page')).toBeTruthy();
  });
});

describe('rule 4 — a 404 on the ledger detail is the anchor for "you were removed"', () => {
  test('the flag the query cache raises turns the page into the notice, URL untouched', async () => {
    await signIn();
    mockLedgers([LEDGER_A, LEDGER_B]);

    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions` });
    expect(await router.findByText('transactions-page')).toBeTruthy();

    // This is what `registerQueryHandlers({ onLedgerGone })` does on a 404 `not_found`
    // from `GET /ledgers/{id}` (04 §2.4).
    act(() => markLedgerGone(LEDGER_A));

    expect(
      await router.findByText('这个账本不存在，或者你不在它的成员里'),
    ).toBeTruthy();
    // No redirect was issued: we are still inside the ledger the user asked for. (The
    // page's own child navigator unmounts with it, so react-navigation drops the
    // `/transactions` leaf from the URL — that is not a guard decision.)
    expect(router.getPathname().startsWith(`/l/${LEDGER_A}`)).toBe(true);
    expect(router.queryByText('transactions-page')).toBeNull();
    // The other ledger is still reachable, so the notice offers a way over to it.
    expect(router.getByText('看我的账本')).toBeTruthy();
  });

  test('a 404 on some other ledger does not disturb the current one', async () => {
    await signIn();
    mockLedgers([LEDGER_A, LEDGER_B]);

    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions` });
    expect(await router.findByText('transactions-page')).toBeTruthy();

    act(() => markLedgerGone(LEDGER_B));

    expect(router.getByText('transactions-page')).toBeTruthy();
  });
});

describe('rule 5 — a 401 hands control back to the auth guard', () => {
  test('a stored token the server rejects ends up on /login', async () => {
    await setAuthToken('stale-token');
    mockGet('/me', { detail: 'Not authenticated', code: 'unauthorized' }, 401);
    mockLedgers([LEDGER_A]);

    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions` });

    await waitFor(() => expect(router.getPathname()).toBe('/login'));
    expect(router.getSearchParams().next).toBe(`/l/${LEDGER_A}/transactions`);
  });
});

describe('the catch-all route', () => {
  test('an unknown path renders the 404 screen', async () => {
    mockLedgers([LEDGER_A]);
    const router = renderRouter(ROUTES, { initialUrl: '/nowhere-at-all' });
    expect(await router.findByText('页面不存在')).toBeTruthy();
    expect(router.getByText('回到我的账本')).toBeTruthy();
  });
});
