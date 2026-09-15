/**
 * `/l/:ledgerId/settings` (04 §4.12, §8.3): what each role may do, the base-currency
 * warning, the one-shot invite code with its countdown and revoke, transferring
 * ownership, and the type-the-name delete.
 */
import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { Ledger, LedgerDetail, LedgerInvite, LedgerMember } from '@/api/types';
import { TopBarProvider, TopBarSurface } from '@/navigation';
import { LedgerProvider } from '@/store';
import {
  LEDGER_ID,
  USER_ID,
  apiUrl,
  makeLedger,
  makeUser,
  mockApi,
  mockDelete,
  mockGet,
  mockPatch,
  mockPost,
  renderWithProviders,
  type MockApi,
} from '@/test';
import { toast } from '@/ui';

import LedgerSettingsScreen from '../LedgerSettingsScreen';

const mockRouter = { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/l/8f0f7b2e-1111-4222-8333-444455556666/settings',
  useGlobalSearchParams: () => ({ ledgerId: '8f0f7b2e-1111-4222-8333-444455556666' }),
  useSegments: () => ['l', '[ledgerId]', 'settings'],
}));

const OTHER_ID = '11112222-3333-4444-8555-666677778888';

function makeDetail(over: Partial<LedgerDetail> = {}): LedgerDetail {
  return {
    ...makeLedger(),
    counts: { transactions: 328, sources: 4, import_batches: 12 },
    ...over,
  };
}

function makeMember(over: Partial<LedgerMember> = {}): LedgerMember {
  return {
    user_id: USER_ID,
    email: 'alice@example.com',
    display_name: 'Alice',
    role: 'owner',
    joined_at: '2026-02-01T09:00:00.000000Z',
    is_me: true,
    ...over,
  };
}

const BOB = makeMember({
  user_id: OTHER_ID,
  email: 'bob@example.com',
  display_name: null,
  role: 'member',
  is_me: false,
});

function makeInvite(over: Partial<LedgerInvite> = {}): LedgerInvite {
  return {
    id: '99998888-7777-4666-8555-444433332222',
    code: '472903',
    ledger_id: LEDGER_ID,
    ledger_name: '家庭账本',
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    created_at: new Date().toISOString(),
    ...over,
  };
}

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  toast.clear();
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockGet('/rates/currencies', { currencies: { CNY: 'Chinese Yuan', SGD: 'Singapore Dollar' } });
});

afterEach(() => {
  api.restore();
  toast.clear();
  jest.useRealTimers();
});

async function renderSettings(
  role: Ledger['role'],
  members: LedgerMember[],
  detail: LedgerDetail = makeDetail(),
): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  mockGet(`/ledgers/${LEDGER_ID}`, detail);
  mockGet(`/ledgers/${LEDGER_ID}/members`, { items: members, total: members.length });
  const ledgers = [makeLedger({ role })];
  return renderWithProviders(
    <LedgerProvider ledgerId={LEDGER_ID} ledgers={ledgers}>
      <LedgerSettingsScreen />
    </LedgerProvider>,
    { auth: { status: 'authenticated', user: makeUser() } },
  );
}

test('a member sees the permission block but none of the owner-only actions', async () => {
  await renderSettings('member', [makeMember({ role: 'member' }), { ...BOB, role: 'owner' }]);

  const hint = await screen.findByTestId('permission-hint');
  expect(hint).toHaveTextContent(/导入/);
  expect(hint).toHaveTextContent(/撤销导入/);
  expect(hint).toHaveTextContent(/管理账户/);

  expect(screen.queryByTestId('invite-card')).toBeNull();
  expect(screen.queryByTestId('invite-generate')).toBeNull();
  expect(screen.queryByTestId('transfer-ownership')).toBeNull();
  expect(screen.queryByTestId('delete-ledger')).toBeNull();
  expect(screen.queryByTestId('ledger-rename')).toBeNull();
  expect(screen.queryByTestId('ledger-base-currency-change')).toBeNull();
  expect(screen.queryByTestId(`member-remove-${OTHER_ID}`)).toBeNull();
  // The one thing a member can do here.
  expect(screen.getByTestId('leave-ledger').props.accessibilityState?.disabled).toBeFalsy();
  expect(screen.getByTestId('ledger-name')).toHaveTextContent(/家庭账本/);
});

test('an owner cannot leave before handing the ledger over', async () => {
  await renderSettings('owner', [makeMember(), BOB]);

  await screen.findByTestId('members-section');
  expect(screen.getByTestId('leave-ledger').props.accessibilityState?.disabled).toBe(true);
  expect(screen.getByTestId('leave-ledger')).toHaveTextContent(/需先转让才能退出/);
});

test('changing the base currency warns with the transaction count, then PATCHes', async () => {
  await renderSettings('owner', [makeMember(), BOB]);
  mockPatch(`/ledgers/${LEDGER_ID}`, makeLedger({ base_currency: 'SGD' }));

  fireEvent.press(await screen.findByTestId('ledger-base-currency-change'));
  fireEvent.press(await screen.findByTestId('ledger-base-currency-picker-trigger'));
  fireEvent.press(await screen.findByTestId('ledger-base-currency-picker-option-SGD'));

  // 屏幕稿 12: the warning is the panel itself, not a modal — it states the count and the
  // rule, and nothing is sent until 「仍要改成 SGD」 is pressed.
  const warning = await screen.findByTestId('ledger-currency-warning');
  expect(warning).toHaveTextContent(/328\ 笔交易/);
  expect(warning).toHaveTextContent(/各自发生日的汇率/);
  expect(api.mock.history.patch).toHaveLength(0);

  fireEvent.press(screen.getByTestId('ledger-currency-confirm'));

  await waitFor(() => expect(api.mock.history.patch).toHaveLength(1));
  expect(JSON.parse(api.mock.history.patch[0].data as string)).toEqual({
    base_currency: 'SGD',
    updated_at: '2026-09-01T12:00:00.000000Z',
  });
});

test('the invite code counts down and goes stale when it hits zero', async () => {
  // Installed before the render, so the card's one-second interval is a fake one.
  jest.useFakeTimers();
  await renderSettings('owner', [makeMember(), BOB]);
  mockPost(`/ledgers/${LEDGER_ID}/invites`, makeInvite());

  fireEvent.press(await screen.findByTestId('invite-generate'));
  expect(await screen.findByTestId('invite-code')).toHaveTextContent(/472903/);
  expect(screen.getByTestId('invite-countdown')).toHaveTextContent(/09:59/);

  act(() => {
    jest.advanceTimersByTime(60_000);
  });
  expect(screen.getByTestId('invite-countdown')).toHaveTextContent(/08:59/);

  act(() => {
    jest.advanceTimersByTime(9 * 60_000);
  });
  expect(screen.queryByTestId('invite-countdown')).toBeNull();
  expect(screen.getByTestId('invite-expired')).toHaveTextContent(/已经过期/);
  expect(screen.queryByTestId('invite-copy')).toBeNull();
});

test('revoking calls DELETE /invites/{code} and the code card disappears', async () => {
  await renderSettings('owner', [makeMember(), BOB]);
  mockPost(`/ledgers/${LEDGER_ID}/invites`, makeInvite());
  mockDelete(`/ledgers/${LEDGER_ID}/invites/472903`, undefined, 204);

  fireEvent.press(await screen.findByTestId('invite-generate'));
  await screen.findByTestId('invite-code');

  fireEvent.press(screen.getByTestId('invite-revoke'));
  fireEvent.press(await screen.findByTestId('confirm-accept'));

  await waitFor(() => expect(screen.queryByTestId('invite-code')).toBeNull());
  expect(api.mock.history.delete.map((r) => r.url)).toEqual([
    expect.stringContaining(`/ledgers/${LEDGER_ID}/invites/472903`),
  ]);
  expect(screen.getByTestId('invite-generate')).toBeTruthy();
});

test('a newcomer while a code is out turns the card into "used by"', async () => {
  const { queryClient } = await renderSettings('owner', [makeMember()]);
  mockPost(`/ledgers/${LEDGER_ID}/invites`, makeInvite());

  fireEvent.press(await screen.findByTestId('invite-generate'));
  await screen.findByTestId('invite-code');

  // The join deleted the code server-side; all we ever see is the extra member.
  const grown = [makeMember(), { ...BOB, display_name: '老王' }];
  mockGet(`/ledgers/${LEDGER_ID}/members`, { items: grown, total: grown.length });
  await act(async () => {
    await queryClient.invalidateQueries();
  });

  expect(await screen.findByTestId('invite-used-by')).toHaveTextContent(/已被\ 老王\ 使用/);
  expect(screen.queryByTestId('invite-code')).toBeNull();
});

test('transferring ownership downgrades the page to a member view', async () => {
  await renderSettings('owner', [makeMember(), BOB]);
  const swapped = [
    makeMember({ role: 'member' }),
    { ...BOB, role: 'owner' as const, display_name: '老王' },
  ];
  mockPost(`/ledgers/${LEDGER_ID}/transfer-ownership`, { items: swapped, total: 2 });

  // The first list has landed (the picker only exists once it has), so swapping the
  // handler now only affects the refetch the transfer itself triggers.
  fireEvent.press(await screen.findByTestId('transfer-ownership'));
  const trigger = await screen.findByTestId('transfer-target-trigger');
  mockGet(`/ledgers/${LEDGER_ID}/members`, { items: swapped, total: 2 });

  fireEvent.press(trigger);
  fireEvent.press(await screen.findByTestId(`transfer-target-option-${OTHER_ID}`));
  fireEvent.press(screen.getByTestId('transfer-submit'));

  // Ownership is a two-step confirmation (04 §4.12).
  fireEvent.press(await screen.findByTestId('confirm-accept'));
  fireEvent.press(screen.getByTestId('confirm-accept'));

  await waitFor(() => expect(screen.queryByTestId('delete-ledger')).toBeNull());
  expect(screen.queryByTestId('invite-card')).toBeNull();
  expect(screen.queryByTestId('transfer-ownership')).toBeNull();
  expect(JSON.parse(api.mock.history.post[0].data as string)).toEqual({ to_user_id: OTHER_ID });
});

test('removing a member asks first and keeps their entries', async () => {
  await renderSettings('owner', [makeMember(), BOB]);
  mockDelete(`/ledgers/${LEDGER_ID}/members/${OTHER_ID}`, undefined, 204);

  fireEvent.press(await screen.findByTestId(`member-remove-${OTHER_ID}`));
  expect(await screen.findByTestId('confirm-dialog')).toHaveTextContent(/他记的账会保留在账本里/);
  fireEvent.press(screen.getByTestId('confirm-accept'));

  await waitFor(() => expect(api.mock.history.delete).toHaveLength(1));
  expect(api.mock.history.delete[0].url).toContain(`/members/${OTHER_ID}`);
});

test('a member leaving lands back on the ledger list', async () => {
  await renderSettings('member', [makeMember({ role: 'member' }), { ...BOB, role: 'owner' }]);
  mockPost(`/ledgers/${LEDGER_ID}/leave`, undefined, 204);

  fireEvent.press(await screen.findByTestId('leave-ledger'));
  fireEvent.press(await screen.findByTestId('confirm-accept'));

  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/ledgers'));
});

test('deleting the ledger lists the three counts and needs the name typed out', async () => {
  await renderSettings('owner', [makeMember(), BOB]);
  mockDelete(`/ledgers/${LEDGER_ID}`, undefined, 204);

  fireEvent.press(await screen.findByTestId('delete-ledger'));
  const dialog = await screen.findByTestId('confirm-dialog');
  expect(dialog).toHaveTextContent(/删除「家庭账本」/);
  expect(dialog).toHaveTextContent(/328 笔交易/);
  expect(dialog).toHaveTextContent(/4 个账户/);
  expect(dialog).toHaveTextContent(/12 批导入/);

  const accept = screen.getByTestId('confirm-accept');
  expect(accept.props.accessibilityState?.disabled).toBe(true);

  fireEvent.changeText(screen.getByTestId('confirm-require-text'), '家庭账');
  expect(screen.getByTestId('confirm-accept').props.accessibilityState?.disabled).toBe(true);

  fireEvent.changeText(screen.getByTestId('confirm-require-text'), '家庭账本');
  fireEvent.press(screen.getByTestId('confirm-accept'));

  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/ledgers'));
  expect(api.mock.history.delete[0].url).toContain(`/ledgers/${LEDGER_ID}`);
});

test('renaming the ledger sends the name and the version it was read at', async () => {
  await renderSettings('owner', [makeMember(), BOB]);
  mockPatch(`/ledgers/${LEDGER_ID}`, makeLedger({ name: '家用' }));

  fireEvent.press(await screen.findByTestId('ledger-rename'));
  fireEvent.changeText(await screen.findByTestId('ledger-name-input'), '家用');
  fireEvent.press(screen.getByTestId('ledger-name-save'));

  await waitFor(() => expect(api.mock.history.patch).toHaveLength(1));
  expect(JSON.parse(api.mock.history.patch[0].data as string)).toEqual({
    name: '家用',
    updated_at: '2026-09-01T12:00:00.000000Z',
  });
});

test('a slow member list cannot swallow a freshly generated code', async () => {
  // The members request is held open, so the card has no baseline to compare against.
  let resolveMembers: () => void = () => undefined;
  const members = [makeMember()];
  mockGet(`/ledgers/${LEDGER_ID}`, makeDetail());
  api.mock.onGet(apiUrl(`/ledgers/${LEDGER_ID}/members`)).reply(
    () =>
      new Promise((resolve) => {
        resolveMembers = () => resolve([200, { items: members, total: members.length }]);
      }),
  );
  await renderWithProviders(
    <LedgerProvider ledgerId={LEDGER_ID} ledgers={[makeLedger({ role: 'owner' })]}>
      <LedgerSettingsScreen />
    </LedgerProvider>,
    { auth: { status: 'authenticated', user: makeUser() } },
  );

  // Generating is off the table until the baseline can be taken.
  const button = await screen.findByTestId('invite-generate');
  expect(button.props.accessibilityState?.disabled).toBe(true);
  fireEvent.press(button);
  expect(api.mock.history.post).toHaveLength(0);

  // The code itself lands after the list does: the list is the baseline, not a newcomer.
  mockPost(`/ledgers/${LEDGER_ID}/invites`, makeInvite());
  await act(async () => {
    resolveMembers();
  });
  await waitFor(() =>
    expect(screen.getByTestId('invite-generate').props.accessibilityState?.disabled).toBeFalsy(),
  );
  fireEvent.press(screen.getByTestId('invite-generate'));

  expect(await screen.findByTestId('invite-code')).toHaveTextContent(/472903/);
  expect(screen.queryByTestId('invite-used-by')).toBeNull();
});

test('a failed rename is visible even though the card renders no error of its own', async () => {
  // The card renders no inline server error, so the mutation must not be `silent`:
  // the failure has to reach the global error chain (04 §3.9).
  const { handlers } = await renderSettings('owner', [makeMember(), BOB]);
  mockPatch(`/ledgers/${LEDGER_ID}`, { code: 'internal_error', message: 'boom' }, 500);

  fireEvent.press(await screen.findByTestId('ledger-rename'));
  fireEvent.changeText(await screen.findByTestId('ledger-name-input'), '家用');
  fireEvent.press(screen.getByTestId('ledger-name-save'));

  await waitFor(() => expect(handlers.notify).toHaveBeenCalled());
  expect(handlers.notify.mock.calls[0]?.[0]).toBe('error');
});

// ----------------------------------------------------------- the title (04 §1.4)

test('the narrow layout publishes the title to the top bar and drops the page heading', async () => {
  mockGet(`/ledgers/${LEDGER_ID}`, makeDetail());
  mockGet(`/ledgers/${LEDGER_ID}/members`, { items: [makeMember()], total: 1 });
  await renderWithProviders(
    <LedgerProvider ledgerId={LEDGER_ID} ledgers={[makeLedger({ role: 'owner' })]}>
      <TopBarProvider>
        <TopBarSurface onPressLedger={() => {}} />
        <LedgerSettingsScreen />
      </TopBarProvider>
    </LedgerProvider>,
    { auth: { status: 'authenticated', user: makeUser() }, wide: false },
  );

  expect(await screen.findByTestId('top-bar-title')).toHaveTextContent('账本设置');
  // 屏幕稿 12 375: the page's own head is the ledger card, never a second 「账本设置」.
  expect(await screen.findByTestId('ledger-settings-header')).toHaveTextContent(/家庭账本/);
});

test('the wide layout has no top bar, so the page heads itself with the ledger', async () => {
  mockGet(`/ledgers/${LEDGER_ID}`, makeDetail());
  mockGet(`/ledgers/${LEDGER_ID}/members`, { items: [makeMember()], total: 1 });
  await renderWithProviders(
    <LedgerProvider ledgerId={LEDGER_ID} ledgers={[makeLedger({ role: 'owner' })]}>
      <LedgerSettingsScreen />
    </LedgerProvider>,
    { auth: { status: 'authenticated', user: makeUser() }, wide: true },
  );

  // 屏幕稿 12 1440: the name, then 「建于 … · 328 笔交易 · 基准币种 CNY」 under it.
  expect(await screen.findByTestId('ledger-name')).toHaveTextContent('家庭账本');
  expect(screen.getByTestId('ledger-header-meta')).toHaveTextContent(/328/);
  expect(screen.getByTestId('ledger-header-meta')).toHaveTextContent(/CNY/);
});
