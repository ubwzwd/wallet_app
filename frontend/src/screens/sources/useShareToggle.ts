/**
 * The account list's 「共享到」 chips (decision §14.62): one press shares an account into a
 * ledger (`PUT /sources/{sid}/ledgers/{lid}`) or stops sharing it (`DELETE …`).
 *
 * The chip flips at once and stays disabled while its request is in flight. On success the
 * cached `shared_to` is patched so the chip does not flicker back before the invalidation
 * refetch lands; on failure the optimistic state is simply dropped — the chip falls back to
 * what the server last said — and a toast says which ledger it was about.
 *
 * Every press is its own `mutateAsync` promise: `mutate`'s per-call callbacks only fire for
 * the latest call, and two chips can be in flight at once.
 */
import React from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { FinanceSource, Ledger, Uuid } from '@/api/types';
import { errorMessage } from '@/i18n/errorCodes';
import { qk, useShareSource } from '@/queries';
import { toast } from '@/ui';

export interface ShareController {
  /** Every ledger I belong to — one chip each. */
  ledgers: readonly Ledger[];
  isShared(source: FinanceSource, ledgerId: Uuid): boolean;
  isPending(source: FinanceSource, ledgerId: Uuid): boolean;
  toggle(source: FinanceSource, ledger: Ledger): void;
}

const keyOf = (sid: Uuid, lid: Uuid): string => `${sid}:${lid}`;

function withShare(source: FinanceSource, lid: Uuid, share: boolean): FinanceSource {
  const rest = (source.shared_to ?? []).filter((id) => id !== lid);
  return { ...source, shared_to: share ? [...rest, lid] : rest };
}

/** Write the confirmed state into every cached copy of my accounts (lists and detail). */
function patchCache(qc: QueryClient, sid: Uuid, lid: Uuid, share: boolean): void {
  qc.setQueriesData<unknown>({ queryKey: qk.global.sourcesRoot() }, (old: unknown) => {
    if (old === null || typeof old !== 'object') return old;
    if ('items' in old && Array.isArray(old.items)) {
      const items = (old.items as FinanceSource[]).map((s) =>
        s.id === sid ? withShare(s, lid, share) : s,
      );
      return { ...old, items };
    }
    if ('id' in old && old.id === sid) return withShare(old as FinanceSource, lid, share);
    return old;
  });
}

export function useShareToggle(ledgers: readonly Ledger[]): ShareController {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const share = useShareSource({ silent: true });
  // chip key → the state it is being moved to, while its request is in flight
  const [pending, setPending] = React.useState<Readonly<Record<string, boolean>>>({});

  const isShared = React.useCallback(
    (source: FinanceSource, lid: Uuid): boolean => {
      const target = pending[keyOf(source.id, lid)];
      return target ?? (source.shared_to ?? []).includes(lid);
    },
    [pending],
  );

  const isPending = React.useCallback(
    (source: FinanceSource, lid: Uuid): boolean => keyOf(source.id, lid) in pending,
    [pending],
  );

  const toggle = React.useCallback(
    (source: FinanceSource, ledger: Ledger): void => {
      const key = keyOf(source.id, ledger.id);
      if (key in pending) return;
      const next = !isShared(source, ledger.id);
      setPending((p) => ({ ...p, [key]: next }));
      const vars = { account: source.name, ledger: ledger.name };
      share
        .mutateAsync({ sid: source.id, lid: ledger.id, share: next })
        .then(() => {
          patchCache(qc, source.id, ledger.id, next);
          toast.success(
            next ? t('source:share.shared_toast', vars) : t('source:share.unshared_toast', vars),
          );
        })
        .catch((e: unknown) => {
          toast.error(t('source:share.failed_toast', vars), { detail: errorMessage(t, e) });
        })
        .finally(() => {
          setPending((p) => {
            const { [key]: _done, ...rest } = p;
            return rest;
          });
        });
    },
    [isShared, pending, qc, share, t],
  );

  return { ledgers, isShared, isPending, toggle };
}
