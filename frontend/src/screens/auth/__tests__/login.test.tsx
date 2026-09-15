/**
 * `/login` behaviour (04 §4.1, §8.3): the failure path must not cost the user what they
 * typed, and the success path must honour `?next=` only when `safeNext` accepts it.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import { clearAuthToken } from '@/api';
import { initI18n } from '@/i18n';
import { AuthProvider } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ToastHost, toast } from '@/ui';
import { makeUser, mockApi, mockGet, mockPost, type MockApi } from '@/test';

import LoginScreen from '../LoginScreen';

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
  login: LoginScreen,
  register: () => <RNText>register page</RNText>,
  'l/[ledgerId]/transactions/index': () => <RNText>transactions page</RNText>,
};

beforeEach(async () => {
  api = mockApi();
  await clearAuthToken();
  toast.clear();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  await initI18n();
  await i18next.changeLanguage('zh');
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
});

async function fillAndSubmit(email = 'alice@example.com', password = 'hunter2'): Promise<void> {
  fireEvent.changeText(await screen.findByTestId('login-email'), email);
  fireEvent.changeText(screen.getByTestId('login-password'), password);
  fireEvent.press(screen.getByTestId('login-submit'));
}

test('401 invalid_credentials shows under the password field, toasts, and keeps the form', async () => {
  mockPost('/auth/login', { detail: 'Incorrect email or password', code: 'invalid_credentials' }, 401);
  renderRouter(ROUTES, { initialUrl: '/login', wrapper: Wrapper });

  await fillAndSubmit();

  // Once under the password field, once in the toast (04 §4.1).
  const shown = await screen.findAllByText('邮箱或密码不正确');
  expect(shown.length).toBe(2);
  expect(await screen.findByTestId('toast-error')).toBeTruthy();
  // 04 §4.1: the form is not cleared — usually only the password was mistyped.
  expect(screen.getByTestId('login-email').props.value).toBe('alice@example.com');
  expect(screen.getByTestId('login-password').props.value).toBe('hunter2');
});

test('editing a field clears the message the server put under the password', async () => {
  mockPost('/auth/login', { detail: 'Incorrect email or password', code: 'invalid_credentials' }, 401);
  renderRouter(ROUTES, { initialUrl: '/login', wrapper: Wrapper });

  await fillAndSubmit();
  expect((await screen.findAllByText('邮箱或密码不正确')).length).toBe(2);

  // The verdict was about what was submitted; a changed password makes it obsolete.
  fireEvent.changeText(screen.getByTestId('login-password'), 'hunter3');

  await waitFor(() => expect(screen.queryAllByText('邮箱或密码不正确')).toHaveLength(1));
  // The one left is the toast, which the user dismisses themselves (04 §3.9).
  expect(screen.getByTestId('toast-error')).toBeTruthy();
});

test('a legal ?next= is where a successful sign-in lands', async () => {
  mockPost('/auth/login', { access_token: 'tok', token_type: 'bearer' });
  mockGet('/me', makeUser());
  const router = renderRouter(ROUTES, {
    initialUrl: '/login?next=%2Fl%2Fabc%2Ftransactions',
    wrapper: Wrapper,
  });

  await fillAndSubmit();

  await waitFor(() => expect(router.getPathname()).toBe('/l/abc/transactions'));
});

test('a protocol-relative ?next= is rejected and sign-in lands on /', async () => {
  mockPost('/auth/login', { access_token: 'tok', token_type: 'bearer' });
  mockGet('/me', makeUser());
  const router = renderRouter(ROUTES, {
    initialUrl: '/login?next=%2F%2Fevil.example.com',
    wrapper: Wrapper,
  });

  await fillAndSubmit();

  await waitFor(() => expect(router.getPathname()).toBe('/'));
  expect(screen.getByText('landing')).toBeTruthy();
});

test('429 login_rate_limited arms a Retry-After countdown and disables the button', async () => {
  mockPost(
    '/auth/login',
    { detail: 'Too many attempts', code: 'login_rate_limited' },
    429,
    { 'Retry-After': '30' },
  );
  renderRouter(ROUTES, { initialUrl: '/login', wrapper: Wrapper });

  await fillAndSubmit();

  expect(await screen.findByTestId('login-countdown')).toHaveTextContent('00:30');
  expect(screen.getByTestId('login-submit').props.accessibilityState.disabled).toBe(true);
});

test('a malformed email never reaches the network', async () => {
  mockPost('/auth/login', { access_token: 'tok', token_type: 'bearer' });
  mockGet('/me', makeUser());
  renderRouter(ROUTES, { initialUrl: '/login', wrapper: Wrapper });

  await fillAndSubmit('not-an-email', 'hunter2');

  expect(await screen.findByText('邮箱格式不对')).toBeTruthy();
  expect(api.mock.history.post.length).toBe(0);
});

test('the link under the card goes to register, carrying a legal ?next=', async () => {
  const router = renderRouter(ROUTES, {
    initialUrl: '/login?next=%2Fl%2Fabc%2Ftransactions',
    wrapper: Wrapper,
  });

  fireEvent.press(await screen.findByTestId('login-register-link'));

  await waitFor(() => expect(router.getPathname()).toBe('/register'));
  expect(router.getSearchParams().next).toBe('/l/abc/transactions');
});
