/**
 * `/ledgers/join` (04 §4.3, decisions §14.29 / §14.35 / §14.52 B17): auto-submit on the
 * sixth digit, shake-and-clear on a rejected code, and a rate-limit countdown that retries
 * the very same code once without ever consuming it.
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

test('invite_expired shows its copy and clears the cells', async () => {
  mockPost('/ledgers/join', { detail: 'Invite expired', code: 'invite_expired' }, 400);
  renderRouter(ROUTES, { initialUrl: '/ledgers/join', wrapper: Wrapper });

  await pasteCode('123456');

  expect(await screen.findByTestId('join-error')).toHaveTextContent(
    '邀请码已过期（有效期 10 分钟），请让对方重新生成',
  );
  await waitFor(() => expect(screen.getByTestId('join-code-0').props.value).toBe(''));
  expect(screen.getByTestId('join-code-5').props.value).toBe('');
});

test('an incomplete code is never submitted', async () => {
  mockPost('/ledgers/join', makeLedger());
  renderRouter(ROUTES, { initialUrl: '/ledgers/join', wrapper: Wrapper });

  await pasteCode('12345');

  expect(joinRequests()).toEqual([]);
  expect(screen.getByTestId('join-code-4').props.value).toBe('5');
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
