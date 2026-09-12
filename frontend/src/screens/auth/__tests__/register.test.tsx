/**
 * `/register` behaviour (04 §4.2, decision §14.54): the `registration_open` gate replaces
 * the form rather than disabling it, the four fields validate as specified, and the
 * default currency follows the device language.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import { clearAuthToken } from '@/api';
import * as i18n from '@/i18n';
import { qk } from '@/queries';
import { AuthProvider } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ToastHost, toast } from '@/ui';
import { mockApi, mockGet, mockPost, type MockApi } from '@/test';

import RegisterScreen from '../RegisterScreen';

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
  login: () => <RNText>login page</RNText>,
  register: RegisterScreen,
};

function mockCurrencies(): void {
  mockGet('/rates/currencies', { currencies: { CNY: 'Chinese Yuan', USD: 'US Dollar' } });
}

beforeEach(async () => {
  api = mockApi();
  await clearAuthToken();
  toast.clear();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  await i18n.initI18n();
  await i18next.changeLanguage('zh');
  // Pin the device language so the currency default is deterministic; the test that
  // cares about the guess re-mocks it.
  jest.spyOn(i18n, 'deviceLanguage').mockReturnValue('zh-CN');
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  jest.restoreAllMocks();
});

test('registration_open=false renders the explanation card instead of any input', async () => {
  mockGet('/config', { registration_open: false });
  mockCurrencies();
  renderRouter(ROUTES, { initialUrl: '/register', wrapper: Wrapper });

  expect(await screen.findByTestId('register-closed-body')).toBeTruthy();
  expect(screen.queryByTestId('register-email')).toBeNull();
  expect(screen.queryByTestId('register-password')).toBeNull();
  expect(screen.queryByTestId('register-submit')).toBeNull();
  expect(screen.getByTestId('register-closed-login')).toBeTruthy();
});

test('registration_open=true renders the four fields of §14.54 and no display name', async () => {
  mockGet('/config', { registration_open: true });
  mockCurrencies();
  renderRouter(ROUTES, { initialUrl: '/register', wrapper: Wrapper });

  expect(await screen.findByTestId('register-email')).toBeTruthy();
  expect(screen.getByTestId('register-password')).toBeTruthy();
  expect(screen.getByTestId('register-confirm-password')).toBeTruthy();
  expect(screen.getByTestId('register-currency-trigger')).toBeTruthy();
  expect(screen.queryByText('显示名')).toBeNull();
});

test('the subtitle explains what registering creates, open or closed', async () => {
  const subtitle = '注册后会自动为你建一本『我的账本』，也可以用邀请码加入别人的';
  mockGet('/config', { registration_open: true });
  mockCurrencies();
  const open = renderRouter(ROUTES, { initialUrl: '/register', wrapper: Wrapper });
  expect(await screen.findByText(subtitle)).toBeTruthy();
  open.unmount();

  queryClient.clear();
  mockGet('/config', { registration_open: false });
  renderRouter(ROUTES, { initialUrl: '/register', wrapper: Wrapper });
  expect(await screen.findByTestId('register-closed-body')).toBeTruthy();
  expect(screen.getByText(subtitle)).toBeTruthy();
});

test('"go to sign in" carries the ?next= the user arrived with', async () => {
  mockGet('/config', { registration_open: true });
  mockCurrencies();
  const router = renderRouter(ROUTES, {
    initialUrl: '/register?next=%2Fl%2Fabc%2Ftransactions',
    wrapper: Wrapper,
  });

  fireEvent.press(await screen.findByTestId('register-login-link'));

  await waitFor(() => expect(router.getPathname()).toBe('/login'));
  expect(router.getSearchParams().next).toBe('/l/abc/transactions');
});

test('an unsafe ?next= is dropped on the way to sign in', async () => {
  mockGet('/config', { registration_open: true });
  mockCurrencies();
  const router = renderRouter(ROUTES, {
    initialUrl: '/register?next=%2F%2Fevil.example.com',
    wrapper: Wrapper,
  });

  fireEvent.press(await screen.findByTestId('register-login-link'));

  await waitFor(() => expect(router.getPathname()).toBe('/login'));
  expect(router.getSearchParams().next).toBeUndefined();
});

test('a short password and a mismatched confirmation report their own messages', async () => {
  mockGet('/config', { registration_open: true });
  mockCurrencies();
  renderRouter(ROUTES, { initialUrl: '/register', wrapper: Wrapper });

  fireEvent.changeText(await screen.findByTestId('register-email'), 'alice@example.com');
  fireEvent.changeText(screen.getByTestId('register-password'), 'short');
  fireEvent.changeText(screen.getByTestId('register-confirm-password'), 'different');
  fireEvent.press(screen.getByTestId('register-submit'));

  expect(await screen.findByText('密码至少 8 位')).toBeTruthy();
  expect(screen.getByText('两次输入的密码不一致')).toBeTruthy();
  expect(api.mock.history.post.length).toBe(0);
});

test('the default currency follows the device language', async () => {
  mockGet('/config', { registration_open: true });
  mockCurrencies();

  jest.spyOn(i18n, 'deviceLanguage').mockReturnValue('zh-Hans-CN');
  const zh = renderRouter(ROUTES, { initialUrl: '/register', wrapper: Wrapper });
  expect(await screen.findByText('CNY')).toBeTruthy();
  zh.unmount();

  jest.spyOn(i18n, 'deviceLanguage').mockReturnValue('en-SG');
  renderRouter(ROUTES, { initialUrl: '/register', wrapper: Wrapper });
  expect(await screen.findByText('USD')).toBeTruthy();
});

test('a 403 registration_closed swaps in the card and invalidates the config query', async () => {
  mockGet('/config', { registration_open: true });
  mockCurrencies();
  mockPost('/auth/register', { detail: 'Registration is closed', code: 'registration_closed' }, 403);
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  renderRouter(ROUTES, { initialUrl: '/register', wrapper: Wrapper });

  fireEvent.changeText(await screen.findByTestId('register-email'), 'alice@example.com');
  fireEvent.changeText(screen.getByTestId('register-password'), 'hunter2hunter2');
  fireEvent.changeText(screen.getByTestId('register-confirm-password'), 'hunter2hunter2');
  await waitFor(() => expect(screen.getByText('CNY')).toBeTruthy());
  fireEvent.press(screen.getByTestId('register-submit'));

  expect(await screen.findByTestId('register-closed-body')).toBeTruthy();
  expect(screen.queryByTestId('register-email')).toBeNull();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.global.config() });
});

test('a 409 email_exists reports under the email field and keeps the form', async () => {
  mockGet('/config', { registration_open: true });
  mockCurrencies();
  mockPost('/auth/register', { detail: 'Email already registered', code: 'email_exists' }, 409);
  renderRouter(ROUTES, { initialUrl: '/register', wrapper: Wrapper });

  fireEvent.changeText(await screen.findByTestId('register-email'), 'alice@example.com');
  fireEvent.changeText(screen.getByTestId('register-password'), 'hunter2hunter2');
  fireEvent.changeText(screen.getByTestId('register-confirm-password'), 'hunter2hunter2');
  await waitFor(() => expect(screen.getByText('CNY')).toBeTruthy());
  fireEvent.press(screen.getByTestId('register-submit'));

  const shown = await screen.findAllByText('这个邮箱已经注册过了');
  expect(shown.length).toBe(2);
  expect(screen.getByTestId('register-email').props.value).toBe('alice@example.com');
});
