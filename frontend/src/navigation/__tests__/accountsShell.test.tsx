/**
 * Decision §14.62: accounts belong to the user, so `/accounts*` lives outside any ledger and
 * wears the shell the way `/settings` does — the chrome names the tab's current ledger, the
 * sidebar's 「账户」 leads here and is lit here, and the "me" sheet has a row for it.
 * On a narrow screen `/accounts` is a sub-page with the tab bar (nothing lit), and the
 * account form is a form page: a back button, no tab bar (§14.64 b, §14.65 f).
 */
import React from 'react';
import { Text } from 'react-native';
import { fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

// `expo-font` reaches for `expo-asset`, which is not in the dependency tree; fonts never
// gate rendering anyway, so the root layout's `useAppFonts()` is stubbed.
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

import RootLayout from '../../../app/_layout';
import AppGroupLayout from '../../../app/(app)/_layout';

import { setAuthToken } from '@/api/client';
import { initI18n } from '@/i18n';
import { queryClient } from '@/queries';
import { makeLedger, makeUser } from '@/test/fixtures';
import { mockApi, mockGet, type MockApi } from '@/test/mockApi';
import * as breakpoint from '@/theme/useBreakpoint';
import { PageHeader, toast } from '@/ui';
import { PREF_NAMES, setPref } from '@/utils/prefs';

import { resetLedgerUnavailable } from '@/store';
import { useTopBar } from '../TopBar';
import { useBack } from '../useBack';

const LEDGER_A = 'ledger-a';
const LEDGER_B = 'ledger-b';

/** Stands in for a page: publishes its title and draws the wide breadcrumb the real way. */
function Probe({ name }: { name: string }): React.JSX.Element {
  useTopBar(name);
  const back = useBack();
  return (
    <>
      <Text>{name}</Text>
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
  '(app)/settings': page('个人设置'),
  // No `accounts/_layout`: every signed-in page sits directly under `(app)` (§14.66 g).
  '(app)/accounts/index': page('账户'),
  '(app)/accounts/new': page('新建账户'),
  '(app)/accounts/[sourceId]/edit': page('编辑账户'),
  '(app)/home': page('首页'),
  '(app)/transactions/index': page('交易'),
};

let api: MockApi;
let widthSpy: jest.SpyInstance;

function setWide(wide: boolean): void {
  widthSpy = jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(wide);
}

beforeEach(async () => {
  api = mockApi();
  queryClient.clear();
  resetLedgerUnavailable();
  await initI18n();
  await i18next.changeLanguage('zh');
  // The ledger the user last had open — the tab's current ledger, on every page (§14.66 b).
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

  test('/accounts: a sub-page bar, and the tab bar with nothing lit', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/accounts' });

    expect(await router.findByTestId('top-bar-back')).toBeTruthy();
    expect(router.queryByTestId('top-bar-ledger')).toBeNull();
    expect(router.getByTestId('top-bar-title')).toHaveTextContent('账户');
    expect(router.getByTestId('bottom-tab-bar')).toBeTruthy();
    for (const id of ['tab-home', 'tab-transactions', 'tab-imports', 'tab-me']) {
      expect(router.getByTestId(id).props.accessibilityState.selected).toBe(false);
    }
  });

  test.each([
    ['/accounts/new', '新建账户'],
    [`/accounts/new?ledger=${LEDGER_A}`, '新建账户'],
    ['/accounts/src-1/edit', '编辑账户'],
  ])('%s is a form page: a back button to /accounts and no tab bar', async (url, title) => {
    const router = renderRouter(ROUTES, { initialUrl: url });

    expect(await router.findByTestId('top-bar-back')).toBeTruthy();
    expect(router.getByTestId('top-bar-title')).toHaveTextContent(title);
    expect(router.queryByTestId('bottom-tab-bar')).toBeNull();

    // Cold: no history to step back through, so the fixed parent.
    fireEvent.press(router.getByTestId('top-bar-back'));
    await waitFor(() => expect(router.getPathname()).toBe('/accounts'));
  });

  test.each([
    ['on a ledger page', '/home'],
    ['on a personal page', '/settings'],
  ])('the "me" sheet’s 账户 row opens /accounts (%s)', async (_name, url) => {
    const router = renderRouter(ROUTES, { initialUrl: url });

    fireEvent.press(await router.findByTestId('tab-me'));
    const row = await router.findByTestId('me-sheet-accounts');
    expect(row).toHaveTextContent('账户');
    fireEvent.press(row);
    await waitFor(() => expect(router.getPathname()).toBe('/accounts'));
  });
});

describe('wide (>=1024)', () => {
  beforeEach(() => setWide(true));

  test('the sidebar’s 账户 leads to /accounts, not to a ledger page', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/home' });

    fireEvent.press(await router.findByTestId('sidebar-sources'));
    await waitFor(() => expect(router.getPathname()).toBe('/accounts'));
  });

  test('/accounts: 账户 lit, the card names the current ledger, no back button', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/accounts' });

    expect(await router.findByTestId('sidebar-ledger')).toBeTruthy();
    expect(router.getByText('旅行账本')).toBeTruthy();
    expect(router.getByTestId('sidebar-sources').props.accessibilityState.selected).toBe(true);
    for (const key of ['home', 'transactions', 'imports', 'settings']) {
      expect(router.getByTestId(`sidebar-${key}`).props.accessibilityState.selected).toBe(false);
    }
    expect(router.queryByTestId('page-header-back')).toBeNull();
    expect(router.getByTestId('sidebar-add')).toBeTruthy();
  });

  test('/accounts/new keeps 账户 lit and carries the crumb 「账户 · 新建账户」', async () => {
    const router = renderRouter(ROUTES, { initialUrl: '/accounts/new' });

    expect(await router.findByText('账户 · 新建账户')).toBeTruthy();
    expect(router.getByTestId('sidebar-sources').props.accessibilityState.selected).toBe(true);

    fireEvent.press(router.getByTestId('page-header-back'));
    await waitFor(() => expect(router.getPathname()).toBe('/accounts'));
  });
});
