/**
 * The six guard rules of 04 §1.5, exercised through the real route tree: `renderRouter`
 * mounts the actual `app/_layout` provider stack and the actual guards, and only the leaf
 * pages are stubs (they belong to other tasks).
 */
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';

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
import { qk, queryClient } from '@/queries';
import { initI18n } from '@/i18n';
import LoginScreen from '@/screens/auth/LoginScreen';
import { makeLedger, makeUser } from '@/test/fixtures';
import { apiUrl, mockApi, mockGet, mockPost, type MockApi } from '@/test/mockApi';
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

/** The same tree with the real sign-in screen, for the round trip through `?next=`. */
const ROUTES_WITH_LOGIN = { ...ROUTES, '(auth)/login': LoginScreen };

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

  test('signing in takes the user back to where they were headed', async () => {
    mockLedgers([LEDGER_A]);
    mockPost('/auth/login', { access_token: 'fresh-token', token_type: 'bearer' });
    mockGet('/me', makeUser());

    const router = renderRouter(ROUTES_WITH_LOGIN, {
      initialUrl: `/l/${LEDGER_A}/transactions`,
    });

    await waitFor(() => expect(router.getPathname()).toBe('/login'));
    expect(router.getSearchParams().next).toBe(`/l/${LEDGER_A}/transactions`);

    fireEvent.changeText(await router.findByTestId('login-email'), 'alice@example.com');
    fireEvent.changeText(router.getByTestId('login-password'), 'hunter2');
    fireEvent.press(router.getByTestId('login-submit'));

    await waitFor(() =>
      expect(router.getPathname()).toBe(`/l/${LEDGER_A}/transactions`),
    );
    expect(await router.findByText('transactions-page')).toBeTruthy();
  });

  test('nothing renders and nothing redirects while the session is bootstrapping', async () => {
    await setAuthToken('stored-token');
    // `GET /me` never answers: the provider is stuck on `bootstrapping`.
    api.mock.onGet(apiUrl('/me')).reply(() => new Promise(() => undefined));
    mockLedgers([LEDGER_A]);

    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions` });

    expect(await router.findByTestId('app-skeleton')).toBeTruthy();
    expect(router.queryByText('login-page')).toBeNull();
    expect(router.queryByText('transactions-page')).toBeNull();
    // 04 §1.5: a guard that cannot decide yet waits — it never navigates.
    expect(router.getPathname()).toBe(`/l/${LEDGER_A}/transactions`);
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

  test('/login?next= beats the landing logic for a user who is already signed in', async () => {
    await signIn();
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_B);
    mockLedgers([LEDGER_A, LEDGER_B]);

    const router = renderRouter(ROUTES, {
      initialUrl: `/login?next=%2Fl%2F${LEDGER_A}%2Ftransactions`,
    });

    await waitFor(() =>
      expect(router.getPathname()).toBe(`/l/${LEDGER_A}/transactions`),
    );
  });

  test('an unsafe ?next= is ignored and the landing logic decides', async () => {
    await signIn();
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_B);
    mockLedgers([LEDGER_A, LEDGER_B]);

    const router = renderRouter(ROUTES, {
      initialUrl: '/login?next=%2F%2Fevil.example.com',
    });

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
    expect(router.getByText('回到首页')).toBeTruthy();
  });

  test('「回到首页」 goes to `/`, which lands on a ledger the user can still open (§14.65 e)', async () => {
    await signIn();
    mockLedgers([LEDGER_A, LEDGER_B]);

    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions` });
    expect(await router.findByText('transactions-page')).toBeTruthy();

    // The re-read list no longer has the ledger the user was removed from.
    mockLedgers([LEDGER_B]);
    act(() => markLedgerGone(LEDGER_A));

    const home = await router.findByText('回到首页');
    fireEvent.press(home);

    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_B}`));
    expect(await router.findByText('ledger-home')).toBeTruthy();
  });

  test('everything cached under the vanished ledger is dropped, not just marked stale', async () => {
    await signIn();
    mockLedgers([LEDGER_A, LEDGER_B]);

    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions` });
    expect(await router.findByText('transactions-page')).toBeTruthy();

    const txKey = qk.ledger(LEDGER_A).tx('tx-1');
    queryClient.setQueryData(txKey, { id: 'tx-1' });
    queryClient.setQueryData(qk.ledger(LEDGER_B).tx('tx-2'), { id: 'tx-2' });

    act(() => markLedgerGone(LEDGER_A));

    await waitFor(() => expect(queryClient.getQueryData(txKey)).toBeUndefined());
    // Only that ledger's subtree: another ledger's cache is none of rule 4's business.
    expect(queryClient.getQueryData(qk.ledger(LEDGER_B).tx('tx-2'))).toEqual({ id: 'tx-2' });
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
    expect(router.getByText('回到首页')).toBeTruthy();
  });

  test('「回到首页」 on the 404 screen goes to `/` and lands on the ledger (§14.65 e)', async () => {
    await signIn();
    mockLedgers([LEDGER_A]);
    const router = renderRouter(ROUTES, { initialUrl: '/nowhere-at-all' });

    fireEvent.press(await router.findByTestId('not-found-actions'));

    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_A}`));
  });
});
