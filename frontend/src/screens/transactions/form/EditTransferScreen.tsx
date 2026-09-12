/**
 * 编辑两腿转账 `/l/:ledgerId/transfers/:pairId/edit` (04 §4.7, decision §1.2).
 *
 * One form for both legs: date, note and subtype are shared, each leg keeps its own
 * account / amount / currency, and saving is a **single**
 * `PATCH .../transactions/transfer/{pair_id}` — editing one leg on its own is never
 * possible here. The `updated_at` that goes with it is the pair's own, falling back to the
 * newer of the two legs (decision §14.40 01-11).
 */
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { isApiClientError } from '@/api/errors';
import type { IsoDateTime, TransferPair } from '@/api/types';
import { absMoney } from '@/domain/money';
import { routes, safeNext } from '@/domain/routes';
import { errorMessage } from '@/i18n/errorCodes';
import { qk, useTransfer, useUpdateTransfer } from '@/queries';
import { useLedgerContext } from '@/store';
import { EmptyState, Page, Skeleton, toast } from '@/ui';

import {
  ConflictBanner,
  TransactionForm,
  applyFieldErrors,
  findConflicts,
  type FormConflict,
} from './TransactionFormScreen';
import type { TxFormValues } from './schemas';
import { useLeaveGuard } from './useLeaveGuard';
import { toTransferUpdate, useTransactionForm } from './useTransactionForm';

/** Both legs' fields a 409 can disagree about, in the order they are shown (04 §3.8). */
const MERGEABLE_FIELDS: readonly (keyof TxFormValues)[] = [
  'amount',
  'currency',
  'source_id',
  'amount_in',
  'currency_in',
  'to_source_id',
  'occurred_at',
  'note',
  'subtype',
];

/** The pair's `updated_at`, or the newer of the two legs (decision §14.40 01-11). */
export function pairUpdatedAt(pair: TransferPair): IsoDateTime {
  if (pair.updated_at) return pair.updated_at;
  return pair.out.updated_at > pair.in.updated_at ? pair.out.updated_at : pair.in.updated_at;
}

/** Both legs as one set of form values. */
export function valuesFromPair(pair: TransferPair): Partial<TxFormValues> {
  return {
    kind: 'transfer',
    external: false,
    subtype: pair.subtype,
    occurred_at: pair.occurred_at,
    note: pair.note ?? '',
    source_id: pair.out.source_id,
    amount: absMoney(pair.out.amount),
    currency: pair.out.currency,
    to_source_id: pair.in.source_id,
    amount_in: absMoney(pair.in.amount),
    currency_in: pair.in.currency,
  };
}

export default function EditTransferScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { ledgerId } = useLedgerContext();
  const params = useLocalSearchParams<{ pairId?: string; next?: string }>();
  const pairId = typeof params.pairId === 'string' ? params.pairId : '';
  const next = safeNext(params.next);

  const query = useTransfer(ledgerId, pairId === '' ? undefined : pairId);
  const pair = query.data;

  const ctrl = useTransactionForm({
    ledgerId,
    mode: 'edit',
    autoFillSource: false,
    initial: { kind: 'transfer' },
  });
  const update = useUpdateTransfer(ledgerId, pairId, { silent: true });
  const [conflicts, setConflicts] = React.useState<FormConflict[]>([]);
  const leave = useLeaveGuard(ctrl.form.formState.isDirty && !update.isPending);

  const prefilled = React.useRef(false);
  React.useEffect(() => {
    if (prefilled.current || !pair) return;
    prefilled.current = true;
    ctrl.form.reset({ ...ctrl.form.getValues(), ...valuesFromPair(pair) });
  }, [ctrl.form, pair]);

  const goBack = React.useCallback((): void => {
    if (next) router.replace(next as Href);
    else router.replace(routes.l(ledgerId).transfer(pairId) as Href);
  }, [ledgerId, next, pairId, router]);

  const onSubmit = React.useCallback(
    (values: TxFormValues): void => {
      if (!pair) return;
      update.mutate(toTransferUpdate(values, pairUpdatedAt(pair)), {
        onSuccess: () => {
          setConflicts([]);
          toast.success(t('transaction:form.saved_toast'));
          leave.allowLeave();
          goBack();
        },
        onError: (error) => {
          if (isApiClientError(error) && error.status === 409 && error.code === 'stale_update') {
            // 04 §3.8: the global handler refetched already — take the server's values as
            // the new baseline, keep whatever the user had changed, and say field by field
            // where the two now disagree (step 4). Nothing is re-sent.
            const fresh = qc.getQueryData<TransferPair>(qk.ledger(ledgerId).transfer(pairId));
            if (fresh) {
              const server = valuesFromPair(fresh);
              setConflicts(findConflicts(MERGEABLE_FIELDS, server, ctrl));
              ctrl.form.reset(
                { ...ctrl.form.getValues(), ...server },
                { keepDirtyValues: true },
              );
            }
            return;
          }
          applyFieldErrors(ctrl, error, () => toast.error(errorMessage(t, error)));
        },
      });
    },
    [ctrl, goBack, leave, ledgerId, pair, pairId, qc, t, update],
  );

  const onCancel = React.useCallback((): void => {
    void leave.confirmLeave().then((ok) => {
      if (!ok) return;
      // The guard has just asked; the navigation it is about to make is the answer, not a
      // new exit to challenge — without this the `beforeRemove` listener asks again.
      leave.allowLeave();
      goBack();
    });
  }, [goBack, leave]);

  if (query.isError) {
    // The pair may be gone (someone deleted it, this session cannot read the ledger) —
    // a skeleton that never resolves would leave nothing to press.
    return (
      <Page testID="transfer-edit">
        <EmptyState
          testID="transfer-edit-error"
          icon="alert-triangle"
          title={errorMessage(t, query.error)}
          primaryAction={{
            label: t('common:button.retry'),
            onPress: () => void query.refetch(),
          }}
          secondaryAction={{
            label: t('transaction:list.title'),
            onPress: () => router.replace(routes.l(ledgerId).transactions() as Href),
          }}
        />
      </Page>
    );
  }

  if (query.isPending || !pair) {
    return (
      <Page testID="transfer-edit">
        <Skeleton variant="table" rows={5} testID="transfer-edit-skeleton" />
      </Page>
    );
  }

  return (
    <TransactionForm
      ctrl={ctrl}
      banner={
        <ConflictBanner
          ctrl={ctrl}
          conflicts={conflicts}
          idPrefix="transfer-edit"
          onResolve={(field) => setConflicts((list) => list.filter((c) => c.field !== field))}
        />
      }
      submitting={update.isPending}
      onSubmit={onSubmit}
      onCancel={onCancel}
      submitLabel={t('common:button.save')}
      lockShape
      testID="transfer-edit"
    />
  );
}
