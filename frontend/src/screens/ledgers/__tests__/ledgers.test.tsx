/**
 * `/ledgers` and `/ledgers/new` (04 §4.3, decisions §2 / §14.65 c / d).
 *
 * `/ledgers` is no longer a list of ledger cards: with a ledger it redirects to `/home`, the
 * page `/` would open; with none it is screen 15's onboarding; loading and failure keep their
 * states. Which ledger `/home` shows is the tab's current one (decision §14.66 b), so the
 * wrapper mounts `CurrentLedgerProvider` and the home route prints what it picked.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import type { Ledger } from '@/api/types';
import { setAuthToken } from '@/api';
import { initI18n } from '@/i18n';
import * as breakpoint from '@/theme/useBreakpoint';
import { AuthProvider, CurrentLedgerProvider, useOptionalLedgerContext } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ToastHost, toast } from '@/ui';
import {
  apiUrl,
  makeLedger,
  makeUser,
  mockApi,
  mockGet,
  mockPost,
  type MockApi,
} from '@/test';
import { qk } from '@/queries';
import { PREF_NAMES, getPref, setPref } from '@/utils/prefs';

import LedgersScreen from '../LedgersScreen';
import NewLedgerScreen from '../NewLedgerScreen';

let queryClient: QueryClient;
let api: MockApi;
/**
 * Whether the tree has the signed-in layout's `CurrentLedgerProvider`. One case turns it off
 * to see `/ledgers`'s own loading state, which the provider's skeleton would cover.
 */
let withCurrentLedger = true;

function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialPref="light">
        <AuthProvider queryClient={queryClient}>
          {withCurrentLedger ? <CurrentLedgerProvider>{children}</CurrentLedgerProvider> : children}
          <ToastHost />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/** `/home` names no ledger: it shows the tab's current one, which this prints. */
function HomeProbe(): React.JSX.Element {
  const current = useOptionalLedgerContext();
  return <RNText>{`ledger home ${current?.ledgerId ?? 'none'}`}</RNText>;
}

const ROUTES = {
  index: () => <RNText>landing</RNText>,
  'ledgers/index': LedgersScreen,
  'ledgers/new': NewLedgerScreen,
  'ledgers/join': () => <RNText>join page</RNText>,
  home: HomeProbe,
};

const TWO = {
  items: [makeLedger({ id: 'led-1', name: 'A' }), makeLedger({ id: 'led-2', name: 'B' })],
  total: 2,
};

function manyLedgers(n: number): Ledger[] {
  return Array.from({ length: n }, (_, i) =>
    makeLedger({ id: `ledger-${i}`, name: `账本 ${i}`, role: i === 0 ? 'owner' : 'member' }),
  );
}

beforeEach(async () => {
  withCurrentLedger = true;
  api = mockApi();
  await setAuthToken('test-token');
  toast.clear();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  await initI18n();
  await i18next.changeLanguage('zh');
  await setPref(PREF_NAMES.lastLedgerId, null);
  mockGet('/me', makeUser({ base_currency: 'SGD' }));
  mockGet('/rates/currencies', { currencies: { CNY: 'Chinese Yuan', SGD: 'Singapore Dollar' } });
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  jest.restoreAllMocks();
});

test('with no ledgers the page is the onboarding guide, offering create and join', async () => {
  mockGet('/ledgers', { items: [], total: 0 });
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  // Screen 15: no list, no chrome — a title, one sentence and the two ways forward.
  expect(await screen.findByTestId('ledgers-empty')).toBeTruthy();
  expect(screen.getByText('先有一本账')).toBeTruthy();
  expect(screen.getByTestId('ledgers-empty-secondary')).toBeTruthy();

  fireEvent.press(screen.getByTestId('ledgers-empty-primary'));
  await waitFor(() => expect(router.getPathname()).toBe('/ledgers/new'));
});

test('with ledgers, /ledgers is not a page: it lands on the remembered ledger’s home', async () => {
  await setPref(PREF_NAMES.lastLedgerId, 'led-2');
  mockGet('/ledgers', TWO);
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  await waitFor(() => expect(router.getPathname()).toBe('/home'));
  expect(await screen.findByText('ledger home led-2')).toBeTruthy();
  // No cards, no 「账本管理」 anywhere on the way.
  expect(screen.queryByText('账本管理')).toBeNull();
});

test('with nothing remembered, /ledgers lands where `/` would: the first ledger', async () => {
  mockGet('/ledgers', TWO);
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  await waitFor(() => expect(router.getPathname()).toBe('/home'));
  expect(await screen.findByText('ledger home led-1')).toBeTruthy();
});

test('a remembered ledger the user no longer belongs to is not a destination', async () => {
  await setPref(PREF_NAMES.lastLedgerId, 'led-gone');
  mockGet('/ledgers', TWO);
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  await waitFor(() => expect(router.getPathname()).toBe('/home'));
  expect(await screen.findByText('ledger home led-1')).toBeTruthy();
});

test('while the list is loading /ledgers waits with placeholders and guesses nothing', async () => {
  withCurrentLedger = false;
  api.mock.onGet(apiUrl('/ledgers')).reply(() => new Promise(() => undefined));
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  expect(await screen.findByTestId('ledger-skeleton-0')).toBeTruthy();
  expect(router.getPathname()).toBe('/ledgers');
});

test('after the current ledger is removed, /ledgers waits for the re-read instead of landing back in it', async () => {
  // DangerZone: `removeLedger` invalidates the list and goes to `/ledgers` straight away,
  // while the cache and `last_ledger_id` still name the ledger that is gone.
  await setPref(PREF_NAMES.lastLedgerId, 'led-1');
  queryClient.setQueryData(qk.global.ledgers(), TWO);
  let resolveGet: (value: [number, unknown]) => void = () => undefined;
  api.mock.onGet(apiUrl('/ledgers')).reply(
    () =>
      new Promise<[number, unknown]>((resolve) => {
        resolveGet = resolve;
      }),
  );
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });
  const seen: string[] = [];
  const record = (): void => {
    const path = router.getPathname();
    if (seen[seen.length - 1] !== path) seen.push(path);
  };
  void queryClient.invalidateQueries({ queryKey: qk.global.ledgers() });

  expect(await screen.findByTestId('ledger-skeleton-0')).toBeTruthy();
  record();
  expect(router.getPathname()).toBe('/ledgers');

  resolveGet([200, { items: [makeLedger({ id: 'led-2', name: 'B' })], total: 1 }]);
  await waitFor(() => {
    record();
    expect(router.getPathname()).toBe('/home');
  });
  // Straight from the placeholders to the ledger that is left — never home in the gone one.
  expect(seen).toEqual(['/ledgers', '/home']);
  expect(await screen.findByText('ledger home led-2')).toBeTruthy();
});

test('a load failure offers a retry that refetches, and then lands', async () => {
  // The page's own failure state, which the provider's would otherwise cover.
  withCurrentLedger = false;
  mockGet('/ledgers', { detail: 'boom', code: 'internal_error' }, 500);
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers', wrapper: Wrapper });

  expect(await screen.findByTestId('ledgers-error')).toBeTruthy();
  expect(screen.getByText('加载失败，请重试')).toBeTruthy();
  expect(router.getPathname()).toBe('/ledgers');

  mockGet('/ledgers', TWO);
  fireEvent.press(screen.getByText('重试'));
  await waitFor(() => expect(router.getPathname()).toBe('/home'));
});

/** `POST /ledgers` answers `ledger`, and from then on the ledger list has it too. */
function createAnswers(ledger: Ledger, before: Ledger[] = []): void {
  api.mock.onPost(apiUrl('/ledgers')).reply(() => {
    mockGet('/ledgers', { items: [...before, ledger], total: before.length + 1 });
    return [200, ledger];
  });
}

test('creating a ledger defaults to the user currency and lands in the new ledger', async () => {
  mockGet('/ledgers', { items: [], total: 0 });
  createAnswers(makeLedger({ id: 'new-led', name: '旅行账本', base_currency: 'SGD' }));
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers/new', wrapper: Wrapper });

  await waitFor(() => expect(screen.getByText('SGD')).toBeTruthy());
  fireEvent.changeText(await screen.findByTestId('new-ledger-name'), '旅行账本');
  fireEvent.press(screen.getByTestId('new-ledger-submit'));

  // §14.66: the address is just `/home`; the new ledger is the tab's current one.
  await waitFor(() => expect(router.getPathname()).toBe('/home'));
  expect(await screen.findByText('ledger home new-led')).toBeTruthy();
  const body = JSON.parse(api.mock.history.post[0].data as string) as Record<string, string>;
  expect(body).toEqual({ name: '旅行账本', base_currency: 'SGD' });
  expect(await screen.findByTestId('toast-success')).toHaveTextContent('已创建《旅行账本》');
});

test('creating a ledger beside others makes the new one current, not the remembered one', async () => {
  await setPref(PREF_NAMES.lastLedgerId, 'led-2');
  mockGet('/ledgers', TWO);
  const created = makeLedger({ id: 'new-led', name: '旅行账本', base_currency: 'SGD' });
  createAnswers(created, TWO.items);
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers/new', wrapper: Wrapper });

  fireEvent.changeText(await screen.findByTestId('new-ledger-name'), '旅行账本');
  fireEvent.press(screen.getByTestId('new-ledger-submit'));

  await waitFor(() => expect(router.getPathname()).toBe('/home'));
  expect(await screen.findByText('ledger home new-led')).toBeTruthy();
  // ...and it is what the next landing remembers, too.
  await waitFor(async () => expect(await getPref(PREF_NAMES.lastLedgerId)).toBe('new-led'));
});

test('an empty ledger name is refused before the request', async () => {
  mockGet('/ledgers', { items: [], total: 0 });
  renderRouter(ROUTES, { initialUrl: '/ledgers/new', wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('new-ledger-submit'));

  expect(await screen.findByText('这是必填项')).toBeTruthy();
  expect(api.mock.history.post.length).toBe(0);
});

test('ten ledgers disable creating and explain why (decision §2)', async () => {
  // The cap used to be shown on the ledger list's 新建 button; with no list page (§14.65 c)
  // the create page itself is where it is enforced and explained.
  mockGet('/ledgers', { items: manyLedgers(10), total: 10 });
  renderRouter(ROUTES, { initialUrl: '/ledgers/new', wrapper: Wrapper });

  expect(await screen.findByTestId('new-ledger-limit')).toHaveTextContent(/10/);
  expect(screen.getByTestId('new-ledger-submit').props.accessibilityState.disabled).toBe(true);
  expect(api.mock.history.post.length).toBe(0);
});

test('宽屏 the create page is a sub-page: 「首页 · 新建账本」, and cold it goes home (§14.65 d)', async () => {
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(true);
  await setPref(PREF_NAMES.lastLedgerId, 'led-2');
  mockGet('/ledgers', TWO);
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers/new', wrapper: Wrapper });

  expect(await screen.findByTestId('new-ledger-header-title')).toHaveTextContent('新建账本');
  expect(await screen.findByText('首页 · 新建账本')).toBeTruthy();
  // A cold open has no history, so the crumb goes to the parent: the current ledger's home.
  fireEvent.press(screen.getByTestId('new-ledger-header-back'));
  await waitFor(() => expect(router.getPathname()).toBe('/home'));
  expect(await screen.findByText('ledger home led-2')).toBeTruthy();
});

test('宽屏 a cold open reserves the crumb row before the recent ledger is known (no pop-in)', async () => {
  jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(true);
  // The page itself, before anything above it knows the ledger list.
  withCurrentLedger = false;
  // The ledger list never answers, so the back target stays unknown.
  api.mock.onGet(apiUrl('/ledgers')).reply(() => new Promise(() => undefined));
  renderRouter(ROUTES, { initialUrl: '/ledgers/new', wrapper: Wrapper });

  expect(await screen.findByTestId('new-ledger-header-back')).toBeTruthy();
  expect(screen.getByText('首页 · 新建账本')).toBeTruthy();
});

test('outside the shell (a user with no ledger) the create page draws its own way back', async () => {
  mockGet('/ledgers', { items: [], total: 0 });
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers/new', wrapper: Wrapper });

  expect(await screen.findByTestId('new-ledger-header-title')).toHaveTextContent('新建账本');
  fireEvent.press(screen.getByTestId('new-ledger-header-back'));
  await waitFor(() => expect(router.getPathname()).toBe('/ledgers'));
});
