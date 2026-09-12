/**
 * Authentication state (04 §2.1): a three-state machine — `bootstrapping` while the
 * stored token is being validated, then `anonymous` or `authenticated`.
 *
 * Three deliberate differences from the v2 implementation (04 §2.1):
 *  1. `login()` / `register()` never move the status back to `bootstrapping`; the
 *     submitting state belongs to the form's own mutation, so the form is not
 *     unmounted while it is showing an error.
 *  2. A 401 from any request reaches us through `setOnUnauthorized()` — the axios
 *     interceptor no longer touches storage itself.
 *  3. The profile lives at `GET /me`, not `/auth/me` (decision §14.42).
 *
 * The `QueryClient` arrives as a prop instead of through `useQueryClient()`, so this
 * module stays independent of `src/queries` and tests can hand in their own client.
 */
import React from 'react';
import type { QueryClient } from '@tanstack/react-query';

import {
  authApi,
  clearAuthToken,
  getAuthToken,
  meApi,
  setAuthToken,
  setOnUnauthorized,
  type LoginRequest,
  type RegisterRequest,
  type User,
} from '@/api';
import { applyLanguage } from '@/i18n';
import { PREF_NAMES, setPref } from '@/utils/prefs';

export type AuthStatus = 'bootstrapping' | 'anonymous' | 'authenticated';

export interface AuthContextValue {
  status: AuthStatus;
  /** Non-null exactly when `status === 'authenticated'`. */
  user: User | null;
  login(body: LoginRequest): Promise<void>;
  register(body: RegisterRequest): Promise<void>;
  logout(): Promise<void>;
  refreshUser(): Promise<void>;
  /** Write a freshly returned profile (e.g. after `PATCH /me`) without a round trip. */
  setUser(user: User | null): void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

/** Name of the service-worker runtime cache emptied on logout (04 §7.2). */
const API_CACHE_NAME = 'api-cache';

/** Drop the service worker's API cache on web; a no-op everywhere else. */
async function clearApiCache(): Promise<void> {
  const store = (globalThis as { caches?: { delete(key: string): Promise<boolean> } }).caches;
  if (!store) return;
  try {
    await store.delete(API_CACHE_NAME);
  } catch {
    /* a browser that refuses the CacheStorage API must not break logout */
  }
}

export interface AuthProviderProps {
  /** Cleared on logout and on a 401, so the next user never sees cached data. */
  queryClient: QueryClient;
  children: React.ReactNode;
}

export function AuthProvider({ queryClient, children }: AuthProviderProps): React.JSX.Element {
  const [status, setStatus] = React.useState<AuthStatus>('bootstrapping');
  const [user, setUserState] = React.useState<User | null>(null);

  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Fetch the profile and move to `authenticated`. The server-side language wins over
   * the locally stored one (04 §5.1), and is applied without persisting: the local
   * `lang` pref keeps meaning "what this device chose while signed out".
   */
  const loadProfile = React.useCallback(async (): Promise<void> => {
    const me = await meApi.get();
    if (!alive.current) return;
    setUserState(me);
    setStatus('authenticated');
    try {
      await applyLanguage(me.language ?? null, { persist: false });
    } catch {
      // A language switch that fails must never cost the user their session.
    }
  }, []);

  const goAnonymous = React.useCallback((): void => {
    setUserState(null);
    setStatus('anonymous');
  }, []);

  // ---- bootstrap -----------------------------------------------------------
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await getAuthToken();
      if (cancelled) return;
      if (!token) {
        goAnonymous();
        return;
      }
      try {
        await loadProfile();
      } catch {
        // Any failure — 401, 5xx or offline — lands on anonymous. See the note in
        // the task report: we prefer a login screen over a permanently stuck splash.
        if (cancelled) return;
        await clearAuthToken();
        if (cancelled) return;
        goAnonymous();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [goAnonymous, loadProfile]);

  // ---- 401 from any request (04 §2.1 item 2, §1.5 rule 5) ------------------
  React.useEffect(() => {
    setOnUnauthorized(() => {
      void clearAuthToken();
      goAnonymous();
      queryClient.clear();
    });
    return () => setOnUnauthorized(null);
  }, [goAnonymous, queryClient]);

  const finishSignIn = React.useCallback(
    async (token: string): Promise<void> => {
      await setAuthToken(token);
      try {
        await loadProfile();
      } catch (err) {
        await clearAuthToken();
        goAnonymous();
        throw err;
      }
    },
    [goAnonymous, loadProfile],
  );

  const login = React.useCallback(
    async (body: LoginRequest): Promise<void> => {
      // Note: no `setStatus('bootstrapping')` here — the form owns the pending state.
      const res = await authApi.login(body);
      await finishSignIn(res.access_token);
    },
    [finishSignIn],
  );

  const register = React.useCallback(
    async (body: RegisterRequest): Promise<void> => {
      const res = await authApi.register(body);
      await finishSignIn(res.access_token);
    },
    [finishSignIn],
  );

  const logout = React.useCallback(async (): Promise<void> => {
    await clearAuthToken();
    goAnonymous();
    queryClient.clear();
    await clearApiCache();
    await setPref(PREF_NAMES.lastLedgerId, null);
    // Navigating to /login is the caller's job (04 §1.5 rule 5).
  }, [goAnonymous, queryClient]);

  const refreshUser = React.useCallback(async (): Promise<void> => {
    await loadProfile();
  }, [loadProfile]);

  const setUser = React.useCallback((next: User | null): void => {
    setUserState(next);
    setStatus(next ? 'authenticated' : 'anonymous');
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({ status, user, login, register, logout, refreshUser, setUser }),
    [status, user, login, register, logout, refreshUser, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = React.useContext(AuthContext);
  if (!value) throw new Error('useAuth() must be used inside an <AuthProvider>');
  return value;
}
