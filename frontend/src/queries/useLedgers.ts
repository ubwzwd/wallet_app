/**
 * Ledgers, members and invites (04 §3.4, §3.6).
 *
 * Ledger-scoped mutations take the ledger id as a hook argument (the page that calls them
 * already knows it, and the 409 `detailKey` needs it); `create` / `join` / `delete` take
 * theirs as mutation variables because the list page works across ledgers.
 */
import React from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { ledgersApi } from '@/api/ledgers';
import type {
  JoinLedgerRequest,
  Ledger,
  LedgerCreate,
  LedgerDetail,
  LedgerInvite,
  LedgerMember,
  LedgerUpdate,
  Paged,
  TransferOwnershipRequest,
  Uuid,
} from '@/api/types';

import type { MutationOpts } from './client';
import { invalidateLedger, invalidateLedgers, invalidateMembers, removeLedger } from './invalidate';
import { qk } from './keys';

/** Every ledger the user belongs to — also the source of `LedgerContext` (04 §2.2). */
export function useLedgers(): UseQueryResult<Paged<Ledger>> {
  return useQuery({
    queryKey: qk.global.ledgers(),
    queryFn: ledgersApi.list,
  });
}

/** `GET /ledgers/{id}` — adds `counts`, which the delete confirmation shows (§14.52 A22). */
export function useLedger(l: Uuid | undefined): UseQueryResult<LedgerDetail> {
  return useQuery({
    queryKey: qk.ledger(l ?? '').detail(),
    queryFn: () => ledgersApi.get(l as Uuid),
    enabled: Boolean(l),
  });
}

export function useMembers(l: Uuid | undefined): UseQueryResult<Paged<LedgerMember>> {
  return useQuery({
    queryKey: qk.ledger(l ?? '').members(),
    queryFn: () => ledgersApi.members(l as Uuid),
    enabled: Boolean(l),
  });
}

/** Display name of the person behind a `created_by` / `updated_by` id (decision §14.40):
 *  `display_name`, falling back to the part of the email before the `@`. */
export function memberLabel(m: Pick<LedgerMember, 'display_name' | 'email'>): string {
  const name = m.display_name?.trim();
  if (name) return name;
  const at = m.email.indexOf('@');
  return at > 0 ? m.email.slice(0, at) : m.email;
}

/** `user_id` → display name, for rendering "记账人" columns without a second lookup. */
export function useMemberNames(l: Uuid | undefined): Record<Uuid, string> {
  const { data } = useMembers(l);
  const items = data?.items;
  return React.useMemo(() => {
    const out: Record<Uuid, string> = {};
    for (const m of items ?? []) out[m.user_id] = memberLabel(m);
    return out;
  }, [items]);
}

// ------------------------------------------------------------------ mutations

/**
 * Every mutation hook below takes `opts?: MutationOpts` last and forwards `opts.silent`
 * as mutation meta: a page that renders the failure itself passes `{ silent: true }`, and
 * everything else lets the global error toast of §3.9 do the talking.
 */

export function useCreateLedger(
  opts?: MutationOpts,
): UseMutationResult<Ledger, Error, LedgerCreate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: LedgerCreate) => ledgersApi.create(b),
    meta: { silent: opts?.silent },
    onSuccess: () => invalidateLedgers(qc),
  });
}

/** A changed `base_currency` invalidates the ledger's whole subtree (04 §3.6). */
export function useUpdateLedger(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<Ledger, Error, LedgerUpdate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: LedgerUpdate) => ledgersApi.update(l, b),
    meta: { detailKey: qk.ledger(l).detail(), silent: opts?.silent },
    onSuccess: (_data, variables) =>
      invalidateLedger(qc, l, { baseCurrencyChanged: variables.base_currency !== undefined }),
  });
}

export function useDeleteLedger(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<void, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ledgersApi.remove(l),
    meta: { silent: opts?.silent },
    onSuccess: () => removeLedger(qc, l),
  });
}

export function useJoinLedger(
  opts?: MutationOpts,
): UseMutationResult<Ledger, Error, JoinLedgerRequest> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: JoinLedgerRequest) => ledgersApi.join(b),
    meta: { silent: opts?.silent },
    onSuccess: () => invalidateLedgers(qc),
  });
}

/** Invite codes never enter the cache: the code is shown once and then it is gone. */
export function useCreateInvite(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<LedgerInvite, Error, void> {
  return useMutation({
    mutationFn: () => ledgersApi.createInvite(l),
    meta: { silent: opts?.silent },
  });
}

export function useRevokeInvite(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<void, Error, string> {
  return useMutation({
    mutationFn: (code: string) => ledgersApi.revokeInvite(l, code),
    meta: { silent: opts?.silent },
  });
}

export function useRemoveMember(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<void, Error, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: Uuid) => ledgersApi.removeMember(l, userId),
    meta: { silent: opts?.silent },
    onSuccess: () => invalidateMembers(qc, l),
  });
}

export function useTransferOwnership(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<Paged<LedgerMember>, Error, TransferOwnershipRequest> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: TransferOwnershipRequest) => ledgersApi.transferOwnership(l, b),
    meta: { silent: opts?.silent },
    onSuccess: () => invalidateMembers(qc, l),
  });
}

export function useLeaveLedger(
  l: Uuid,
  opts?: MutationOpts,
): UseMutationResult<void, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ledgersApi.leave(l),
    meta: { silent: opts?.silent },
    onSuccess: () => removeLedger(qc, l),
  });
}
