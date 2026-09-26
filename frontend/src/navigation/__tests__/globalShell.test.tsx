/**
 * Decision §14.64: one shell on every signed-in page, a global tab bar, and a back button
 * on every sub-page that steps back through history or, without any, goes to the page's
 * fixed parent. Decision §14.65: `/ledgers/new` and `/ledgers/join` are sub-pages of the
 * recent ledger's home, and the switcher ends with 账本设置. Decision §14.62: the "me"
 * sheet adds 账户, and `/accounts` is a sub-page of the recent ledger's home on a narrow
 * screen.
 *
 * `/ledgers` is a probe here only for the no-ledger cases; with ledgers it redirects, which
 * `screens/ledgers/__tests__/ledgers.test.tsx` covers on the real screen.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import { router as expoRouter } from 'expo-router';
import i18next from 'i18next';

// `expo-font` reaches for `expo-asset`, which is not in the dependency tree; fonts never
// gate rendering anyway, so the root layout's `useAppFonts()` is stubbed.
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

import RootLayout from '../../../app/_layout';
import AppGroupLayout from '../../../app/(app)/_layout';
import LedgerLayout from '../../../app/(app)/l/[ledgerId]/_layout';

import { setAuthToken } from '@/api/client';
import { initI18n } from '@/i18n';
import { queryClient } from '@/queries';
import { useLeaveGuard } from '@/screens/transactions/form/useLeaveGuard';
import { makeLedger, makeUser } from '@/test/fixtures';
import { mockApi, mockGet, type MockApi } from '@/test/mockApi';
import * as breakpoint from '@/theme/useBreakpoint';
import { PageHeader, toast } from '@/ui';
import { PREF_NAMES, setPref } from '@/utils/prefs';

import { resetLedgerHistory } from '../ledgerHistory';
import { resetLedgerGone } from '../RequireLedger';
import { useTopBar } from '../TopBar';
import { useBack } from '../useBack';

const LEDGER_A = 'ledger-a';
const LEDGER_B = 'ledger-b';
const TX = 'tx-1';

/**
 * Stands in for a page: publishes its title, reports what `useBack` says, and draws the
 * wide breadcrumb exactly the way the real pages do.
 */
function Probe({ name }: { name: string }): React.JSX.Element {
  useTopBar(name);
  const back = useBack();
  return (
    <>
      <Text>{name}</Text>
      <Text testID="probe-back">{back.show ? `back:${back.parentLabel}` : 'no-back'}</Text>
      <PageHeader
        title={name}
        back={
          back.show
            ? { crumb: `${back.parentLabel} · ${name}`, onPress: back.goBack, label: '返回' }
            : undefined
        }
      />
    </>
  );
}

/** A form with unsaved changes, guarded the way the transaction forms are. */
function GuardedForm(): React.JSX.Element {
  useLeaveGuard(true);
  return <Probe name="记一笔" />;
}

const page = (name: string) =>
  function Page(): React.JSX.Element {
    return <Probe name={name} />;
  };

const ROUTES = {
  _layout: RootLayout,
  index: () => <Text>landing</Text>,
  '(auth)/login': () => <Text>login-page</Text>,
  '(app)/_layout': AppGroupLayout,
  '(app)/ledgers/index': page('开始'),
  '(app)/ledgers/new': page('新建账本'),
  '(app)/ledgers/join': page('加入账本'),
  '(app)/settings': page('个人设置'),
  '(app)/accounts/index': page('账户'),
  '(app)/l/[ledgerId]/_layout': LedgerLayout,
  '(app)/l/[ledgerId]/index': page('首页'),
  '(app)/l/[ledgerId]/transactions/index': page('交易'),
  '(app)/l/[ledgerId]/transactions/new': GuardedForm,
  '(app)/l/[ledgerId]/transactions/[txId]/index': page('交易详情'),
  '(app)/l/[ledgerId]/imports/index': page('导入'),
  '(app)/l/[ledgerId]/settings': page('账本设置'),
};

let api: MockApi;
let widthSpy: jest.SpyInstance;

function setWide(wide: boolean): void {
  widthSpy = jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(wide);
}

function noLedgers(): void {
  mockGet('/me', makeUser({ display_name: '阿狸', ledger_count: 0 }));
  mockGet('/ledgers', { items: [], total: 0 });
}

beforeEach(async () => {
  api = mockApi();
  queryClient.clear();
  resetLedgerGone();
  resetLedgerHistory();
  await initI18n();
  await i18next.changeLanguage('zh');
  // The ledger the user last had open — the one the chrome names outside a ledger route.
  await setPref(PREF_NAMES.lastLedgerId, LEDGER_B);
  await setAuthToken('test-access-token');
  mockGet('/me', makeUser({ display_name: '阿狸' }));
  mockGet('/ledgers', {
    items: [
      makeLedger({ id: LEDGER_A, name: '家庭账本', role: 'owner' }),
      makeLedger({ id: LEDGER_B, name: '旅行账本', base_currency: 'SGD', role: 'member' }),
    ],
    total: 2,
  });
  mockGet(`/ledgers/${LEDGER_A}/members`, { items: [], total: 2 });
  mockGet(`/ledgers/${LEDGER_B}/members`, { items: [], total: 2 });
});

afterEach(() => {
  widthSpy?.mockRestore();
  api.restore();
  toast.clear();
});

describe('narrow (<1024)', () => {
  beforeEach(() => setWide(false));

  test('/ledgers/new: sub-page top bar, the tab bar with nothing lit, and a cold back to the recent ledger', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/ledgers/new' });

    expect(await router.findByTestId('top-bar-back')).toBeTruthy();
    expect(router.getByTestId('top-bar-title')).toHaveTextContent('新建账本');
    expect(router.queryByTestId('top-bar-ledger')).toBeNull();
    expect(router.getByTestId('bottom-tab-bar')).toBeTruthy();
    for (const id of ['tab-home', 'tab-transactions', 'tab-imports', 'tab-me']) {
      expect(router.getByTestId(id).props.accessibilityState.selected).toBe(false);
    }

    // A cold open has no history: the button goes to the recent ledger's home.
    fireEvent.press(router.getByTestId('top-bar-back'));
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_B}`));
  });

  test('/ledgers/join opened from inside a ledger: back returns to that very page', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/imports` });
    expect(await router.findByTestId('top-bar-ledger')).toBeTruthy();

    // The switcher's join row: leaving the ledger's shell for the global one must not
    // throw away the history, or the button can only fall back to the fixed parent.
    fireEvent.press(router.getByTestId('top-bar-ledger'));
    fireEvent.press(await router.findByTestId('ledger-switcher-join'));
    await waitFor(() => expect(router.getByTestId('top-bar-title')).toHaveTextContent('加入账本'));
    fireEvent.press(router.getByTestId('top-bar-back'));

    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_A}/imports`));
  });

  test('the ledger’s whole inner history survives the trip to /ledgers/new and back', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });
    expect(await router.findByTestId('top-bar-ledger')).toBeTruthy();
    act(() => expoRouter.push(`/l/${LEDGER_A}/transactions/${TX}`));
    await waitFor(() => expect(router.getByTestId('top-bar-title')).toHaveTextContent('交易详情'));

    act(() => expoRouter.navigate('/ledgers/new'));
    await waitFor(() => expect(router.getByTestId('top-bar-title')).toHaveTextContent('新建账本'));
    fireEvent.press(router.getByTestId('top-bar-back'));
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_A}/transactions/${TX}`));

    // One more step back is the page before the detail — home — not the detail's parent.
    fireEvent.press(await router.findByTestId('top-bar-back'));
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_A}`));
  });

  test('outside a ledger the tabs aim at the recent ledger', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/ledgers/new' });

    fireEvent.press(await router.findByTestId('tab-add'));
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_B}/transactions/new`));
    expect(router.getSearchParams().kind).toBe('expense');
  });

  test.each([
    ['home', `/l/${LEDGER_A}`],
    ['transactions', `/l/${LEDGER_A}/transactions`],
    ['imports', `/l/${LEDGER_A}/imports`],
  ])('%s is a top-level page: the ledger pill, no back button', async (_name, url) => {
    const router = renderRouter(ROUTES, { initialUrl: url });

    expect(await router.findByTestId('top-bar-ledger')).toBeTruthy();
    expect(router.queryByTestId('top-bar-back')).toBeNull();
    expect(router.getByTestId('probe-back')).toHaveTextContent('no-back');
  });

  test('a transaction detail is a sub-page; cold, its back goes to the list', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions/${TX}` });

    expect(await router.findByTestId('top-bar-back')).toBeTruthy();
    expect(router.queryByTestId('top-bar-ledger')).toBeNull();
    expect(router.getByTestId('top-bar-title')).toHaveTextContent('交易详情');
    expect(router.getByTestId('bottom-tab-bar')).toBeTruthy();

    fireEvent.press(router.getByTestId('top-bar-back'));
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_A}/transactions`));
  });

  test('with history, the back button steps back instead of going to the parent', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });
    expect(await router.findByTestId('top-bar-ledger')).toBeTruthy();

    act(() => expoRouter.push(`/l/${LEDGER_A}/transactions/${TX}`));
    fireEvent.press(await router.findByTestId('top-bar-back'));

    // Home, where the user came from — not the transaction list, the fixed parent.
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_A}`));
  });

  test('/accounts is a sub-page on a narrow screen, leading to the recent ledger’s home', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/accounts' });

    expect(await router.findByTestId('top-bar-back')).toBeTruthy();
    fireEvent.press(router.getByTestId('top-bar-back'));
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_B}`));
  });

  test('the "me" sheet outside a ledger opens the recent ledger’s settings', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });

    fireEvent.press(await router.findByTestId('tab-me'));
    fireEvent.press(await router.findByTestId('me-sheet-ledger-settings'));
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_B}/settings`));
  });

  test('the "me" sheet is 个人设置 / 账本设置 / 账户 / 登出 and nothing else (§14.65 b, §14.62)', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}` });

    fireEvent.press(await router.findByTestId('tab-me'));
    expect(await router.findByTestId('me-sheet-settings')).toBeTruthy();
    // The rows in order — the sheet's own backdrop and close button aside.
    const rows = router
      .getAllByTestId(/^me-sheet-/)
      .map((row) => row.props.testID as string)
      .filter((id) => id !== 'me-sheet-backdrop' && id !== 'me-sheet-close');
    expect(rows).toEqual([
      'me-sheet-settings',
      'me-sheet-ledger-settings',
      'me-sheet-accounts',
      'me-sheet-logout',
    ]);
    // Switching ledger is the top bar's pill; the sheet no longer repeats it.
    expect(router.queryByTestId('me-sheet-switch-ledger')).toBeNull();
    expect(router.queryByText('切换账本')).toBeNull();
  });

  test('the switcher sheet outside a ledger opens the picked ledger’s home', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });

    // The top bar's pill names the recent ledger and opens the sheet.
    expect(await router.findByText('旅行账本')).toBeTruthy();
    fireEvent.press(router.getByTestId('top-bar-ledger'));
    fireEvent.press(await router.findByTestId(`ledger-switcher-row-${LEDGER_A}`));

    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_A}`));
  });

  test('outside a ledger the switcher’s last row opens the recent ledger’s settings', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });

    fireEvent.press(await router.findByTestId('top-bar-ledger'));
    const row = await router.findByTestId('ledger-switcher-settings');
    expect(row).toHaveTextContent('账本设置');
    fireEvent.press(row);

    // Not the first ledger in the list: the one the chrome names (§14.65 a).
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_B}/settings`));
  });

  test('a user with no ledger: /ledgers* has no chrome at all (屏幕稿 15)', async () => {
    noLedgers();
    for (const url of ['/ledgers', '/ledgers/new', '/ledgers/join']) {
      const router = renderRouter(ROUTES, { initialUrl: url });
      expect(await router.findByTestId('probe-back')).toBeTruthy();
      await waitFor(() => expect(router.queryByTestId('top-bar')).toBeNull());
      expect(router.queryByTestId('bottom-tab-bar')).toBeNull();
      expect(router.queryByTestId('sidebar')).toBeNull();
      router.unmount();
    }
  });

  test('a user with no ledger: /settings has a sub-page bar back to /ledgers and no tabs', async () => {
    noLedgers();
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });

    expect(await router.findByTestId('top-bar-back')).toBeTruthy();
    expect(router.queryByTestId('bottom-tab-bar')).toBeNull();
    fireEvent.press(router.getByTestId('top-bar-back'));
    await waitFor(() => expect(router.getPathname()).toBe('/ledgers'));
  });

  test('the leave guard holds for the shell’s back button', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions/new` });

    fireEvent.press(await router.findByTestId('top-bar-back'));
    expect(await router.findByTestId('confirm-dialog')).toBeTruthy();
    expect(router.getPathname()).toBe(`/l/${LEDGER_A}/transactions/new`);

    await act(async () => {
      fireEvent.press(router.getByTestId('confirm-accept'));
    });
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_A}/transactions`));
  });
});

describe('wide (>=1024)', () => {
  beforeEach(() => setWide(true));

  test('/accounts is top-level: 账户 lit, no back button', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/accounts' });

    expect(
      (await router.findByTestId('sidebar-sources')).props.accessibilityState.selected,
    ).toBe(true);
    expect(router.getByTestId('probe-back')).toHaveTextContent('no-back');
    expect(router.queryByTestId('page-header-back')).toBeNull();
    expect(router.queryByTestId('top-bar')).toBeNull();
  });

  test('a sub-page carries the breadcrumb 「上级 · 本页」, and cold it goes to the parent', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/settings` });

    expect(await router.findByTestId('page-header-back')).toBeTruthy();
    expect(router.getByText('首页 · 账本设置')).toBeTruthy();
    fireEvent.press(router.getByTestId('page-header-back'));
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_A}`));
  });

  test.each([
    ['/ledgers/new', '首页 · 新建账本'],
    ['/ledgers/join', '首页 · 加入账本'],
  ])('%s: the breadcrumb names home and, cold, leads to the recent ledger', async (url, crumb) => {
    const router = renderRouter(ROUTES, { initialUrl: url });

    expect(await router.findByText(crumb)).toBeTruthy();
    fireEvent.press(router.getByTestId('page-header-back'));
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_B}`));
  });

  test('inside a ledger the switcher panel’s last row opens that ledger’s settings', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions` });

    fireEvent.press(await router.findByTestId('sidebar-ledger'));
    fireEvent.press(await router.findByTestId('ledger-switcher-settings'));
    await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_A}/settings`));
  });

  test('a user with no ledger: /ledgers has no column (屏幕稿 15)', async () => {
    noLedgers();
    const router = renderRouter(ROUTES, { initialUrl: '/ledgers' });

    expect(await router.findByTestId('probe-back')).toBeTruthy();
    await waitFor(() => expect(router.queryByTestId('sidebar')).toBeNull());
    expect(router.getByTestId('probe-back')).toHaveTextContent('no-back');
  });

  test('a user with no ledger: the /settings crumb names the onboarding, not a ledger list', async () => {
    noLedgers();
    const router = renderRouter(ROUTES, { initialUrl: '/settings' });

    await waitFor(() => expect(router.getByTestId('probe-back')).toHaveTextContent('back:开始'));
    expect(router.queryByText(/账本管理/)).toBeNull();
    fireEvent.press(router.getByTestId('page-header-back'));
    await waitFor(() => expect(router.getPathname()).toBe('/ledgers'));
  });

  test('the leave guard holds for the breadcrumb’s back button', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `/l/${LEDGER_A}/transactions/new` });

    fireEvent.press(await router.findByTestId('page-header-back'));
    expect(await router.findByTestId('confirm-dialog')).toBeTruthy();

    await act(async () => {
      fireEvent.press(router.getByTestId('confirm-cancel'));
    });
    await waitFor(() => expect(router.queryByTestId('confirm-dialog')).toBeNull());
    expect(router.getPathname()).toBe(`/l/${LEDGER_A}/transactions/new`);
  });
});
