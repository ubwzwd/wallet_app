/**
 * `/ledgers/join` (04 §4.3, decisions §14.29 / §14.35 / §14.52 B17): auto-submit on the
 * sixth digit, shake-and-hold on a rejected code (屏幕稿 13 · 失效 keeps the digits and turns
 * the cells red; 「重新输入」 clears), and a rate-limit countdown that retries the very same
 * code once without ever consuming it.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import { setAuthToken } from '@/api';
import { initI18n } from '@/i18n';
import { AuthProvider } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ToastHost, toast } from '@/ui';
import { makeLedger, makeUser, mockApi, mockGet, mockPost, type MockApi } from '@/test';

import JoinLedgerScreen from '../JoinLedgerScreen';

let queryClient: QueryClient;
let api: MockApi;

function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialPref="light">
        <AuthProvider queryClient={queryClient}>
          {children}
          <ToastHost />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const ROUTES = {
  index: () => <RNText>landing</RNText>,
  'ledgers/join': JoinLedgerScreen,
  'l/[ledgerId]/index': () => <RNText>ledger home</RNText>,
};

beforeEach(async () => {
  api = mockApi();
  await setAuthToken('test-token');
  toast.clear();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  await initI18n();
  await i18next.changeLanguage('zh');
  mockGet('/me', makeUser());
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
});

/** Paste the whole code into the first cell, the way a browser autofill would. */
async function pasteCode(code: string): Promise<void> {
  fireEvent.changeText(await screen.findByTestId('join-code-0'), code);
}

/** Type one digit per cell, the way a person does. */
async function typeDigits(digits: string): Promise<void> {
  await screen.findByTestId('join-code-0');
  for (const [index, digit] of [...digits].entries()) {
    fireEvent.changeText(screen.getByTestId(`join-code-${index}`), digit);
  }
}

function joinRequests(): string[] {
  return api.mock.history.post
    .filter((r) => (r.url ?? '').endsWith('/ledgers/join'))
    .map((r) => (JSON.parse(r.data as string) as { code: string }).code);
}

test('a pasted six-digit code is submitted exactly once and lands in the ledger', async () => {
  mockPost('/ledgers/join', makeLedger({ id: 'joined-1', name: '家庭账本' }));
  const router = renderRouter(ROUTES, { initialUrl: '/ledgers/join', wrapper: Wrapper });

  await pasteCode('123456');

  await waitFor(() => expect(router.getPathname()).toBe('/l/joined-1'));
  expect(joinRequests()).toEqual(['123456']);
  expect(await screen.findByTestId('toast-success')).toHaveTextContent('已加入《家庭账本》');
});

test('invite_expired shows its copy and keeps the refused digits in the red cells', async () => {
  mockPost('/ledgers/join', { detail: 'Invite expired', code: 'invite_expired' }, 400);
  renderRouter(ROUTES, { initialUrl: '/ledgers/join', wrapper: Wrapper });

  await pasteCode('123456');

  expect(await screen.findByTestId('join-error')).toHaveTextContent(
    '邀请码已过期（有效期 10 分钟），请让对方重新生成',
  );
  // 屏幕稿 13 · 失效: the six cells turn red *around the code that was refused*, so the
  // user can read back what they entered. Only 「重新输入」 empties them (see the test
  // below), and one keystroke over a cell clears the red without clearing the rest.
  await waitFor(() => expect(screen.getByTestId('join-restart')).toBeTruthy());
  expect(screen.getByTestId('join-code-0').props.value).toBe('1');
  expect(screen.getByTestId('join-code-5').props.value).toBe('6');
});

test('an incomplete code is never submitted', async () => {
  mockPost('/ledgers/join', makeLedger());
  renderRouter(ROUTES, { initialUrl: '/ledgers/join', wrapper: Wrapper });

  await typeDigits('12345');

  expect(joinRequests()).toEqual([]);
  expect(screen.getByTestId('join-code-4').props.value).toBe('5');
  expect(screen.getByTestId('join-code-5').props.value).toBe('');
});

test('a partial paste is treated as typing, not spread across the cells', async () => {
  mockPost('/ledgers/join', makeLedger());
  renderRouter(ROUTES, { initialUrl: '/ledgers/join', wrapper: Wrapper });

  // Three digits at once is not a code: only the last one lands, in the cell it was
  // dropped into, and nothing is submitted.
  fireEvent.changeText(await screen.findByTestId('join-code-0'), '123');

  expect(screen.getByTestId('join-code-0').props.value).toBe('3');
  expect(screen.getByTestId('join-code-1').props.value).toBe('');
  expect(joinRequests()).toEqual([]);
});

test('typing over a filled cell replaces that cell and keeps the ones after it', async () => {
  mockPost('/ledgers/join', { detail: 'Invite invalid', code: 'invite_invalid' }, 400);
  renderRouter(ROUTES, { initialUrl: '/ledgers/join', wrapper: Wrapper });

  await typeDigits('12345');

  // The cell is selected on focus, so the platform reports either '9' or '39' — both mean
  // "this cell now holds a 9", and '45' after it must survive either way.
  fireEvent.changeText(screen.getByTestId('join-code-2'), '39');

  expect(screen.getByTestId('join-code-2').props.value).toBe('9');
  expect(screen.getByTestId('join-code-3').props.value).toBe('4');
  expect(screen.getByTestId('join-code-4').props.value).toBe('5');
  expect(joinRequests()).toEqual([]);
});

test('429 counts down, keeps the code valid in the copy, then retries it once', async () => {
  jest.useFakeTimers();
  try {
    api.mock
      .onPost(/\/ledgers\/join$/)
      .replyOnce(429, { detail: 'Slow down', code: 'invite_rate_limited' }, { 'Retry-After': '2' });
    api.mock.onPost(/\/ledgers\/join$/).reply(200, makeLedger({ id: 'joined-2', name: '合租账本' }));

    const router = renderRouter(ROUTES, { initialUrl: '/ledgers/join', wrapper: Wrapper });
    await pasteCode('654321');

    await waitFor(() => expect(screen.getByTestId('join-countdown')).toBeTruthy());
    // Decision §14.35: the request never reached the code, so it is still usable.
    expect(screen.getByTestId('join-error')).toHaveTextContent(/你的邀请码仍然有效/);

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => expect(joinRequests()).toEqual(['654321', '654321']));
    await waitFor(() => expect(router.getPathname()).toBe('/l/joined-2'));
  } finally {
    jest.useRealTimers();
  }
});

test('the join button stays disabled until all six cells are filled', async () => {
  mockPost('/ledgers/join', makeLedger());
  renderRouter(ROUTES, { initialUrl: '/ledgers/join', wrapper: Wrapper });

  await typeDigits('12345');

  // Screen 13: the button is the visible half of "the code is complete"; five digits is
  // not a code, and nothing has been sent.
  expect(screen.getByTestId('join-submit').props.accessibilityState.disabled).toBe(true);
  expect(joinRequests()).toEqual([]);
});

test('a rejected code swaps the join button for a fresh start', async () => {
  mockPost('/ledgers/join', { detail: 'Invite invalid', code: 'invite_invalid' }, 400);
  renderRouter(ROUTES, { initialUrl: '/ledgers/join', wrapper: Wrapper });

  await pasteCode('123456');

  // The red state of screen 13: an explained failure, and one way on — "start over".
  expect(await screen.findByTestId('join-error')).toBeTruthy();
  const restart = await screen.findByTestId('join-restart');
  expect(screen.queryByTestId('join-submit')).toBeNull();

  fireEvent.press(restart);

  await waitFor(() => expect(screen.queryByTestId('join-error')).toBeNull());
  expect(screen.getByTestId('join-submit')).toBeTruthy();
  expect(screen.getByTestId('join-code-0').props.value).toBe('');
});
