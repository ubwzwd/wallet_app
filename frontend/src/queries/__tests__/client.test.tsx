import type { QueryClient } from '@tanstack/react-query';
import i18next from 'i18next';

import { ApiClientError } from '@/api/errors';
import { initI18n } from '@/i18n';

import { createQueryClient, shouldRetry, type QueryHandlers } from '../client';
import { qk } from '../keys';

const L = 'ledger-1';

function err(status: number, code: string, detail = 'boom'): ApiClientError {
  return new ApiClientError(status, code, detail);
}

function handlers(): jest.Mocked<QueryHandlers> {
  return {
    onUnauthorized: jest.fn(),
    onLedgerGone: jest.fn(),
    notify: jest.fn(),
  } as unknown as jest.Mocked<QueryHandlers>;
}

/** Run a mutation through the client's `MutationCache`, swallowing the rejection. */
async function runMutation(
  qc: QueryClient,
  options: {
    mutationFn: () => Promise<unknown>;
    meta?: { detailKey?: readonly unknown[]; silent?: boolean };
  },
): Promise<void> {
  const mutation = qc.getMutationCache().build(qc, { ...options, retry: 0, gcTime: Infinity });
  await mutation.execute(undefined).catch(() => undefined);
}

beforeAll(async () => {
  await initI18n();
});

describe('retry policy (04 §2.4)', () => {
  test('never retries a 4xx', () => {
    expect(shouldRetry(0, err(409, 'stale_update'))).toBe(false);
    expect(shouldRetry(0, err(422, 'validation_error'))).toBe(false);
    expect(shouldRetry(0, err(404, 'not_found'))).toBe(false);
  });

  test('retries a 500 and a network failure at most twice', () => {
    for (const e of [err(500, 'internal_error'), err(0, 'network_error')]) {
      expect(shouldRetry(0, e)).toBe(true);
      expect(shouldRetry(1, e)).toBe(true);
      expect(shouldRetry(2, e)).toBe(false);
    }
  });

  test('the client uses it as its query default', () => {
    const qc = createQueryClient(handlers());
    const defaults = qc.getDefaultOptions().queries;
    expect(defaults?.retry).toBe(shouldRetry);
    expect(defaults?.staleTime).toBe(30_000);
    expect(defaults?.gcTime).toBe(10 * 60_000);
    expect(defaults?.refetchOnWindowFocus).toBe(true);
    expect(defaults?.refetchOnReconnect).toBe(true);
    expect(qc.getDefaultOptions().mutations?.retry).toBe(0);
  });
});

describe('QueryCache.onError', () => {
  test('401 signs the user out', async () => {
    const deps = handlers();
    const qc = createQueryClient(deps);
    await qc
      .fetchQuery({
        queryKey: qk.global.me(),
        queryFn: () => Promise.reject(err(401, 'unauthorized', 'Not authenticated')),
        retry: false,
        gcTime: Infinity,
      })
      .catch(() => undefined);
    expect(deps.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(deps.onLedgerGone).not.toHaveBeenCalled();
  });

  test('404 not_found on a ledger detail key reports the ledger as gone', async () => {
    const deps = handlers();
    const qc = createQueryClient(deps);
    await qc
      .fetchQuery({
        queryKey: qk.ledger(L).detail(),
        queryFn: () => Promise.reject(err(404, 'not_found')),
        retry: false,
        gcTime: Infinity,
      })
      .catch(() => undefined);
    expect(deps.onLedgerGone).toHaveBeenCalledWith(L);
  });

  test('404 on any other key is left to the page', async () => {
    const deps = handlers();
    const qc = createQueryClient(deps);
    await qc
      .fetchQuery({
        queryKey: qk.ledger(L).tx('t1'),
        queryFn: () => Promise.reject(err(404, 'not_found')),
        retry: false,
        gcTime: Infinity,
      })
      .catch(() => undefined);
    expect(deps.onLedgerGone).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });
});

describe('MutationCache.onError (04 §3.8)', () => {
  test('409 stale_update invalidates the detail key and warns', async () => {
    const deps = handlers();
    const qc = createQueryClient(deps);
    const invalidate = jest.spyOn(qc, 'invalidateQueries');
    const detailKey = qk.ledger(L).tx('t1');

    await runMutation(qc, {
      mutationFn: () => Promise.reject(err(409, 'stale_update', 'someone else changed it')),
      meta: { detailKey },
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: detailKey });
    expect(deps.notify).toHaveBeenCalledTimes(1);
    const [kind, message] = deps.notify.mock.calls[0];
    expect(kind).toBe('warning');
    expect(message).toBe(i18next.t('errors:stale_update'));
    expect(message).not.toBe(i18next.t('errors:unknown', { detail: 'someone else changed it' }));
  });

  test('other errors raise an error toast carrying the detail', async () => {
    const deps = handlers();
    const qc = createQueryClient(deps);
    await runMutation(qc, {
      mutationFn: () => Promise.reject(err(403, 'not_owner', 'Only the owner can do that')),
    });
    expect(deps.notify).toHaveBeenCalledWith(
      'error',
      i18next.t('errors:not_owner'),
      'Only the owner can do that',
    );
  });

  test('meta.silent keeps the global toast quiet', async () => {
    const deps = handlers();
    const qc = createQueryClient(deps);
    await runMutation(qc, {
      mutationFn: () => Promise.reject(err(400, 'invite_invalid')),
      meta: { silent: true },
    });
    expect(deps.notify).not.toHaveBeenCalled();
  });

  test('a 401 during a mutation is left to the query cache path', async () => {
    const deps = handlers();
    const qc = createQueryClient(deps);
    await runMutation(qc, { mutationFn: () => Promise.reject(err(401, 'unauthorized')) });
    expect(deps.notify).not.toHaveBeenCalled();
  });
});
