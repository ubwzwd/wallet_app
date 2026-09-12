/**
 * `renderWithProviders` — the single entry point every screen test uses (04 §8.3).
 *
 * It mounts the same provider stack the app does (QueryClient → Theme → i18n → Auth →
 * Toast/Confirm hosts), so a test only has to describe the *server* (via `mockApi()`)
 * and the starting session.
 *
 * It is async because two things must settle before assertions run: i18next's init and
 * the auth bootstrap. Pass `auth` to start signed in or signed out; the helper seeds the
 * token and a `GET /me` reply, then waits for the requested status.
 */
import React from 'react';
import * as RN from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor, type RenderResult } from '@testing-library/react-native';
import i18next from 'i18next';

import { clearAuthToken, setAuthToken, type User } from '@/api';
import { initI18n, type Lang } from '@/i18n';
import { ThemeProvider } from '@/theme/ThemeProvider';
import * as breakpoint from '@/theme/useBreakpoint';
import { AuthProvider, useAuth, type AuthStatus } from '@/store/AuthContext';
import { ConfirmHost, ToastHost } from '@/ui';

import { makeUser } from './fixtures';
import { mockGet } from './mockApi';

/** Token handed to the client when a test asks for an authenticated session. */
export const TEST_TOKEN = 'test-access-token';

/** Widths on either side of `breakpoint.md` (1024). */
const NARROW_WINDOW = { width: 390, height: 844, scale: 2, fontScale: 1 };
const WIDE_WINDOW = { width: 1280, height: 900, scale: 2, fontScale: 1 };

export type AuthSeed =
  | 'anonymous'
  | 'authenticated'
  | { status: AuthStatus; user?: User | null };

export interface RenderWithProvidersOptions {
  /** Reuse a client (e.g. to assert on its cache); a throw-away one is made otherwise. */
  queryClient?: QueryClient;
  /** Starting session. Omit to let the provider bootstrap from whatever storage holds. */
  auth?: AuthSeed;
  lang?: Lang;
  theme?: 'light' | 'dark';
  /** `true` renders at a ≥1024px window, so wide-layout branches are taken. */
  wide?: boolean;
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient;
}

/** The defaults every test wants: no retries, no cache carried between tests. */
export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

// The probe below mirrors the live auth status out of the tree so `waitForAuth` can
// observe it without the caller having to render anything.
let currentStatus: AuthStatus | null = null;

function AuthProbe(): null {
  const { status } = useAuth();
  currentStatus = status;
  return null;
}

/** The auth status of the most recent `renderWithProviders` tree. */
export function authStatus(): AuthStatus | null {
  return currentStatus;
}

/** Wait until the mounted `AuthProvider` reaches `status`. */
export async function waitForAuth(status: AuthStatus): Promise<void> {
  await waitFor(() => {
    if (currentStatus !== status) {
      throw new Error(`auth status is ${String(currentStatus)}, expected ${status}`);
    }
  });
}

function seedStatus(seed: AuthSeed): AuthStatus {
  return typeof seed === 'string' ? seed : seed.status;
}

function seedUser(seed: AuthSeed): User {
  if (typeof seed === 'string') return makeUser();
  return seed.user ?? makeUser();
}

/**
 * Put the client and the mock server into the state the requested session implies.
 * `bootstrapping` is left alone: a test asking for it wants to control the timing.
 */
async function applyAuthSeed(seed: AuthSeed): Promise<void> {
  const status = seedStatus(seed);
  if (status === 'authenticated') {
    await setAuthToken(TEST_TOKEN);
    // Registered last, so a handler the test installed itself still wins.
    mockGet('/me', seedUser(seed));
  } else if (status === 'anonymous') {
    await clearAuthToken();
  }
}

const spies: jest.SpyInstance[] = [];

/**
 * Force the layout branch the test asked for.
 *
 * Two spies, because `expo`'s babel preset rewrites `import { useWindowDimensions }
 * from 'react-native'` to the react-native-web submodule: a spy on the `react-native`
 * facade is therefore invisible to `useIsWide()`. So `useIsWide` is mocked directly
 * (that is what the layout actually branches on) and the facade is mocked too, for any
 * component that reads the window size itself.
 */
function mockWindowWidth(wide: boolean): void {
  restoreWindowDimensions();
  spies.push(jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(wide));
  try {
    spies.push(
      jest.spyOn(RN, 'useWindowDimensions').mockReturnValue(wide ? WIDE_WINDOW : NARROW_WINDOW),
    );
  } catch {
    /* the facade is not always spy-able; `useIsWide` above is the one that matters */
  }
}

/** Undo the layout mocks. Safe to call when nothing was mocked. */
export function restoreWindowDimensions(): void {
  while (spies.length > 0) spies.pop()?.mockRestore();
}

export async function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {},
): Promise<RenderWithProvidersResult> {
  const { auth, lang = 'zh', theme = 'light', wide } = options;
  const queryClient = options.queryClient ?? makeTestQueryClient();

  if (wide !== undefined) mockWindowWidth(wide);

  await initI18n();
  await i18next.changeLanguage(lang);

  currentStatus = null;
  if (auth) await applyAuthSeed(auth);

  const confirmLabels = {
    confirm: i18next.t('common:button.confirm'),
    cancel: i18next.t('common:button.cancel'),
    confirmAgain: i18next.t('common:button.confirm'),
  };

  const result = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialPref={theme}>
        <AuthProvider queryClient={queryClient}>
          <AuthProbe />
          {ui}
          <ToastHost />
          <ConfirmHost labels={confirmLabels} />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );

  if (auth) {
    const target = seedStatus(auth);
    if (target !== 'bootstrapping') await waitForAuth(target);
  }

  return Object.assign(result, { queryClient });
}
