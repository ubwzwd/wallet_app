/**
 * 记一笔 `/transactions/new?kind=&source_id=&refund_of=&copy_of=&next=` (04 §4.6) — and,
 * through `TransactionForm`, the body of the edit screen as well.
 *
 * The query parameters are how the form is *entered* (decision §14.66 f / j): they are read
 * once, when the form mounts, and never written back. Switching tabs is form state only —
 * the address stays as it was entered, so the back button leaves the form instead of
 * stepping through tabs.
 *
 * One form, four tabs (decision §1). Switching tabs keeps everything that still means the
 * same thing (amount, date, account, note); only the category is dropped when the tree
 * underneath it changes (decision §1.3).
 */
import React from 'react';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Transaction } from '@/api/types';
import { KINDS } from '@/domain/kinds';
import { safeNext } from '@/domain/routes';
import { errorMessage } from '@/i18n/errorCodes';
import { todayLocalIso } from '@/i18n/format';
import { useBack, useBackOverride, useLeaveGuard } from '@/navigation';
import { useCreateTransaction, useCreateTransfer, useTransaction } from '@/queries';
import { useLedgerContext } from '@/store';
import { toast } from '@/ui';

import { TransactionForm } from './TransactionForm';
import { applyFieldErrors } from './conflicts';
import type { TxFormValues } from './schemas';
import { toTransactionCreate, toTransferCreate, useTransactionForm } from './useTransactionForm';

export { TransactionForm, type TransactionFormProps } from './TransactionForm';
export { ConflictBanner, applyFieldErrors, findConflicts, type FormConflict } from './conflicts';

type EntryParams = {
  kind?: string;
  source_id?: string;
  refund_of?: string;
  copy_of?: string;
  next?: string;
};

export default function TransactionFormScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { ledgerId } = useLedgerContext();
  const params = useLocalSearchParams<EntryParams>();

  // What the form was opened with, and in which ledger — frozen at mount (§14.66 j).
  const [entry] = React.useState(() => ({
    ledgerId,
    kind: KINDS.find((k) => k === params.kind),
    sourceId: typeof params.source_id === 'string' ? params.source_id : '',
    refundOf: typeof params.refund_of === 'string' ? params.refund_of : null,
    copyOf: typeof params.copy_of === 'string' ? params.copy_of : null,
    next: safeNext(params.next),
  }));
  // A switch to another ledger keeps the page (§14.66 d), but the record to copy and the
  // page to return to belong to the ledger the form was opened in.
  const sameLedger = entry.ledgerId === ledgerId;
  const copyOf = sameLedger ? entry.copyOf : null;
  const next = sameLedger ? entry.next : null;

  const ctrl = useTransactionForm({
    ledgerId,
    mode: 'create',
    initial: {
      // `?refund_of=` lands on the refund tab even without an explicit `?kind=`.
      kind: entry.kind ?? (entry.refundOf ? 'refund' : 'expense'),
      source_id: entry.sourceId,
      refund_of: entry.refundOf,
      occurred_at: todayLocalIso(),
    },
  });

  // What was typed survives a ledger switch; what named the old ledger's records does not:
  // its accounts and the original a refund pointed at. The account falls back to the new
  // ledger's default, as on a fresh form.
  const formLedger = React.useRef(ledgerId);
  React.useEffect(() => {
    if (formLedger.current === ledgerId) return;
    formLedger.current = ledgerId;
    const { setValue } = ctrl.form;
    setValue('source_id', '');
    setValue('currency', '');
    setValue('to_source_id', '');
    setValue('currency_in', '');
    setValue('refund_of', null);
  }, [ctrl.form, ledgerId]);

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
    // The tab follows the copy — in the form only; the address keeps what it was entered
    // with (§14.66 j).
    setFocusKey((n) => n + 1);
  }, [copyData, ctrl.form, t]);

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

  const onCancel = React.useCallback((): void => {
    void leave.confirmLeave().then((ok) => {
      if (!ok) return;
      // The guard has just asked; the navigation it is about to make is the answer, not a
      // new exit to challenge — without this the `beforeRemove` listener asks again.
      leave.allowLeave();
      goBack();
    });
  }, [goBack, leave]);
  // The narrow top bar's ‹ leaves the way 取消 and the wide breadcrumb do: asked once,
  // `?next=` first (§14.65 h).
  useBackOverride(onCancel);

  const setKind = ctrl.setKind;
  const switchToIncome = React.useCallback((): void => {
    setKind('income');
    ctrl.form.setValue('external', false);
    ctrl.form.setValue('category_l1', 'social_income');
    ctrl.form.setValue('category_l2', null);
  }, [ctrl.form, setKind]);

  return (
    <TransactionForm
      ctrl={ctrl}
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

