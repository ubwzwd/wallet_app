/**
 * 编辑单笔 `/l/:ledgerId/transactions/:txId/edit` (04 §4.7).
 *
 * The same form as 记一笔, prefilled, plus the four things only editing has:
 *  - the kind rules of decision §14.3 (transfer never crosses over, and a linked refund
 *    must be unlinked before it can stop being a refund);
 *  - a PATCH that carries `updated_at` and **only** the fields that actually changed;
 *  - the 409 merge of 04 §3.8 — server values become the new baseline, the user's own
 *    edits survive, conflicting fields get a "服务器上现在是…" line, nothing is re-sent;
 *  - notes for an imported row and for an archived account (decision §14.40 01-12).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { isApiClientError } from '@/api/errors';
import type { Transaction, TxKind } from '@/api/types';
import { absMoney } from '@/domain/money';
import { routes, safeNext } from '@/domain/routes';
import { errorMessage } from '@/i18n/errorCodes';
import { qk, useTransaction, useUpdateTransaction } from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { Button, EmptyState, Page, Skeleton, Text, toast } from '@/ui';

import {
  ConflictBanner,
  TransactionForm,
  applyFieldErrors,
  findConflicts,
  type FormConflict,
} from './TransactionFormScreen';
import type { TxFormValues } from './schemas';
import { useLeaveGuard } from './useLeaveGuard';
import {
  toTransactionUpdate,
  useTransactionForm,
  valuesFromTransaction,
} from './useTransactionForm';

/**
 * The fields a 409 can disagree about, in the order they are shown.
 *
 * Every box this screen can edit is here, the single-leg transfer's own three included
 * (`counterparty` / `subtype` / `direction`) and the refund link: a field left out of this
 * list would be quietly overwritten by the server's value with nothing said (04 §3.8).
 */
const MERGEABLE_FIELDS: readonly (keyof TxFormValues)[] = [
  'amount',
  'currency',
  'occurred_at',
  'source_id',
  'merchant',
  'note',
  'category_l1',
  'category_l2',
  'counterparty',
  'subtype',
  'direction',
  'refund_of',
];

export default function EditTransactionScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { ledgerId } = useLedgerContext();
  const params = useLocalSearchParams<{ txId?: string; next?: string }>();
  const txId = typeof params.txId === 'string' ? params.txId : '';
  const next = safeNext(params.next);

  const query = useTransaction(ledgerId, txId === '' ? undefined : txId);
  const tx = query.data;

  const ctrl = useTransactionForm({
    ledgerId,
    mode: 'edit',
    autoFillSource: false,
    allowArchivedId: tx?.source_id ?? null,
  });
  const update = useUpdateTransaction(ledgerId, txId, { silent: true });
  const [conflicts, setConflicts] = React.useState<FormConflict[]>([]);
  const leave = useLeaveGuard(ctrl.form.formState.isDirty && !update.isPending);

  // Prefill once: later refetches must not throw away what the user is typing (the 409
  // path merges explicitly instead).
  const prefilled = React.useRef(false);
  React.useEffect(() => {
    if (prefilled.current || !tx) return;
    prefilled.current = true;
    ctrl.form.reset({ ...ctrl.form.getValues(), ...valuesFromTransaction(tx) });
  }, [ctrl.form, tx]);

  const goBack = React.useCallback((): void => {
    if (next) router.replace(next as Href);
    else router.replace(routes.l(ledgerId).transaction(txId) as Href);
  }, [ledgerId, next, router, txId]);

  // A leg of a two-leg transfer is never edited on its own (04 §4.7, decision §1.2): the
  // pair screen owns both sides and the single PATCH that keeps them consistent.
  const pairId = tx?.transfer_pair_id ?? null;
  React.useEffect(() => {
    if (pairId !== null) router.replace(routes.l(ledgerId).transferEdit(pairId) as Href);
  }, [ledgerId, pairId, router]);

  const onConflict = React.useCallback((): void => {
    // The global 409 handler (04 §3.8) has already invalidated and awaited the refetch,
    // so the cache holds the server's current version by now.
    const fresh = qc.getQueryData<Transaction>(qk.ledger(ledgerId).tx(txId));
    if (!fresh) return;
    const server = valuesFromTransaction(fresh);
    setConflicts(findConflicts(MERGEABLE_FIELDS, server, ctrl));
    // New baseline, user edits preserved, nothing re-sent (04 §3.8 steps 3–5).
    ctrl.form.reset({ ...ctrl.form.getValues(), ...server }, { keepDirtyValues: true });
  }, [ctrl.form, ledgerId, qc, txId]);

  const onSubmit = React.useCallback(
    (values: TxFormValues): void => {
      if (!tx) return;
      const body = toTransactionUpdate(values, tx, tx.updated_at);
      update.mutate(body, {
        onSuccess: () => {
          setConflicts([]);
          ctrl.remember(values);
          toast.success(t('transaction:form.saved_toast'));
          leave.allowLeave();
          goBack();
        },
        onError: (error) => {
          if (isApiClientError(error) && error.status === 409 && error.code === 'stale_update') {
            onConflict();
            return;
          }
          applyFieldErrors(ctrl, error, () => toast.error(errorMessage(t, error)));
        },
      });
    },
    [ctrl, goBack, leave, onConflict, t, tx, update],
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
    // Deleted while the link sat in someone's chat, a ledger this session may not read, a
    // dropped connection: a permanent skeleton would be a dead end with nothing to press.
    return (
      <Page testID="tx-edit">
        <EmptyState
          testID="tx-edit-error"
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

  if (query.isPending || !tx || tx.transfer_pair_id !== null) {
    return (
      <Page testID="tx-edit">
        <Skeleton variant="table" rows={6} testID="tx-edit-skeleton" />
      </Page>
    );
  }

  // Decision §14.3: transfer never turns into anything else, and nothing turns into one.
  const disabledKinds: TxKind[] =
    tx.kind === 'transfer' ? ['expense', 'income', 'refund'] : ['transfer'];

  // Decision §14.3: a linked refund has to be unlinked before it stops being a refund. The
  // gate follows the *form* value — that is the link that still exists — and the banner
  // carries the button that clears it, so the instruction can be followed where it is read.
  const mustUnlinkRefund = ctrl.values.refund_of !== null && ctrl.values.kind !== 'refund';
  const source = ctrl.sourceById(ctrl.values.source_id);

  const banner = (
    <View style={styles.banner}>
      {tx.import_batch_id !== null ? (
        <Text variant="caption" tone="secondary" testID="tx-edit-import-hint">
          {t('transaction:form.from_import', { batch: tx.import_batch_id.slice(0, 8) })}
        </Text>
      ) : null}
      {source?.archived ? (
        <Text variant="caption" tone="secondary" testID="tx-edit-archived-hint">
          {t('transaction:form.archived_source_hint')}
        </Text>
      ) : null}
      {mustUnlinkRefund ? (
        <View style={styles.conflictRow}>
          <Text variant="caption" tone="warning" testID="tx-edit-refund-lock">
            {t('transaction:form.unlink_refund_first')}
          </Text>
          <Button
            testID="tx-edit-refund-unlink"
            variant="ghost"
            size="sm"
            label={t('transaction:form.refund_of_clear')}
            onPress={() => ctrl.form.setValue('refund_of', null, { shouldDirty: true })}
          />
        </View>
      ) : null}
      <ConflictBanner
        ctrl={ctrl}
        conflicts={conflicts}
        onResolve={(field) => setConflicts((list) => list.filter((c) => c.field !== field))}
      />
    </View>
  );

  const sameCategory = tx.category_l1 === ctrl.values.category_l1 && tx.kind === ctrl.values.kind;

  return (
    <TransactionForm
      ctrl={ctrl}
      disabledKinds={disabledKinds}
      disabledKindHint={t('transaction:detail.kind_change_disabled_hint')}
      banner={banner}
      submitting={update.isPending}
      submitDisabled={mustUnlinkRefund}
      onSubmit={onSubmit}
      onCancel={onCancel}
      submitLabel={t('common:button.save')}
      pageTitle={t('transaction:form.page_title_edit')}
      lockLegs={tx.kind === 'transfer'}
      statsBaseline={sameCategory ? absMoney(tx.amount) : null}
      testID="tx-edit"
    />
  );
}

const styles = StyleSheet.create({
  banner: { gap: space['2'], alignSelf: 'stretch' },
  conflictRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space['2'],
  },
});
