/**
 * 记一笔 `/l/:ledgerId/transactions/new?kind=...` (04 §4.6) — and, through `TransactionForm`,
 * the body of the edit screen as well.
 *
 * One form, four tabs (decision §1). Switching tabs rewrites the URL and keeps everything
 * that still means the same thing (amount, date, account, note); only the category is
 * dropped when the tree underneath it changes (decision §1.3).
 */
import React from 'react';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Transaction, TxKind } from '@/api/types';
import { KINDS } from '@/domain/kinds';
import { safeNext } from '@/domain/routes';
import { errorMessage } from '@/i18n/errorCodes';
import { todayLocalIso } from '@/i18n/format';
import { useBack } from '@/navigation';
import { useCreateTransaction, useCreateTransfer, useTransaction } from '@/queries';
import { useLedgerContext } from '@/store';
import { toast } from '@/ui';

import { TransactionForm } from './TransactionForm';
import { applyFieldErrors } from './conflicts';
import type { TxFormValues } from './schemas';
import { useLeaveGuard } from './useLeaveGuard';
import {
  toTransactionCreate,
  toTransferCreate,
  useTransactionForm,
  type TxFormController,
} from './useTransactionForm';

export { TransactionForm, type TransactionFormProps } from './TransactionForm';
export { ConflictBanner, applyFieldErrors, findConflicts, type FormConflict } from './conflicts';

export default function TransactionFormScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { ledgerId } = useLedgerContext();
  const params = useLocalSearchParams<{
    kind?: string;
    source_id?: string;
    refund_of?: string;
    copy_of?: string;
    next?: string;
  }>();

  const paramKind = KINDS.find((k) => k === params.kind);
  const refundOf = typeof params.refund_of === 'string' ? params.refund_of : null;
  const copyOf = typeof params.copy_of === 'string' ? params.copy_of : null;
  const next = safeNext(params.next);

  const ctrl = useTransactionForm({
    ledgerId,
    mode: 'create',
    initial: {
      // `?refund_of=` lands on the refund tab even without an explicit `?kind=`.
      kind: paramKind ?? (refundOf ? 'refund' : 'expense'),
      source_id: typeof params.source_id === 'string' ? params.source_id : '',
      refund_of: refundOf,
      occurred_at: todayLocalIso(),
    },
  });

  const create = useCreateTransaction(ledgerId, { silent: true });
  const createTransfer = useCreateTransfer(ledgerId, { silent: true });
  const submitting = create.isPending || createTransfer.isPending;

  const [savedCount, setSavedCount] = React.useState(0);
  const [focusKey, setFocusKey] = React.useState(0);
  const leave = useLeaveGuard(ctrl.form.formState.isDirty && !submitting);

  // "复制一笔" (04 §4.7): same account / merchant / category / amount, today's date.
  const copySource = useTransaction(ledgerId, copyOf ?? undefined);
  const copied = React.useRef(false);
  const copyData: Transaction | undefined = copySource.data;
  React.useEffect(() => {
    if (copied.current || !copyData) return;
    copied.current = true;
    // One leg of a two-leg transfer carries no trace of the other side: the receiving
    // account, its amount and its currency all live on the sibling leg. What this leg does
    // know — the shape, the subtype and the note — is still worth carrying over, and the
    // warning says out loud which half has to be picked again (04 §4.6.4, §4.7).
    if (copyData.kind === 'transfer' && copyData.transfer_pair_id !== null) {
      ctrl.form.reset({
        ...ctrl.form.getValues(),
        kind: 'transfer',
        external: false,
        subtype: copyData.transfer_subtype ?? 'plain',
        note: copyData.note ?? '',
        occurred_at: todayLocalIso(),
      });
      router.setParams({ kind: 'transfer' });
      setFocusKey((n) => n + 1);
      toast.warning(t('transaction:form.copy_transfer_pair_unsupported'));
      return;
    }
    const magnitude = copyData.amount.startsWith('-')
      ? copyData.amount.slice(1)
      : copyData.amount;
    const isSingleLeg = copyData.kind === 'transfer';
    ctrl.form.reset({
      ...ctrl.form.getValues(),
      kind: copyData.kind,
      source_id: copyData.source_id,
      currency: copyData.currency,
      amount: magnitude,
      merchant: copyData.merchant ?? '',
      note: copyData.note ?? '',
      category_l1: copyData.category_l1,
      category_l2: copyData.category_l2,
      occurred_at: todayLocalIso(),
      // A copied single-leg transfer keeps its shape too, or the transfer tab would open
      // on a two-leg form with no receiving account (04 §4.6.4).
      external: isSingleLeg,
      direction: copyData.transfer_role ?? 'out',
      subtype: copyData.transfer_subtype ?? 'plain',
      counterparty: copyData.counterparty ?? '',
      currency_in: isSingleLeg ? copyData.currency : '',
    });
    // The tab follows the copy, so the URL has to as well — browser back/forward reads it.
    router.setParams({ kind: copyData.kind });
    setFocusKey((n) => n + 1);
  }, [copyData, ctrl.form, router, t]);

  // `?next=` first; otherwise back through history, or — deep-linked straight into the
  // form (a shared link, a PWA cold start) — to the parent `useBack` names: the list.
  const back = useBack();
  const stepBack = back.goBack;
  const goBack = React.useCallback((): void => {
    if (next) router.replace(next as Href);
    else stepBack();
  }, [next, router, stepBack]);

  const onSuccess = React.useCallback(
    (values: TxFormValues, again: boolean): void => {
      ctrl.remember(values);
      if (!again) {
        toast.success(t('transaction:form.saved_toast'));
        leave.allowLeave();
        goBack();
        return;
      }
      const count = savedCount + 1;
      setSavedCount(count);
      // Account, date, kind and category stay; the entry-specific fields are cleared and
      // the cursor goes back to the amount box (04 §4.6.5).
      ctrl.form.reset({ ...values, amount: '', merchant: '', note: '', refund_of: null });
      setFocusKey((n) => n + 1);
      toast.success(t('transaction:form.saved_count_toast', { count }));
    },
    [ctrl, goBack, leave, savedCount, t],
  );

  const onError = React.useCallback(
    (error: unknown): void => {
      applyFieldErrors(ctrl, error, () => toast.error(errorMessage(t, error)));
    },
    [ctrl, t],
  );

  const onSubmit = React.useCallback(
    (values: TxFormValues, opts: { again: boolean }): void => {
      if (values.kind === 'transfer' && !values.external) {
        createTransfer.mutate(toTransferCreate(values), {
          onSuccess: () => onSuccess(values, opts.again),
          onError,
        });
        return;
      }
      create.mutate(toTransactionCreate(values), {
        onSuccess: () => onSuccess(values, opts.again),
        onError,
      });
    },
    [create, createTransfer, onError, onSuccess],
  );

  const setKind = ctrl.setKind;
  const onChangeKind = React.useCallback(
    (kind: TxKind): void => {
      setKind(kind);
      router.setParams({ kind });
    },
    [router, setKind],
  );

  // The other direction: `?kind=` changing on its own (browser back/forward, a deep link
  // into an already-mounted form) moves the tab. Only an actual change of the parameter
  // counts — comparing against the form would undo a tab press, because `setParams` lands
  // a render after `setKind`.
  const lastParamKind = React.useRef(paramKind);
  React.useEffect(() => {
    if (paramKind === lastParamKind.current) return;
    lastParamKind.current = paramKind;
    if (paramKind) setKind(paramKind);
  }, [paramKind, setKind]);

  // The tab row lives inside `TransactionForm`, which only knows the controller — so the
  // URL sync is wired by replacing `setKind` on the controller passed down.
  const routedCtrl: TxFormController = React.useMemo(
    () => ({ ...ctrl, setKind: onChangeKind }),
    [ctrl, onChangeKind],
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

  const switchToIncome = React.useCallback((): void => {
    onChangeKind('income');
    ctrl.form.setValue('external', false);
    ctrl.form.setValue('category_l1', 'social_income');
    ctrl.form.setValue('category_l2', null);
  }, [ctrl.form, onChangeKind]);

  return (
    <TransactionForm
      ctrl={routedCtrl}
      submitting={submitting}
      onSubmit={onSubmit}
      onCancel={onCancel}
      submitLabel={t('common:button.save')}
      showSaveAndNext
      onSwitchToIncome={switchToIncome}
      focusKey={focusKey}
      testID="tx-new"
    />
  );
}

