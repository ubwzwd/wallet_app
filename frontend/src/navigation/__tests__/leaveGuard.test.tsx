/**
 * Decision §14.65 f / g on the real shell: the form pages draw no tab bar on a narrow
 * screen, and while a form has unsaved changes every exit the chrome offers asks first —
 * staying keeps the page and what was typed, leaving is asked exactly once.
 *
 * The pages are probes (the real forms are covered in `screens/transactions/form` and in
 * `app-flow.test.tsx`); what is under test is the chrome around them: `AppShell`, the
 * sidebar, the ledger card and its switcher, the tab bar and its sheets, the ‹ bar and the
 * wide breadcrumb.
 */
import React from 'react';
import { Text, TextInput } from 'react-native';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
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

import { useBottomTabInset } from '../AppShell';
import { resetLedgerHistory } from '../ledgerHistory';
import { resetLedgerGone } from '../RequireLedger';
import { useTopBar } from '../TopBar';
import { useBack } from '../useBack';

const LEDGER_A = 'ledger-a';
const LEDGER_B = 'ledger-b';
const L = `/l/${LEDGER_A}`;
const TYPED = '38';

/** A page: its title, the wide breadcrumb the real pages draw, and the published inset. */
function Probe({ name }: { name: string }): React.JSX.Element {
  useTopBar(name);
  const back = useBack();
  return (
    <>
      <Text>{name}</Text>
      <Text testID="probe-inset">{String(useBottomTabInset())}</Text>
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

/** A page with a form on it, guarded the way the real forms are: dirty once typed in. */
function formPage(name: string) {
  return function FormPage(): React.JSX.Element {
    const [value, setValue] = React.useState('');
    useLeaveGuard(value !== '');
    return (
      <>
        <Probe name={name} />
        <TextInput testID="probe-input" value={value} onChangeText={setValue} />
      </>
    );
  };
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
  '(app)/accounts/new': formPage('新建账户'),
  '(app)/accounts/[sourceId]/edit': formPage('编辑账户'),
  '(app)/l/[ledgerId]/_layout': LedgerLayout,
  '(app)/l/[ledgerId]/index': page('首页'),
  '(app)/l/[ledgerId]/transactions/index': page('交易'),
  '(app)/l/[ledgerId]/transactions/new': formPage('记一笔'),
  '(app)/l/[ledgerId]/transactions/[txId]/index': page('交易详情'),
  '(app)/l/[ledgerId]/transactions/[txId]/edit': formPage('编辑'),
  '(app)/l/[ledgerId]/transfers/[pairId]/index': page('转账详情'),
  '(app)/l/[ledgerId]/transfers/[pairId]/edit': formPage('编辑转账'),
  '(app)/l/[ledgerId]/imports/index': page('导入'),
  // Not a form route, but a page that can hold unsaved changes and keeps the tab bar.
  '(app)/l/[ledgerId]/settings': formPage('账本设置'),
};

type Router = ReturnType<typeof renderRouter>;

let api: MockApi;
let widthSpy: jest.SpyInstance;

function setWide(wide: boolean): void {
  widthSpy = jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(wide);
}

beforeEach(async () => {
  api = mockApi();
  queryClient.clear();
  resetLedgerGone();
  resetLedgerHistory();
  await initI18n();
  await i18next.changeLanguage('zh');
  await setPref(PREF_NAMES.lastLedgerId, LEDGER_A);
  await setAuthToken('test-access-token');
  mockGet('/me', makeUser({ display_name: '阿狸' }));
  mockGet('/ledgers', {
    items: [
      makeLedger({ id: LEDGER_A, name: '家庭账本', role: 'owner' }),
      makeLedger({ id: LEDGER_B, name: '旅行账本', role: 'member' }),
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

/** Open `url` and type into its form, so it has something to lose. */
async function openDirty(url: string): Promise<Router> {
  const router = renderRouter(ROUTES, { initialUrl: url });
  fireEvent.changeText(await router.findByTestId('probe-input'), TYPED);
  return router;
}

/**
 * The whole contract for one exit: it asks; "stay" keeps the page and the typed value;
 * "leave" goes to `to` without asking a second time.
 */
async function expectGuardedExit(
  router: Router,
  exit: () => Promise<void>,
  to: string | RegExp,
): Promise<void> {
  const from = router.getPathname();

  await exit();
  expect(await router.findByTestId('confirm-dialog')).toBeTruthy();
  await act(async () => {
    fireEvent.press(router.getByTestId('confirm-cancel'));
  });
  await waitFor(() => expect(router.queryByTestId('confirm-dialog')).toBeNull());
  expect(router.getPathname()).toBe(from);
  expect(router.getByTestId('probe-input').props.value).toBe(TYPED);

  await exit();
  await act(async () => {
    fireEvent.press(await router.findByTestId('confirm-accept'));
  });
  await waitFor(() => expect(router.getPathname()).toMatch(to));
  // Asked once: a second question would have stopped the navigation above, and nothing
  // is left open behind it.
  expect(router.queryByTestId('confirm-dialog')).toBeNull();
}

const exact = (path: string): RegExp => new RegExp(`^${path}$`);

describe('narrow (<1024)', () => {
  beforeEach(() => setWide(false));

  test.each([
    ['记一笔', `${L}/transactions/new?kind=income`],
    ['编辑', `${L}/transactions/tx-1/edit`],
    ['编辑转账', `${L}/transfers/pair-1/edit`],
    ['新建账户', '/accounts/new'],
    ['编辑账户', '/accounts/src-1/edit'],
  ])('%s: the ‹ bar but no tab bar, and no inset for it (§14.65 f)', async (title, url) => {
    const router = renderRouter(ROUTES, { initialUrl: url });

    await waitFor(() => expect(router.getByTestId('top-bar-title')).toHaveTextContent(title));
    expect(router.getByTestId('top-bar-back')).toBeTruthy();
    expect(router.queryByTestId('bottom-tab-bar')).toBeNull();
    expect(router.getByTestId('probe-inset')).toHaveTextContent('0');
  });

  test('a detail page keeps its tab bar', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `${L}/transactions/tx-1` });

    expect(await router.findByTestId('bottom-tab-bar')).toBeTruthy();
    await waitFor(() => expect(router.getByTestId('probe-inset')).not.toHaveTextContent('0'));
  });

  test('a dirty 记一笔: the top bar’s ‹ asks', async () => {
    const router = await openDirty(`${L}/transactions/new`);

    await expectGuardedExit(
      router,
      async () => fireEvent.press(router.getByTestId('top-bar-back')),
      exact(`${L}/transactions`),
    );
  });

  test('a dirty page: 「我的」 → 个人设置 asks', async () => {
    const router = await openDirty(`${L}/settings`);

    await expectGuardedExit(
      router,
      async () => {
        fireEvent.press(router.getByTestId('tab-me'));
        fireEvent.press(await router.findByTestId('me-sheet-settings'));
      },
      exact('/settings'),
    );
  });

  test('a dirty page: a tab asks', async () => {
    const router = await openDirty(`${L}/settings`);

    await expectGuardedExit(
      router,
      async () => fireEvent.press(router.getByTestId('tab-transactions')),
      exact(`${L}/transactions`),
    );
  });

  test('a dirty page: a kind from the long-pressed ＋ asks', async () => {
    const router = await openDirty(`${L}/settings`);

    await expectGuardedExit(
      router,
      async () => {
        fireEvent(router.getByTestId('tab-add'), 'longPress');
        fireEvent.press(await router.findByTestId('kind-sheet-income'));
      },
      exact(`${L}/transactions/new`),
    );
    expect(router.getSearchParams().kind).toBe('income');
  });

  test('a clean form leaves at once, without a question', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `${L}/transactions/new` });

    fireEvent.press(await router.findByTestId('top-bar-back'));
    await waitFor(() => expect(router.getPathname()).toBe(`${L}/transactions`));
    expect(router.queryByTestId('confirm-dialog')).toBeNull();
  });
});

describe('wide (>=1024)', () => {
  beforeEach(() => setWide(true));

  test('the column is untouched on a form page', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `${L}/transactions/new` });

    expect(await router.findByTestId('sidebar')).toBeTruthy();
    expect(router.getByTestId('sidebar-add')).toBeTruthy();
  });

  test('a dirty 记一笔: the sidebar’s 首页 asks', async () => {
    const router = await openDirty(`${L}/transactions/new`);

    await expectGuardedExit(
      router,
      async () => fireEvent.press(router.getByTestId('sidebar-home')),
      exact(L),
    );
  });

  test('a dirty 记一笔: the ledger card’s arrow asks', async () => {
    const router = await openDirty(`${L}/transactions/new`);

    await expectGuardedExit(
      router,
      async () => fireEvent.press(await router.findByTestId('sidebar-ledger-settings')),
      exact(`${L}/settings`),
    );
  });

  test('a dirty 记一笔: picking another ledger in the switcher asks', async () => {
    const router = await openDirty(`${L}/transactions/new`);

    await expectGuardedExit(
      router,
      async () => {
        fireEvent.press(await router.findByTestId('sidebar-ledger'));
        fireEvent.press(await router.findByTestId(`ledger-switcher-row-${LEDGER_B}`));
      },
      new RegExp(`^/l/${LEDGER_B}`),
    );
  });

  test('a dirty 记一笔: the switcher’s 新建账本 asks', async () => {
    const router = await openDirty(`${L}/transactions/new`);

    await expectGuardedExit(
      router,
      async () => {
        fireEvent.press(await router.findByTestId('sidebar-ledger'));
        fireEvent.press(await router.findByTestId('ledger-switcher-new'));
      },
      exact('/ledgers/new'),
    );
  });

  test('a dirty edit: 「＋ 记一笔」 and the member row ask', async () => {
    let router = await openDirty(`${L}/transactions/tx-1/edit`);
    await expectGuardedExit(
      router,
      async () => fireEvent.press(router.getByTestId('sidebar-add')),
      exact(`${L}/transactions/new`),
    );
    router.unmount();

    router = await openDirty(`${L}/transactions/tx-1/edit`);
    await expectGuardedExit(
      router,
      async () => fireEvent.press(router.getByTestId('sidebar-user')),
      exact('/settings'),
    );
  });

  test('a dirty 记一笔: the breadcrumb asks once', async () => {
    const router = await openDirty(`${L}/transactions/new`);

    await expectGuardedExit(
      router,
      async () => fireEvent.press(router.getByTestId('page-header-back')),
      exact(`${L}/transactions`),
    );
  });

  test('a clean page changes page at once', async () => {
    const router = renderRouter(ROUTES, { initialUrl: `${L}/transactions/new` });

    fireEvent.press(await router.findByTestId('sidebar-imports'));
    await waitFor(() => expect(router.getPathname()).toBe(`${L}/imports`));
    expect(router.queryByTestId('confirm-dialog')).toBeNull();
  });
});
