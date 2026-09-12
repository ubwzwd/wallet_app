/**
 * axios-mock-adapter harness shared by every test that touches the API layer (04 §8.2).
 *
 * One adapter serves both `apiClient` and `uploadClient`: the adapter function that
 * `MockAdapter` installs on `apiClient` is copied onto `uploadClient`, so a single
 * `mock` object holds all handlers and one `history` records both instances.
 */
import type { AxiosAdapter } from 'axios';
import MockAdapter from 'axios-mock-adapter';

import { apiClient, resetAuthTokenCache, setOnUnauthorized, uploadClient } from '@/api/client';
import { API_BASE_URL } from '@/constants/config';

export interface MockApi {
  /** The adapter mounted on both instances. */
  mock: MockAdapter;
  /** Forget handlers and history, but stay installed. */
  reset(): void;
  /** Uninstall from both instances and drop the auth/401 state the client holds. */
  restore(): void;
  mockGet(path: string, body?: unknown, status?: number, headers?: Record<string, string>): void;
  mockPost(path: string, body?: unknown, status?: number, headers?: Record<string, string>): void;
  mockPatch(path: string, body?: unknown, status?: number, headers?: Record<string, string>): void;
  mockDelete(path: string, body?: unknown, status?: number, headers?: Record<string, string>): void;
  mockNetworkError(path: string): void;
}

let active: MockApi | null = null;

/**
 * The adapters as axios built them, captured once at module load. Capturing inside
 * `mockApi()` instead would record whatever a previous, still-installed harness left
 * behind, so a second `mockApi()` without a `restore()` would leave a dead adapter
 * mounted for the rest of the run.
 */
const ORIGINAL_API_ADAPTER = apiClient.defaults.adapter;
const ORIGINAL_UPLOAD_ADAPTER = uploadClient.defaults.adapter;

/** Put both instances back on their as-built adapters. Safe to call at any time. */
function uninstall(): void {
  apiClient.defaults.adapter = ORIGINAL_API_ADAPTER;
  uploadClient.defaults.adapter = ORIGINAL_UPLOAD_ADAPTER;
}

/** Absolute URL for a path written relative to the API base, e.g. `/ledgers`. */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

function currentMock(): MockApi {
  if (!active) throw new Error('mockApi() must be called before using the mock helpers');
  return active;
}

export function mockApi(): MockApi {
  // Re-entrant: a harness that was never restored is dropped here rather than nested.
  uninstall();
  const mock = new MockAdapter(apiClient);
  uploadClient.defaults.adapter = apiClient.defaults.adapter as AxiosAdapter;

  const reply =
    (verb: 'onGet' | 'onPost' | 'onPatch' | 'onDelete') =>
    (path: string, body?: unknown, status = 200, headers?: Record<string, string>): void => {
      mock[verb](apiUrl(path)).reply(status, body, headers);
    };

  const harness: MockApi = {
    mock,
    reset: () => mock.reset(),
    restore: () => {
      mock.restore();
      uninstall();
      setOnUnauthorized(null);
      resetAuthTokenCache();
      if (active === harness) active = null;
    },
    mockGet: reply('onGet'),
    mockPost: reply('onPost'),
    mockPatch: reply('onPatch'),
    mockDelete: reply('onDelete'),
    mockNetworkError: (path: string) => {
      mock.onAny(apiUrl(path)).networkError();
    },
  };

  active = harness;
  return harness;
}

// Module-level conveniences bound to the most recently created harness.
export const mockGet: MockApi['mockGet'] = (...args) => currentMock().mockGet(...args);
export const mockPost: MockApi['mockPost'] = (...args) => currentMock().mockPost(...args);
export const mockPatch: MockApi['mockPatch'] = (...args) => currentMock().mockPatch(...args);
export const mockDelete: MockApi['mockDelete'] = (...args) => currentMock().mockDelete(...args);
export const mockNetworkError: MockApi['mockNetworkError'] = (...args) =>
  currentMock().mockNetworkError(...args);
