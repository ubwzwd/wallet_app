/**
 * The responsive shell of 04 §1.4 at both sides of the single 1024 breakpoint, and the
 * chrome's copy — every label comes from the language pack.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, fireEvent, renderHook, renderRouter, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

// `expo-font` reaches for `expo-asset`, which is not in the dependency tree (see the task
// notes); fonts never gate rendering anyway, so the root layout's `useAppFonts()` is stubbed.
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

import RootLayout from '../../../app/_layout';
import AppGroupLayout from '../../../app/(app)/_layout';
import LedgerLayout from '../../../app/(app)/l/[ledgerId]/_layout';

import { setAuthToken } from '@/api/client';
import * as i18n from '@/i18n';
import { initI18n } from '@/i18n';
import { queryClient } from '@/queries';
import { makeLedger, makeUser } from '@/test/fixtures';
import { mockApi, mockGet, type MockApi } from '@/test/mockApi';
import { space } from '@/theme/tokens';
import * as breakpoint from '@/theme/useBreakpoint';
import { toast } from '@/ui';
import { PREF_NAMES, setPref } from '@/utils/prefs';

import { TAB_BAR_HEIGHT } from '../BottomTabBar';
import { resetLedgerGone } from '../RequireLedger';
import { useSwUpdateToast } from '../useSwUpdateToast';

const LEDGER_A = 'ledger-a';
const LEDGER_B = 'ledger-b';

const ROUTES = {
  _layout: RootLayout,
  index: () => <Text>landing</Text>,
  '(auth)/login': () => <Text>login-page</Text>,
  '(app)/_layout': AppGroupLayout,
  '(app)/ledgers/index': () => <Text>ledgers-page</Text>,
  '(app)/ledgers/new': () => <Text>new-ledger-page</Text>,
  '(app)/ledgers/join': () => <Text>join-ledger-page</Text>,
  '(app)/settings': () => <Text>settings-page</Text>,
  '(app)/l/[ledgerId]/_layout': LedgerLayout,
  '(app)/l/[ledgerId]/index': () => <Text>ledger-home</Text>,
  '(app)/l/[ledgerId]/transactions/index': () => <Text>transactions-page</Text>,
  '(app)/l/[ledgerId]/transactions/new': () => <Text>new-transaction-page</Text>,
  '(app)/l/[ledgerId]/settings': () => <Text>ledger-settings-page</Text>,
};

let api: MockApi;
let widthSpy: jest.SpyInstance;

/** Force the layout branch the test is about (the shell branches on `useIsWide`). */
function setWide(wide: boolean): void {
  widthSpy = jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(wide);
}

beforeEach(async () => {
  api = mockApi();
  queryClient.clear();
  resetLedgerGone();
  await initI18n();
  await i18next.changeLanguage('zh');
  await setPref(PREF_NAMES.lastLedgerId, null);
  await setAuthToken('test-access-token');
  mockGet('/me', makeUser({ display_name: '阿狸' }));
  mockGet('/ledgers', {
    items: [
      makeLedger({ id: LEDGER_A, name: '家庭账本', base_currency: 'CNY', role: 'owner' }),
      makeLedger({ id: LEDGER_B, name: '旅行账本', base_currency: 'SGD', role: 'member' }),
    ],
    total: 2,
  });
});

afterEach(() => {
  widthSpy?.mockRestore();
  api.restore();
  toast.clear();
});

describe('narrow (<1024)', () => {
  beforeEach(() => setWide(false));

  test('renders the five bottom slots and no sidebar', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    expect(await router.findByTestId('bottom-tab-bar')).toBeTruthy();
    for (const id of ['tab-home', 'tab-transactions', 'tab-add', 'tab-imports', 'tab-me']) {
      expect(router.getByTestId(id)).toBeTruthy();
    }
    expect(router.queryByTestId('sidebar')).toBeNull();
    expect(router.getByTestId('app-shell-narrow')).toBeTruthy();
  });

  test('the tabs carry the tab role and mark the current one as selected', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions` });

    const current = await router.findByTestId('tab-transactions');
    expect(current.props.accessibilityState.selected).toBe(true);
    expect(current.props.role ?? current.props.accessibilityRole).toBe('tab');
    expect(router.getByTestId('tab-home').props.accessibilityState.selected).toBe(false);
  });

  test('the centre button goes straight to a new expense', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    fireEvent.press(await router.findByTestId('tab-add'));

    await waitFor(() =>
      expect(router.getPathname()).toBe(`/l/${LEDGER_A}/transactions/new`),
    );
    expect(router.getSearchParams().kind).toBe('expense');
  });

  test('long-pressing the centre button offers all four kinds', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    fireEvent(await router.findByTestId('tab-add'), 'longPress');

    expect(await router.findByTestId('kind-sheet-transfer')).toBeTruthy();
    for (const label of ['支出', '收入', '退款', '转账']) {
      expect(router.getByText(label)).toBeTruthy();
    }
  });

  test('the top bar shows the ledger name and opens the switcher', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    expect(await router.findByTestId('top-bar')).toBeTruthy();
    fireEvent.press(router.getByTestId('top-bar-ledger'));

    expect(await router.findByTestId(`ledger-switcher-row-${LEDGER_B}`)).toBeTruthy();
    expect(router.getByText('旅行账本')).toBeTruthy();
    expect(router.getByText('成员')).toBeTruthy();
    expect(router.getByText('创建者')).toBeTruthy();
  });

  test('the toast host clears the tab bar inside a ledger and sits low outside it', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });
    expect(await router.findByTestId('bottom-tab-bar')).toBeTruthy();

    act(() => {
      toast.info('哟');
    });

    const inLedger = StyleSheet.flatten(
      (await router.findByTestId('toast-host')).props.style,
    ) as { bottom?: number };
    expect(inLedger.bottom).toBe(space['4'] + TAB_BAR_HEIGHT);

    // `/settings` has no tab bar, so nothing has to be cleared.
    router.unmount();
    const settings = renderRouter(ROUTES, { initialUrl: '/settings' });
    expect(await settings.findByText('settings-page')).toBeTruthy();

    act(() => {
      toast.info('哟');
    });

    const outside = StyleSheet.flatten(
      (await settings.findByTestId('toast-host')).props.style,
    ) as { bottom?: number };
    expect(outside.bottom).toBe(space['4']);
  });

  test('an error toast names its detail toggle and its close button from the pack', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });
    expect(await router.findByTestId('bottom-tab-bar')).toBeTruthy();

    act(() => {
      toast.error('出错了', { detail: 'HTTP 500' });
    });

    expect(await router.findByLabelText('查看详情')).toBeTruthy();
    expect(router.getByLabelText('关闭')).toBeTruthy();
  });

  test('/settings keeps the chrome: a title bar with a way back, and no tabs', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });

    expect(await router.findByText('settings-page')).toBeTruthy();
    expect(router.getByTestId('app-shell-narrow')).toBeTruthy();
    expect(router.getByLabelText('返回')).toBeTruthy();
    // Every tab is ledger-scoped, and there is no ledger here.
    expect(router.queryByTestId('bottom-tab-bar')).toBeNull();
    expect(router.queryByTestId('top-bar-ledger')).toBeNull();
  });
});

describe('wide (>=1024)', () => {
  beforeEach(() => setWide(true));

  test('renders the six sidebar destinations, the primary button, and no tab bar', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    expect(await router.findByTestId('sidebar')).toBeTruthy();
    for (const label of ['首页', '交易', '账户', '导入', '账本设置', '个人设置']) {
      expect(router.getByText(label)).toBeTruthy();
    }
    expect(router.getByTestId('sidebar-add')).toBeTruthy();
    expect(router.getByText('记一笔')).toBeTruthy();

    // Decision §14.52 A21: neither of these is a top-level destination.
    expect(router.queryByText('报表')).toBeNull();
    expect(router.queryByText('成员')).toBeNull();

    expect(router.queryByTestId('bottom-tab-bar')).toBeNull();
    expect(router.getByTestId('app-shell-wide')).toBeTruthy();
  });

  test('the current destination is marked selected', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions` });

    const current = await router.findByTestId('sidebar-transactions');
    expect(current.props.accessibilityState.selected).toBe(true);
    expect(router.getByTestId('sidebar-home').props.accessibilityState.selected).toBe(false);
  });

  test('/l/:id marks 首页 selected without also matching 账本设置', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    expect((await router.findByTestId('sidebar-home')).props.accessibilityState.selected).toBe(
      true,
    );
    expect(router.getByTestId('sidebar-ledger-settings').props.accessibilityState.selected).toBe(
      false,
    );
  });

  test('the primary button opens 记一笔 for the current ledger', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    fireEvent.press(await router.findByTestId('sidebar-add'));
    await waitFor(() =>
      expect(router.getPathname()).toBe(`/l/${LEDGER_A}/transactions/new`),
    );
  });

  test('the footer names the signed-in member and offers a labelled log out', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    expect(await router.findByText('阿狸')).toBeTruthy();
    expect(router.getByLabelText('登出')).toBeTruthy();
  });

  test('/settings marks 个人设置 selected and keeps the ledger entries usable', async () => {
    // The user was in a ledger a moment ago, so the ledger-scoped entries still lead there.
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_B);
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });

    expect(await router.findByText('settings-page')).toBeTruthy();
    expect(router.getByTestId('sidebar-settings').props.accessibilityState.selected).toBe(true);
    expect(router.getByTestId('sidebar-home').props.accessibilityState.selected).toBe(false);
    // No ledger context: the header is a link to the ledger list, not the switcher.
    expect(router.queryByTestId('sidebar-ledger')).toBeNull();
    expect(router.getByTestId('sidebar-ledgers-link')).toBeTruthy();

    fireEvent.press(router.getByTestId('sidebar-transactions'));
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_B}/transactions`));
  });

  test('without a remembered ledger the sidebar sends every ledger entry to /ledgers', async () => {
    await setPref(PREF_NAMES.lastLedgerId, null);
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });

    expect(await router.findByText('settings-page')).toBeTruthy();
    expect(router.queryByTestId('sidebar-add')).toBeNull();

    fireEvent.press(router.getByTestId('sidebar-home'));
    await waitFor(() => expect(router.getPathname()).toBe('/ledgers'));
  });
});

describe('the language pack gate (04 §2)', () => {
  /** Pretend i18next has not booted yet, so the root layout runs its gate again. */
  function pretendUninitialized(): () => void {
    const was = i18next.isInitialized;
    Object.defineProperty(i18next, 'isInitialized', { value: false, configurable: true });
    return () =>
      Object.defineProperty(i18next, 'isInitialized', { value: was, configurable: true });
  }

  test('a language pack that fails to load offers a retry instead of a forever skeleton', async () => {
    setWide(false);
    const restore = pretendUninitialized();
    const initSpy = jest
      .spyOn(i18n, 'initI18n')
      .mockRejectedValueOnce(new Error('pack unavailable'));

    try {
      const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

      expect(await router.findByTestId('i18n-failed')).toBeTruthy();
      expect(router.queryByTestId('app-skeleton')).toBeNull();

      // The retry runs `initI18n()` again; this time it succeeds and the gate opens.
      initSpy.mockResolvedValue(undefined);
      fireEvent.press(router.getByTestId('i18n-retry'));

      await waitFor(() => expect(router.queryByTestId('i18n-failed')).toBeNull());
      expect(initSpy.mock.calls.length).toBeGreaterThan(1);
    } finally {
      initSpy.mockRestore();
      restore();
    }
  });
});

describe('service worker update toast (04 §7.2)', () => {
  type Handler = () => void;

  function installServiceWorker(): { fire(): void; removed(): boolean } {
    const handlers: Handler[] = [];
    let removals = 0;
    const container = {
      addEventListener: (type: string, fn: Handler) => {
        if (type === 'controllerchange') handlers.push(fn);
      },
      removeEventListener: () => {
        removals += 1;
      },
    };
    const scope = globalThis as { navigator?: unknown };
    if (!scope.navigator) scope.navigator = {};
    Object.defineProperty(scope.navigator as object, 'serviceWorker', {
      value: container,
      configurable: true,
    });
    return {
      fire: () => handlers.forEach((fn) => fn()),
      removed: () => removals > 0,
    };
  }

  function uninstallServiceWorker(): void {
    const nav = (globalThis as unknown as { navigator?: Record<string, unknown> }).navigator;
    if (nav) delete nav.serviceWorker;
  }

  afterEach(uninstallServiceWorker);

  test('a takeover raises exactly one info toast, and the listener is cleaned up', () => {
    const sw = installServiceWorker();
    const view = renderHook(() => useSwUpdateToast());

    act(() => sw.fire());

    const raised = toast.peek();
    expect(raised).toHaveLength(1);
    expect(raised[0].kind).toBe('info');
    expect(raised[0].message).toBe('已更新到新版本，刷新以使用');

    view.unmount();
    expect(sw.removed()).toBe(true);
  });

  test('without a service worker container nothing is subscribed and nothing is raised', () => {
    uninstallServiceWorker();
    renderHook(() => useSwUpdateToast());
    expect(toast.peek()).toHaveLength(0);
  });
});
