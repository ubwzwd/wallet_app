/** `GET /me` and `PATCH /me` (04 §3.4, §3.6 last row). */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { meApi } from '@/api/me';
import type { User, UserUpdate } from '@/api/types';

import type { MutationOpts } from './client';
import { invalidateMe } from './invalidate';
import { qk } from './keys';

/** The signed-in user. `enabled` is false while the session is unknown or anonymous. */
export function useMe(enabled = true): UseQueryResult<User> {
  return useQuery({
    queryKey: qk.global.me(),
    queryFn: meApi.get,
    enabled,
  });
}

/**
 * `PATCH /me`. The response is written straight into the cache so the UI updates without
 * a round trip; a changed `display_name` also refreshes every cached member list
 * (decision §14.40). Switching i18n on a language change is the settings page's job.
 */
export function useUpdateMe(opts?: MutationOpts): UseMutationResult<User, Error, UserUpdate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: UserUpdate) => meApi.update(b),
    meta: { silent: opts?.silent },
    onSuccess: (user, variables) => {
      qc.setQueryData(qk.global.me(), user);
      invalidateMe(qc, { displayNameChanged: variables.display_name !== undefined });
    },
  });
}
