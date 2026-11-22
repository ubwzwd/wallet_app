/**
 * Authentication state (04 §2.1): a three-state machine — `bootstrapping` while the
 * stored token is being validated, then `anonymous` or `authenticated`.
 *
 * Three deliberate differences from the v2 implementation (04 §2.1):
 *  1. `login()` / `register()` never move the status back to `bootstrapping`; the
 *     submitting state belongs to the form's own mutation, so the form is not
 *     unmounted while it is showing an error.
 *  2. A 401 the axios interceptor could not cure with a refresh (decision §14.67)
 *     reaches us through `setOnUnauthorized()`; clearing the tokens then is our job.
 *  3. The profile lives at `GET /me`, not `/auth/me` (decision §14.42).
 *
 * The `QueryClient` arrives as a prop instead of through `useQueryClient()`, so this
 * module stays independent of `src/queries` and tests can hand in their own client.
 */
import React from 'react';
import type { QueryClient } from '@tanstack/react-query';

import {
  ApiClientError,
  authApi,
  clearAuthToken,
  getAuthToken,
  getRefreshToken,
  meApi,
  setAuthTokens,
  setOnUnauthorized,
  type AuthResponse,
  type LoginRequest,
  type RegisterRequest,
  type User,
} from '@/api';
import { applyLanguage } from '@/i18n';
import { PREF_NAMES, setPref, setSessionPref } from '@/utils/prefs';

import { resetLedgerUnavailable } from './ledgerUnavailable';

export type AuthStatus = 'bootstrapping' | 'anonymous' | 'authenticated';

export interface AuthContextValue {
  status: AuthStatus;
  /** Non-null exactly when `status === 'authenticated'`. */
  user: User | null;
  login(body: LoginRequest): Promise<void>;
  register(body: RegisterRequest): Promise<void>;
  logout(): Promise<void>;
  /**
   * Sign out every device (`POST /auth/logout-all`), then clean up locally exactly like
   * `logout()`. A failure is thrown to the caller and leaves this session untouched.
   */
  logoutAll(): Promise<void>;
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
   * Every sign-out (logout, a 401, a failed bootstrap) bumps this counter, so a `GET /me`
   * that was already in flight when the session died cannot write `authenticated` back
   * after the fact (04 §2.1 item 2).
   */
  const session = React.useRef(0);

  /**
   * Fetch the profile and move to `authenticated`. A non-null server-side language wins
   * over the locally stored one (04 §5.1) and is applied without persisting: the local
   * `lang` pref keeps meaning "what this device chose while signed out". `language: null`
   * means "follow the device" — which `initI18n()` has already resolved (local pref →
   * device language), so it is left exactly as it is.
   */
  const loadProfile = React.useCallback(async (): Promise<void> => {
    const mySession = session.current;
    const me = await meApi.get();
    if (!alive.current || session.current !== mySession) return;
    setUserState(me);
    setStatus('authenticated');
    if (!me.language) return;
    try {
      await applyLanguage(me.language, { persist: false });
    } catch {
      // A language switch that fails must never cost the user their session.
    }
  }, []);

  const goAnonymous = React.useCallback((): void => {
    session.current += 1;
    setUserState(null);
    setStatus('anonymous');
    // Every sign-out (logout, a 401, a failed bootstrap): the next account on this tab must
    // not inherit a ledger the previous one was flagged out of, nor its tab-remembered pick.
    resetLedgerUnavailable();
    void setSessionPref(PREF_NAMES.currentLedgerId, null);
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
      } catch (err) {
        // Any failure lands on anonymous — a login screen beats a permanently stuck
        // splash — but only a 401 (the interceptor's refresh was refused too) forgets the
        // tokens. Offline or a 5xx keeps them, so a reload once the network is back
        // restores the session instead of one outage costing 90 days of it (§14.67).
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 401) {
          await clearAuthToken();
          if (cancelled) return;
        }
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
    async (res: AuthResponse): Promise<void> => {
      // `?? null` guards a reply from a backend that predates refresh tokens.
      await setAuthTokens({
        accessToken: res.access_token,
        refreshToken: res.refresh_token ?? null,
      });
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
      await finishSignIn(res);
    },
    [finishSignIn],
  );

  const register = React.useCallback(
    async (body: RegisterRequest): Promise<void> => {
      const res = await authApi.register(body);
      await finishSignIn(res);
    },
    [finishSignIn],
  );

  /** The local half of every sign-out: tokens, state, caches and ledger prefs. */
  const clearLocalSession = React.useCallback(async (): Promise<void> => {
    await clearAuthToken();
    goAnonymous();
    queryClient.clear();
    await clearApiCache();
    await setPref(PREF_NAMES.lastLedgerId, null);
    // This tab's current ledger (§14.66 b) goes too, so the next account starts fresh.
    await setSessionPref(PREF_NAMES.currentLedgerId, null);
  }, [goAnonymous, queryClient]);

  const logout = React.useCallback(async (): Promise<void> => {
    // Revoke this device's refresh token server-side. The token is read and the request
    // sent before the local wipe below; its outcome is never awaited, so a slow or failed
    // call cannot hold logout up (§14.67).
    const refreshToken = await getRefreshToken();
    if (refreshToken) {
      void authApi.logout({ refresh_token: refreshToken }).catch(() => undefined);
    }
    await clearLocalSession();
    // Navigating to /login is the caller's job (04 §1.5 rule 5).
  }, [clearLocalSession]);

  const logoutAll = React.useCallback(async (): Promise<void> => {
    // A failure propagates before anything local is touched: the session stays as it was.
    await authApi.logoutAll();
    // Every refresh token is already revoked, this device's included — no /auth/logout.
    await clearLocalSession();
    // Navigating to /login is the caller's job, as for logout().
  }, [clearLocalSession]);

  const refreshUser = React.useCallback(async (): Promise<void> => {
    await loadProfile();
  }, [loadProfile]);

  const setUser = React.useCallback((next: User | null): void => {
    if (!next) session.current += 1;
    setUserState(next);
    setStatus(next ? 'authenticated' : 'anonymous');
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({ status, user, login, register, logout, logoutAll, refreshUser, setUser }),
    [status, user, login, register, logout, logoutAll, refreshUser, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = React.useContext(AuthContext);
  if (!value) throw new Error('useAuth() must be used inside an <AuthProvider>');
  return value;
}
