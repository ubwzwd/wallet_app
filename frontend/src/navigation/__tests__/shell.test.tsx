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
import { apiUrl, mockApi, mockGet, type MockApi } from '@/test/mockApi';
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
      makeLedger({
        id: LEDGER_B,
        name: '旅行账本',
        base_currency: 'SGD',
        role: 'member',
        member_count: 4,
      }),
    ],
    total: 2,
  });
  // The sidebar's ledger card names the members while there are few enough of them.
  mockGet(`/ledgers/${LEDGER_A}/members`, {
    items: [
      {
        user_id: 'u-1',
        email: 'ali@example.com',
        display_name: '阿狸',
        role: 'owner',
        joined_at: '2026-02-01T09:00:00Z',
        is_me: true,
      },
      {
        user_id: 'u-2',
        email: 'bo@example.com',
        display_name: '老婆',
        role: 'member',
        joined_at: '2026-02-02T09:00:00Z',
        is_me: false,
      },
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
    // Screen 01: each row carries the base currency and how many people are in that ledger.
    expect(router.getByText('SGD · 4 人')).toBeTruthy();
    expect(router.getByTestId('ledger-switcher-new')).toBeTruthy();
    expect(router.getByTestId('ledger-switcher-join')).toBeTruthy();
  });

  test('the switcher ends with a way to the full ledger list', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    fireEvent.press(await router.findByTestId('top-bar-ledger'));
    fireEvent.press(await router.findByTestId('ledger-switcher-manage'));

    await waitFor(() => expect(router.getPathname()).toBe('/ledgers'));
  });

  test('the top bar carries the member disc, which leads to personal settings', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    fireEvent.press(await router.findByTestId('top-bar-me'));

    await waitFor(() => expect(router.getPathname()).toBe('/settings'));
  });

  test('the bar is TAB_BAR_HEIGHT tall when added up from its own styles', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    const bar = StyleSheet.flatten(
      (await router.findByTestId('bottom-tab-bar')).props.style,
    ) as { paddingTop: number; paddingBottom: number };
    const slot = StyleSheet.flatten(router.getByTestId('tab-add').props.style) as {
      marginTop: number;
      gap: number;
    };
    const disc = StyleSheet.flatten(router.getByTestId('tab-add-disc').props.style) as {
      height: number;
    };
    const label = StyleSheet.flatten(router.getByTestId('tab-add-label').props.style) as {
      lineHeight: number;
    };

    // The centre slot is the tallest thing in the row, and it rides `marginTop` above it.
    const slotHeight = disc.height + slot.gap + label.lineHeight + slot.marginTop;
    // Measured, not restated: growing the disc or the label fails this, and the toast host
    // offsets itself by the constant.
    expect(bar.paddingTop + slotHeight + bar.paddingBottom).toBe(TAB_BAR_HEIGHT);
  });

  test('the toast host clears the tab bar wherever there is one (§14.64 b)', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });
    expect(await router.findByTestId('bottom-tab-bar')).toBeTruthy();

    act(() => {
      toast.info('哟');
    });

    const inLedger = StyleSheet.flatten(
      (await router.findByTestId('toast-host')).props.style,
    ) as { bottom?: number };
    expect(inLedger.bottom).toBe(space['4'] + TAB_BAR_HEIGHT);

    // `/settings` carries the tab bar too now, so the toast clears it there as well.
    router.unmount();
    const settings = renderRouter(ROUTES, { initialUrl: '/settings' });
    expect(await settings.findByTestId('bottom-tab-bar')).toBeTruthy();

    act(() => {
      toast.info('哟');
    });

    const outside = StyleSheet.flatten(
      (await settings.findByTestId('toast-host')).props.style,
    ) as { bottom?: number };
    expect(outside.bottom).toBe(space['4'] + TAB_BAR_HEIGHT);
  });

  test('a user with no ledger has no tab bar, so the toast host sits low', async () => {
    mockGet('/me', makeUser({ display_name: '阿狸', ledger_count: 0 }));
    mockGet('/ledgers', { items: [], total: 0 });
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });
    expect(await router.findByText('settings-page')).toBeTruthy();

    act(() => {
      toast.info('哟');
    });

    const host = StyleSheet.flatten((await router.findByTestId('toast-host')).props.style) as {
      bottom?: number;
    };
    expect(host.bottom).toBe(space['4']);
    expect(router.queryByTestId('bottom-tab-bar')).toBeNull();
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

  test('/ledgers wears the shell at 375: a sub-page top bar and the tab bar (§14.64)', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/ledgers' });

    expect(await router.findByText('ledgers-page')).toBeTruthy();
    expect(router.getByTestId('top-bar')).toBeTruthy();
    expect(await router.findByTestId('top-bar-back')).toBeTruthy();
    expect(router.queryByTestId('top-bar-ledger')).toBeNull();
    expect(router.getByTestId('bottom-tab-bar')).toBeTruthy();
    expect(router.queryByTestId('sidebar')).toBeNull();
  });

  test('/settings keeps the top-level bar and the tab bar, with 「我的」 lit', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });

    expect(await router.findByText('settings-page')).toBeTruthy();
    expect(router.getByTestId('app-shell-narrow')).toBeTruthy();
    // Top-level: the ledger pill and the member disc, no back button.
    expect(await router.findByText('家庭账本')).toBeTruthy();
    expect(router.getByTestId('top-bar-ledger')).toBeTruthy();
    expect(router.queryByTestId('top-bar-back')).toBeNull();
    expect(router.getByTestId('bottom-tab-bar')).toBeTruthy();
    expect(router.getByTestId('tab-me').props.accessibilityState.selected).toBe(true);
    for (const id of ['tab-home', 'tab-transactions', 'tab-imports']) {
      expect(router.getByTestId(id).props.accessibilityState.selected).toBe(false);
    }
  });
});

describe('wide (>=1024)', () => {
  beforeEach(() => setWide(true));

  test('renders the five sidebar destinations, the primary button, and no tab bar', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    expect(await router.findByTestId('sidebar')).toBeTruthy();
    for (const label of ['首页', '交易', '账户', '导入', '我的']) {
      expect(router.getByText(label)).toBeTruthy();
    }
    expect(router.getByTestId('sidebar-add')).toBeTruthy();
    expect(router.getByText('记一笔')).toBeTruthy();

    // §14.56: ledger settings is reached from the ledger card, not from the nav list.
    expect(router.queryByText('账本设置')).toBeNull();
    // Decision §14.52 A21: neither of these is a top-level destination.
    expect(router.queryByText('报表')).toBeNull();
    expect(router.queryByText('成员')).toBeNull();

    // There is no general top bar on a wide layout — each page carries its own header.
    expect(router.queryByTestId('top-bar')).toBeNull();
    expect(router.queryByTestId('bottom-tab-bar')).toBeNull();
    expect(router.getByTestId('app-shell-wide')).toBeTruthy();
  });

  test('the ledger card names the ledger and its members, and opens the switcher', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    expect(await router.findByTestId('sidebar-ledger')).toBeTruthy();
    // Screen 01 at 1440: "家庭账本" over "CNY · 我 + 老婆".
    expect(await router.findByText('CNY · 阿狸 + 老婆')).toBeTruthy();

    fireEvent.press(router.getByTestId('sidebar-ledger'));
    expect(await router.findByTestId(`ledger-switcher-row-${LEDGER_B}`)).toBeTruthy();
  });

  test('too many members to name: the ledger card falls back to a count', async () => {
    mockGet(`/ledgers/${LEDGER_B}/members`, {
      items: ['a', 'b', 'c', 'd'].map((n) => ({
        user_id: `u-${n}`,
        email: `${n}@example.com`,
        display_name: n,
        role: 'member',
        joined_at: '2026-02-02T09:00:00Z',
        is_me: false,
      })),
      total: 4,
    });
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_B}` });

    expect(await router.findByText('SGD · 4 人')).toBeTruthy();
    expect(router.queryByText('SGD · a + b + c + d')).toBeNull();
  });

  test("the ledger card's chevron goes to that ledger's own settings", async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    const chevron = await router.findByTestId('sidebar-ledger-settings');
    expect(chevron.props.accessibilityLabel ?? chevron.props['aria-label']).toBe('账本设置');
    fireEvent.press(chevron);

    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_A}/settings`));
  });

  test('the current destination is marked selected', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions` });

    const current = await router.findByTestId('sidebar-transactions');
    expect(current.props.accessibilityState.selected).toBe(true);
    expect(router.getByTestId('sidebar-home').props.accessibilityState.selected).toBe(false);
  });

  test('/l/:id marks 首页 selected without also matching its sub-paths', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    expect((await router.findByTestId('sidebar-home')).props.accessibilityState.selected).toBe(
      true,
    );
    for (const key of ['transactions', 'sources', 'imports', 'settings']) {
      expect(router.getByTestId(`sidebar-${key}`).props.accessibilityState.selected).toBe(false);
    }
  });

  test('the primary button opens 记一笔 for the current ledger', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    fireEvent.press(await router.findByTestId('sidebar-add'));
    await waitFor(() =>
      expect(router.getPathname()).toBe(`/l/${LEDGER_A}/transactions/new`),
    );
  });

  test('the footer names the signed-in member and their role, and leads to settings', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    expect(await router.findByTestId('sidebar-user')).toBeTruthy();
    expect(router.getByText('创建者')).toBeTruthy();

    fireEvent.press(router.getByTestId('sidebar-user'));
    await waitFor(() => expect(router.getPathname()).toBe('/settings'));
  });

  test('signing out is no longer in the chrome — it lives on the personal settings page', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    expect(await router.findByTestId('sidebar')).toBeTruthy();
    expect(router.queryByTestId('sidebar-logout')).toBeNull();
    expect(router.queryByLabelText('登出')).toBeNull();
  });

  test('/settings keeps the ledger card and the ledger entries usable', async () => {
    // The user was in a ledger a moment ago, so the ledger-scoped entries still lead there.
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_B);
    mockGet(`/ledgers/${LEDGER_B}/members`, { items: [], total: 4 });
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });

    expect(await router.findByText('settings-page')).toBeTruthy();
    expect(router.getByTestId('sidebar-settings').props.accessibilityState.selected).toBe(true);
    expect(router.getByTestId('sidebar-home').props.accessibilityState.selected).toBe(false);
    // Mockup 14 at 1440: the chrome does not change identity when 「我的」 opens — the card
    // still names the ledger the user was last in, not 「账本管理」.
    expect(await router.findByText('旅行账本')).toBeTruthy();
    expect(router.getByTestId('sidebar-ledger')).toBeTruthy();
    expect(router.queryByTestId('sidebar-ledgers-link')).toBeNull();

    fireEvent.press(router.getByTestId('sidebar-transactions'));
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_B}/transactions`));
  });

  test('a cold /settings holds the card slot rather than flashing 「账本管理」', async () => {
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_B);
    mockGet(`/ledgers/${LEDGER_B}/members`, { items: [], total: 4 });
    // A cold load — a bookmark, a reload — reaches the sidebar with `GET /ledgers` still in
    // flight, so hold that request open and look at the frame it leaves behind.
    const pending: { resolve?: (reply: [number, unknown]) => void } = {};
    api.mock
      .onGet(apiUrl('/ledgers'))
      .reply(() => new Promise((resolve) => (pending.resolve = resolve)));
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });

    // The chrome shows no card at all rather than guessing the wrong one (mockup 14).
    expect(await router.findByTestId('sidebar-ledger-pending')).toBeTruthy();
    expect(router.queryByTestId('sidebar-ledgers-link')).toBeNull();

    pending.resolve?.([
      200,
      {
        items: [
          makeLedger({ id: LEDGER_A, name: '家庭账本' }),
          makeLedger({ id: LEDGER_B, name: '旅行账本', base_currency: 'SGD', member_count: 4 }),
        ],
        total: 2,
      },
    ]);

    expect(await router.findByText('旅行账本')).toBeTruthy();
    expect(router.queryByTestId('sidebar-ledger-pending')).toBeNull();
  });

  test('a cold /settings with nothing remembered still names a ledger (mockup 14)', async () => {
    await setPref(PREF_NAMES.lastLedgerId, null);
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });

    expect(await router.findByText('settings-page')).toBeTruthy();
    // No `last_ledger_id` yet (a bookmark, a fresh device): the chrome falls back to the
    // ledger `/` itself would open rather than to 「账本管理」.
    expect(await router.findByText('家庭账本')).toBeTruthy();
    expect(router.queryByTestId('sidebar-ledgers-link')).toBeNull();

    fireEvent.press(router.getByTestId('sidebar-transactions'));
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_A}/transactions`));
  });

  test('with no ledgers at all there is no card and nowhere to add', async () => {
    mockGet('/ledgers', { items: [], total: 0 });
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });

    expect(await router.findByTestId('sidebar-home')).toBeTruthy();
    await waitFor(() => expect(router.queryByTestId('sidebar-ledger-pending')).toBeNull());
    expect(router.queryByTestId('sidebar-ledger')).toBeNull();
    expect(router.queryByTestId('sidebar-add')).toBeNull();

    fireEvent.press(router.getByTestId('sidebar-home'));
    await waitFor(() => expect(router.getPathname()).toBe('/ledgers'));
  });

  test('/ledgers wears the same column as /settings: ledger card, five entries, 记一笔', async () => {
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_A);
    const router = renderRouter(ROUTES, { initialUrl: '/ledgers' });

    expect(await router.findByText('ledgers-page')).toBeTruthy();
    expect(router.getByTestId('app-shell-wide')).toBeTruthy();
    // §14.64 c: the card names the ledger the user last had open, as on `/settings`.
    expect(await router.findByTestId('sidebar-ledger')).toBeTruthy();
    expect(router.getByText('家庭账本')).toBeTruthy();
    expect(router.queryByTestId('sidebar-ledgers-link')).toBeNull();

    // All five entries, none of them lit — the ledger list is none of them.
    for (const key of ['home', 'transactions', 'sources', 'imports', 'settings']) {
      expect(router.getByTestId(`sidebar-${key}`).props.accessibilityState.selected).toBe(false);
    }
    expect(router.getByTestId('sidebar-add')).toBeTruthy();

    // The entries lead into the ledger the user last had open.
    fireEvent.press(router.getByTestId('sidebar-transactions'));
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_A}/transactions`));
  });

  test('/ledgers with nothing remembered names the ledger `/` would open', async () => {
    await setPref(PREF_NAMES.lastLedgerId, null);
    const router = renderRouter(ROUTES, { initialUrl: '/ledgers' });

    expect(await router.findByTestId('sidebar-ledger')).toBeTruthy();
    expect(router.getByText('家庭账本')).toBeTruthy();
    fireEvent.press(router.getByTestId('sidebar-add'));
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_A}/transactions/new`));
  });

  test('a user with no ledger at all gets no column: 屏幕稿 15 is full-bleed', async () => {
    await setPref(PREF_NAMES.lastLedgerId, null);
    mockGet('/me', makeUser({ display_name: '阿狸', ledger_count: 0 }));
    mockGet('/ledgers', { items: [], total: 0 });
    const router = renderRouter(ROUTES, { initialUrl: '/ledgers' });

    expect(await router.findByText('ledgers-page')).toBeTruthy();
    await waitFor(() => expect(router.queryByTestId('sidebar')).toBeNull());
    // Still the wide branch of the shell — it is the column that is gone, not the layout.
    expect(router.getByTestId('app-shell-wide')).toBeTruthy();
  });

  test('personal settings keeps the column even with no ledger — it is the way back', async () => {
    await setPref(PREF_NAMES.lastLedgerId, null);
    mockGet('/me', makeUser({ display_name: '阿狸', ledger_count: 0 }));
    mockGet('/ledgers', { items: [], total: 0 });
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });

    expect(await router.findByTestId('sidebar')).toBeTruthy();
  });

  test('the member row names the signed-in email where there is no role (屏幕稿 14)', async () => {
    mockGet('/me', makeUser({ display_name: '阿狸', email: 'ali@example.com' }));
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });

    const row = await router.findByTestId('sidebar-user');
    expect(row).toHaveTextContent(/阿狸/);
    // `/settings` is outside every ledger, so the second line falls back to the email
    // rather than collapsing the row to one line mid-navigation.
    expect(row).toHaveTextContent(/ali@example\.com/);
  });

  test('a cold /ledgers holds the card slot until the ledger to name is known', async () => {
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_A);
    // Hold `GET /ledgers` open: until it lands there is no ledger for the card to name.
    const pending: { resolve?: (reply: [number, unknown]) => void } = {};
    api.mock
      .onGet(apiUrl('/ledgers'))
      .reply(() => new Promise((resolve) => (pending.resolve = resolve)));
    const router = renderRouter(ROUTES, { initialUrl: '/ledgers' });

    expect(await router.findByTestId('sidebar-ledger-pending')).toBeTruthy();
    expect(router.queryByTestId('sidebar-ledger')).toBeNull();

    pending.resolve?.([200, { items: [makeLedger({ id: LEDGER_A, name: '家庭账本' })], total: 1 }]);

    expect(await router.findByTestId('sidebar-ledger')).toBeTruthy();
    expect(router.queryByTestId('sidebar-ledger-pending')).toBeNull();
  });

  test('/ledgers/new and /ledgers/join are full-bleed too for a 0-ledger user', async () => {
    await setPref(PREF_NAMES.lastLedgerId, null);
    mockGet('/me', makeUser({ display_name: '阿狸', ledger_count: 0 }));
    mockGet('/ledgers', { items: [], total: 0 });

    // 屏幕稿 15 sends a user with nothing to list straight to these two pages; the column
    // would point at nothing there just as it would on `/ledgers` itself, and both pages
    // carry their own way back, so the whole `/ledgers*` subtree runs full-bleed.
    const created = renderRouter(ROUTES, { initialUrl: '/ledgers/new' });
    expect(await created.findByText('new-ledger-page')).toBeTruthy();
    await waitFor(() => expect(created.queryByTestId('sidebar')).toBeNull());
    expect(created.getByTestId('app-shell-wide')).toBeTruthy();
    created.unmount();

    const joined = renderRouter(ROUTES, { initialUrl: '/ledgers/join' });
    expect(await joined.findByText('join-ledger-page')).toBeTruthy();
    await waitFor(() => expect(joined.queryByTestId('sidebar')).toBeNull());
  });

  test('/ledgers/new keeps the column for a user who does have ledgers (屏幕稿 13)', async () => {
    await setPref(PREF_NAMES.lastLedgerId, LEDGER_A);
    const router = renderRouter(ROUTES, { initialUrl: '/ledgers/new' });

    expect(await router.findByText('new-ledger-page')).toBeTruthy();
    expect(await router.findByTestId('sidebar')).toBeTruthy();
    // The same ledger card as everywhere else (§14.64 c).
    expect(await router.findByTestId('sidebar-ledger')).toBeTruthy();
    expect(router.getByTestId('sidebar-add')).toBeTruthy();
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
