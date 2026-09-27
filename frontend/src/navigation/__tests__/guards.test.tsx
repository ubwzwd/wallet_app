/**
 * The guard rules of 04 §1.5 at the §14.66 paths, exercised through the real route tree:
 * `renderRouter` mounts the actual `app/_layout` provider stack and the actual guards, and
 * only the leaf pages are stubs (they belong to other tasks).
 *
 * Rules 3 and 4 moved with the URL (§14.66 c): a path no longer names a ledger, so there is
 * no "someone else's ledger in the address" left to explain — the tab's current ledger is
 * always one of ours, a lost one is swapped for another (`ledgerContext.test.tsx`), and only
 * a user with no ledger at all is sent away from the ledger pages.
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
import LandingRoute from '../../../app/index';
import NotFoundRoute from '../../../app/+not-found';

import { clearAuthToken, setAuthToken } from '@/api/client';
import { queryClient } from '@/queries';
import { initI18n } from '@/i18n';
import LoginScreen from '@/screens/auth/LoginScreen';
import { markLedgerUnavailable, resetLedgerUnavailable, useOptionalLedgerContext } from '@/store';
import { makeLedger, makeUser } from '@/test/fixtures';
import { apiUrl, mockApi, mockGet, mockPost, type MockApi } from '@/test/mockApi';
import { toast } from '@/ui';
import { PREF_NAMES, setPref, setSessionPref } from '@/utils/prefs';

const LEDGER_A = 'ledger-a';
const LEDGER_B = 'ledger-b';

/** A stub page that also names the current ledger, if any. */
const stub = (label: string) =>
  function Stub(): React.JSX.Element {
    const ledger = useOptionalLedgerContext()?.ledger;
    return <Text>{ledger ? `${label} @ ${ledger.name}` : label}</Text>;
  };

const ROUTES = {
  _layout: RootLayout,
  index: LandingRoute,
  '+not-found': NotFoundRoute,
  '(auth)/_layout': AuthGroupLayout,
  '(auth)/login': stub('login-page'),
  '(app)/_layout': AppGroupLayout,
  '(app)/ledgers/index': stub('ledgers-page'),
  '(app)/settings': stub('settings-page'),
  '(app)/home': stub('ledger-home'),
  '(app)/transactions/index': stub('transactions-page'),
  '(app)/transactions/new': stub('new-transaction-page'),
};

/** The same tree with the real sign-in screen, for the round trip through `?next=`. */
const ROUTES_WITH_LOGIN = { ...ROUTES, '(auth)/login': LoginScreen };

const NAMES: Record<string, string> = { [LEDGER_A]: '家庭账本', [LEDGER_B]: '旅行账本' };

function mockLedgers(ids: string[]): void {
  mockGet('/ledgers', {
    items: ids.map((id) => makeLedger({ id, name: NAMES[id] ?? id })),
    total: ids.length,
  });
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
    const router = renderRouter(ROUTES, { initialUrl: '/transactions' });

    await waitFor(() => expect(router.getPathname()).toBe('/login'));
    expect(router.getSearchParams().next).toBe('/transactions');
    expect(router.getPathnameWithParams()).toBe('/login?next=%2Ftransactions');
  });

  test('the query string of the original URL survives in ?next', async () => {
    mockLedgers([LEDGER_A]);
    const router = renderRouter(ROUTES, { initialUrl: '/transactions/new?kind=expense' });

    await waitFor(() => expect(router.getPathname()).toBe('/login'));
    expect(router.getSearchParams().next).toBe('/transactions/new?kind=expense');
  });

  test('signing in takes the user back to where they were headed', async () => {
    mockLedgers([LEDGER_A]);
    mockPost('/auth/login', { access_token: 'fresh-token', token_type: 'bearer' });
    mockGet('/me', makeUser());

    const router = renderRouter(ROUTES_WITH_LOGIN, { initialUrl: '/transactions' });

    await waitFor(() => expect(router.getPathname()).toBe('/login'));
    expect(router.getSearchParams().next).toBe('/transactions');

    fireEvent.changeText(await router.findByTestId('login-email'), 'alice@example.com');
    fireEvent.changeText(router.getByTestId('login-password'), 'hunter2');
    fireEvent.press(router.getByTestId('login-submit'));

    await waitFor(() => expect(router.getPathname()).toBe('/transactions'));
    expect(await router.findByText('transactions-page @ 家庭账本')).toBeTruthy();
  });

  test('nothing renders and nothing redirects while the session is bootstrapping', async () => {
    await setAuthToken('stored-token');
    // `GET /me` never answers: the provider is stuck on `bootstrapping`.
    api.mock.onGet(apiUrl('/me')).reply(() => new Promise(() => undefined));
    mockLedgers([LEDGER_A]);

    const router = renderRouter(ROUTES, { initialUrl: '/transactions' });

    expect(await router.findByTestId('app-skeleton')).toBeTruthy();
    expect(router.queryByText('login-page')).toBeNull();
    expect(router.queryByText(/transactions-page/)).toBeNull();
    // 04 §1.5: a guard that cannot decide yet waits — it never navigates.
    expect(router.getPathname()).toBe('/transactions');
  });
});

describe('rule 2 — the landing redirect (§14.66 h)', () => {
  test('/ goes to /home, which shows the remembered ledger when it is still ours', async () => {
    await signIn();
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_B);
    mockLedgers([LEDGER_A, LEDGER_B]);

    const router = renderRouter(ROUTES, { initialUrl: '/' });
    await waitFor(() => expect(router.getPathname()).toBe('/home'));
    expect(await router.findByText('ledger-home @ 旅行账本')).toBeTruthy();
  });

  test('/home falls back to the first ledger when the remembered one is gone', async () => {
    await signIn();
    await setPref(PREF_NAMES.lastLedgerId, 'ledger-that-was-deleted');
    mockLedgers([LEDGER_A, LEDGER_B]);

    const router = renderRouter(ROUTES, { initialUrl: '/' });
    await waitFor(() => expect(router.getPathname()).toBe('/home'));
    expect(await router.findByText('ledger-home @ 家庭账本')).toBeTruthy();
  });

  test('/ goes to the onboarding page when there is not a single ledger', async () => {
    await signIn();
    mockLedgers([]);

    const router = renderRouter(ROUTES, { initialUrl: '/' });
    await waitFor(() => expect(router.getPathname()).toBe('/ledgers'));
  });

  test('/login redirects a signed-in user through the same landing logic', async () => {
    await signIn();
    mockLedgers([LEDGER_A, LEDGER_B]);

    const router = renderRouter(ROUTES, { initialUrl: '/login' });
    await waitFor(() => expect(router.getPathname()).toBe('/home'));
  });

  test('/login?next= beats the landing logic for a user who is already signed in', async () => {
    await signIn();
    mockLedgers([LEDGER_A, LEDGER_B]);

    const router = renderRouter(ROUTES, { initialUrl: '/login?next=%2Ftransactions' });

    await waitFor(() => expect(router.getPathname()).toBe('/transactions'));
  });

  test('an unsafe ?next= is ignored and the landing logic decides', async () => {
    await signIn();
    mockLedgers([LEDGER_A, LEDGER_B]);

    const router = renderRouter(ROUTES, { initialUrl: '/login?next=%2F%2Fevil.example.com' });

    await waitFor(() => expect(router.getPathname()).toBe('/home'));
  });
});

describe('rule 3 — the ledger pages need a ledger (§14.66 c)', () => {
  test('a ledger page renders the current ledger', async () => {
    await signIn();
    mockLedgers([LEDGER_A]);

    const router = renderRouter(ROUTES, { initialUrl: '/transactions' });
    expect(await router.findByText('transactions-page @ 家庭账本')).toBeTruthy();
  });

  test('with zero ledgers, a ledger page gives way to the onboarding page', async () => {
    await signIn();
    mockLedgers([]);

    const router = renderRouter(ROUTES, { initialUrl: '/transactions' });
    await waitFor(() => expect(router.getPathname()).toBe('/ledgers'));
    expect(await router.findByText('ledgers-page')).toBeTruthy();
  });

  test('with zero ledgers, personal settings still opens — it is not a ledger page', async () => {
    await signIn();
    mockLedgers([]);

    const router = renderRouter(ROUTES, { initialUrl: '/settings' });
    expect(await router.findByText('settings-page')).toBeTruthy();
    expect(router.getPathname()).toBe('/settings');
  });
});

describe('rule 4 — a 404 on the ledger detail is the anchor for "you were removed"', () => {
  test('the flag the query cache raises moves the tab to a ledger it can still open', async () => {
    await signIn();
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_A);
    mockLedgers([LEDGER_A, LEDGER_B]);

    const router = renderRouter(ROUTES, { initialUrl: '/transactions' });
    expect(await router.findByText('transactions-page @ 家庭账本')).toBeTruthy();

    // This is what `registerQueryHandlers` does on a 404 `not_found` from
    // `GET /ledgers/{id}` (04 §2.4). The re-read list no longer has the ledger.
    mockLedgers([LEDGER_B]);
    act(() => markLedgerUnavailable(LEDGER_A));

    expect(await router.findByText('transactions-page @ 旅行账本')).toBeTruthy();
    expect(router.getPathname()).toBe('/transactions');
  });

  test('a flag on the last ledger sends the ledger pages to the onboarding', async () => {
    await signIn();
    mockLedgers([LEDGER_A]);

    const router = renderRouter(ROUTES, { initialUrl: '/transactions' });
    expect(await router.findByText('transactions-page @ 家庭账本')).toBeTruthy();

    act(() => markLedgerUnavailable(LEDGER_A));

    await waitFor(() => expect(router.getPathname()).toBe('/ledgers'));
  });
});

describe('rule 5 — a 401 hands control back to the auth guard', () => {
  test('a stored token the server rejects ends up on /login', async () => {
    await setAuthToken('stale-token');
    mockGet('/me', { detail: 'Not authenticated', code: 'unauthorized' }, 401);
    mockLedgers([LEDGER_A]);

    const router = renderRouter(ROUTES, { initialUrl: '/transactions' });

    await waitFor(() => expect(router.getPathname()).toBe('/login'));
    expect(router.getSearchParams().next).toBe('/transactions');
  });
});

describe('the catch-all route', () => {
  test('an unknown path renders the 404 screen', async () => {
    mockLedgers([LEDGER_A]);
    const router = renderRouter(ROUTES, { initialUrl: '/nowhere-at-all' });
    expect(await router.findByText('页面不存在')).toBeTruthy();
    expect(router.getByText('回到首页')).toBeTruthy();
  });

  test('an old `/l/<id>` address is not a page any more', async () => {
    mockLedgers([LEDGER_A]);
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions` });
    expect(await router.findByText('页面不存在')).toBeTruthy();
  });

  test('「回到首页」 on the 404 screen goes to `/` and lands on /home (§14.65 e)', async () => {
    await signIn();
    mockLedgers([LEDGER_A]);
    const router = renderRouter(ROUTES, { initialUrl: '/nowhere-at-all' });

    fireEvent.press(await router.findByTestId('not-found-actions'));

    await waitFor(() => expect(router.getPathname()).toBe('/home'));
  });
});
