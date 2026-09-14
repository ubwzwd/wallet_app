/**
 * 记一笔 `/l/:ledgerId/transactions/new?kind=...` (04 §4.6) — and, through `TransactionForm`,
 * the body of the edit screen as well.
 *
 * One form, four tabs (decision §1). Switching tabs rewrites the URL and keeps everything
 * that still means the same thing (amount, date, account, note); only the category is
 * dropped when the tree underneath it changes (decision §1.3).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { isApiClientError } from '@/api/errors';
import type { Money, Transaction, TxKind } from '@/api/types';
import { evaluateExpression, isExpression } from '@/domain/calc';
import { KINDS } from '@/domain/kinds';
import { routes, safeNext } from '@/domain/routes';
import { categoryName } from '@/i18n/category';
import { errorMessage } from '@/i18n/errorCodes';
import { formatDate, formatMoney, todayLocalIso } from '@/i18n/format';
import {
  useCategories,
  useCreateTransaction,
  useCreateTransfer,
  useTransaction,
} from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import {
  Button,
  Card,
  EmptyState,
  KeyboardHint,
  Page,
  SegmentedControl,
  Skeleton,
  Text,
  toast,
  trimMoney,
  type Shortcut,
} from '@/ui';

import { RefundFields, RefundOverWarning, useRefundOrigin } from './RefundFields';
import { SingleFields } from './SingleFields';
import { StatsPreview } from './StatsPreview';
import { TransferFields } from './TransferFields';
import { rawMessage, type TxFormValues } from './schemas';
import { useFormShortcuts } from './useFormShortcuts';
import { useLeaveGuard } from './useLeaveGuard';
import {
  toTransactionCreate,
  toTransferCreate,
  useTransactionForm,
  type TxFormController,
} from './useTransactionForm';

/**
 * Server field name → the control that shows it.
 *
 * The two-leg transfer endpoint names the same three boxes differently (04 §4.6.4:
 * `from_source_id` / `amount_out` / `currency_out`), so its aliases map onto the same
 * controls; anything missing here has no box to sit next to and goes to the toast instead.
 */
const SERVER_FIELDS: Readonly<Record<string, keyof TxFormValues>> = {
  source_id: 'source_id',
  amount: 'amount',
  currency: 'currency',
  occurred_at: 'occurred_at',
  merchant: 'merchant',
  note: 'note',
  category_l1: 'category_l1',
  category_l2: 'category_l2',
  refund_of: 'refund_of',
  counterparty: 'counterparty',
  to_source_id: 'to_source_id',
  amount_in: 'amount_in',
  currency_in: 'currency_in',
  from_source_id: 'source_id',
  amount_out: 'amount',
  currency_out: 'currency',
  subtype: 'subtype',
};

export interface TransactionFormProps {
  ctrl: TxFormController;
  /** Kinds whose tab is disabled, with the reason shown underneath (04 §4.7). */
  disabledKinds?: readonly TxKind[];
  disabledKindHint?: string | null;
  /** Rendered above the tabs: the import note, or the 409 conflict block. */
  banner?: React.ReactNode;
  submitting: boolean;
  /** Blocks saving without pretending a request is in flight (e.g. "unlink the refund first"). */
  submitDisabled?: boolean;
  onSubmit(values: TxFormValues, opts: { again: boolean }): void;
  onCancel(): void;
  submitLabel: string;
  /** "Save and add another" only makes sense while creating (04 §4.6.5). */
  showSaveAndNext?: boolean;
  /** Edit mode: how much this entry already contributes to the cached monthly summary. */
  statsBaseline?: Money | null;
  onSwitchToIncome?(): void;
  /** Editing a two-leg transfer: no tabs, no single-leg checkbox. */
  lockShape?: boolean;
  /**
   * Editing a single-leg transfer: the tabs stay (expense ⇄ income is still allowed for
   * other kinds), but one leg can never become two here — decision §1.2 has no conversion,
   * and `PATCH .../transactions/{id}` carries no second account.
   */
  lockLegs?: boolean;
  /** Remount key — bumping it puts the cursor back in the amount box. */
  focusKey?: number;
  testID?: string;
}

export function TransactionForm({
  ctrl,
  disabledKinds,
  disabledKindHint,
  banner,
  submitting,
  submitDisabled = false,
  onSubmit,
  onCancel,
  submitLabel,
  showSaveAndNext = false,
  statsBaseline,
  onSwitchToIncome,
  lockShape = false,
  lockLegs = false,
  focusKey = 0,
  testID,
}: TransactionFormProps): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { ledgerId } = useLedgerContext();
  const { form, kind, setKind, sources, sourcesLoading, values } = ctrl;
  const refund = useRefundOrigin(ctrl);
  const [helpOpen, setHelpOpen] = React.useState(false);
  // An overlay owns the keyboard while it is up. Every overlay this form puts up reports
  // its own open state here, and the one shared shortcut switch reads the lot.
  const overlayOpen = helpOpen || refund.pickerOpen;

  const submit = (again: boolean): void => {
    // `AmountField` only evaluates `12.5+8.8*2` when it loses focus, so ⌘S with the caret
    // still in the box would otherwise submit the expression itself (04 §4.6, §14.52 A19).
    const raw = form.getValues('amount');
    if (isExpression(raw)) {
      const evaluated = evaluateExpression(raw);
      if (evaluated !== null) form.setValue('amount', trimMoney(evaluated), { shouldDirty: true });
    }
    void form.handleSubmit((v) => onSubmit(v, { again }))();
  };

  useFormShortcuts({
    onSave: () => submit(false),
    onSaveAndNext: () => (showSaveAndNext ? submit(true) : submit(false)),
    onDiscard: onCancel,
    onKind: lockShape
      ? undefined
      : (next) => {
          if (disabledKinds?.includes(next)) return;
          setKind(next);
        },
    onHelp: () => setHelpOpen(true),
    enabled: !submitting && !overlayOpen,
  });

  const shortcuts: Shortcut[] = [
    { keys: ['⌘/Ctrl', 'S'], label: t('transaction:form.keyboard_hint.save') },
    { keys: ['⌘/Ctrl', 'Enter'], label: t('transaction:form.keyboard_hint.save_and_next') },
    { keys: ['Esc'], label: t('transaction:form.keyboard_hint.discard') },
    { keys: ['1', '2', '3', '4'], label: t('transaction:form.keyboard_hint.switch_kind') },
    { keys: ['?'], label: t('transaction:form.keyboard_hint.help') },
  ];

  if (sourcesLoading) {
    return (
      <Page testID={testID ?? 'tx-form'}>
        <Skeleton variant="table" rows={6} testID="tx-form-skeleton" />
      </Page>
    );
  }

  if (sources.filter((s) => !s.archived).length === 0 && ctrl.mode === 'create') {
    return (
      <Page testID={testID ?? 'tx-form'}>
        <EmptyState
          testID="tx-form-no-sources"
          icon="wallet"
          title={t('transaction:form.no_sources')}
          primaryAction={{
            label: t('transaction:form.no_sources_action'),
            onPress: () => router.navigate(routes.l(ledgerId).sourceNew() as Href),
          }}
        />
      </Page>
    );
  }

  return (
    <Page testID={testID ?? 'tx-form'}>
      {banner}

      {lockShape ? null : (
        <>
          <SegmentedControl<TxKind>
            testID="tx-kind"
            accessibilityLabel={t('transaction:form.kind_label')}
            value={kind}
            onChange={setKind}
            options={KINDS.map((k) => ({
              value: k,
              label: t(`transaction:kind.${k}`),
              disabled: disabledKinds?.includes(k) ?? false,
            }))}
          />
          {disabledKindHint ? (
            <Text variant="caption" tone="secondary" testID="tx-kind-hint">
              {disabledKindHint}
            </Text>
          ) : null}
        </>
      )}

      <View style={styles.fields} key={focusKey}>
        {kind === 'transfer' ? (
          <TransferFields
            ctrl={ctrl}
            onSwitchToIncome={onSwitchToIncome}
            lockShape={lockShape}
            lockLegs={lockLegs}
            disabled={submitting}
            autoFocusAmount={focusKey > 0}
          />
        ) : (
          <SingleFields
            ctrl={ctrl}
            disabled={submitting}
            autoFocusAmount={focusKey > 0}
            aboveAmount={
              kind === 'refund' ? (
                <RefundFields ctrl={ctrl} state={refund} disabled={submitting} />
              ) : null
            }
            belowAmount={
              kind === 'refund' ? <RefundOverWarning ctrl={ctrl} state={refund} /> : null
            }
          />
        )}
      </View>

      <StatsPreview
        ledgerId={ledgerId}
        kind={kind}
        categoryL1={values.category_l1}
        amount={values.amount}
        currency={values.currency}
        occurredAt={values.occurred_at}
        baseline={statsBaseline}
      />

      <View style={styles.actions}>
        <Button
          testID="tx-submit"
          label={submitLabel}
          onPress={() => submit(false)}
          loading={submitting}
          disabled={submitting || submitDisabled}
        />
        {showSaveAndNext ? (
          <Button
            testID="tx-submit-again"
            variant="secondary"
            label={t('transaction:form.save_and_next')}
            onPress={() => submit(true)}
            disabled={submitting || submitDisabled}
          />
        ) : null}
        <Button
          testID="tx-cancel"
          variant="ghost"
          label={t('common:button.cancel')}
          onPress={onCancel}
          disabled={submitting}
        />
        <Button
          testID="tx-help"
          variant="ghost"
          size="sm"
          iconOnly
          icon="info"
          accessibilityLabel={t('transaction:form.keyboard_hint_title')}
          onPress={() => setHelpOpen(true)}
        />
      </View>

      <KeyboardHint
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        shortcuts={shortcuts}
        title={t('transaction:form.keyboard_hint_title')}
        testID="tx-keyboard-hint"
      />
    </Page>
  );
}

/**
 * Push a 422's `fields` onto the form (04 §4.6.5). Anything that does not map onto a
 * control — or an error that carries no `fields` at all — falls back to the toast.
 */
export function applyFieldErrors(
  ctrl: TxFormController,
  error: unknown,
  fallback: () => void,
): void {
  if (!isApiClientError(error) || !error.fields) {
    fallback();
    return;
  }
  let unplaced = Object.keys(error.fields).length === 0;
  for (const [name, message] of Object.entries(error.fields)) {
    const field = SERVER_FIELDS[name];
    if (!field) {
      // A field with no box of its own must not disappear just because another one
      // happened to match — the toast is where it is still readable.
      unplaced = true;
      continue;
    }
    // Every control renders its error through `txValidationMessage`, which resolves a
    // `validation` key — so the server's own prose has to be marked as finished copy,
    // otherwise it would be looked up and come out as 「这是必填项」.
    ctrl.form.setError(field, { type: 'server', message: rawMessage(message) });
  }
  if (unplaced) fallback();
}

// --------------------------------------------------------- the 409 merge (04 §3.8)

/** One field the server disagrees about after a 409 (04 §3.8 step 4). */
export interface FormConflict {
  field: keyof TxFormValues;
  /** The server's value, already in form shape. */
  value: string | null;
}

/**
 * The fields the user changed that the server now says something else about. Fields the
 * user never touched are not conflicts: they are simply taken over.
 */
export function findConflicts(
  fields: readonly (keyof TxFormValues)[],
  server: Partial<TxFormValues>,
  ctrl: TxFormController,
): FormConflict[] {
  const current = ctrl.form.getValues();
  const dirty = ctrl.form.formState.dirtyFields as Partial<
    Record<keyof TxFormValues, boolean>
  >;
  const found: FormConflict[] = [];
  for (const field of fields) {
    if (dirty[field] !== true) continue;
    const serverValue = (server[field] ?? null) as string | null;
    const mine = (current[field] ?? null) as string | null;
    if (serverValue === mine) continue;
    found.push({ field, value: serverValue });
  }
  return found;
}

/** 「服务器上现在是：X」 + [用服务器的], per conflicting field (04 §3.8 step 4). */
export function ConflictBanner({
  ctrl,
  conflicts,
  onResolve,
  idPrefix = 'tx-edit',
}: {
  ctrl: TxFormController;
  conflicts: readonly FormConflict[];
  /** Called after the server's value has been written into the form. */
  onResolve(field: keyof TxFormValues): void;
  /** Which screen is showing it — `tx-edit` or `transfer-edit`. */
  idPrefix?: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const { index } = useCategories();
  if (conflicts.length === 0) return null;

  function label(field: keyof TxFormValues, value: string | null): string {
    if (value === null || value === '') return t('common:status.none');
    if (field === 'amount' || field === 'amount_in') {
      const currency = field === 'amount' ? ctrl.values.currency : ctrl.values.currency_in;
      return formatMoney(value, currency, ctrl.lang);
    }
    if (field === 'occurred_at') return formatDate(value, ctrl.lang);
    if (field === 'source_id' || field === 'to_source_id') {
      return ctrl.sourceById(value)?.name ?? value;
    }
    if (field === 'category_l1' || field === 'category_l2') {
      const category = index?.byCode[value];
      return category ? categoryName(category, ctrl.lang) : value;
    }
    if (field === 'subtype') return t(`transaction:transfer.subtype.${value}`);
    if (field === 'direction') return t(`transaction:transfer.role.${value}`);
    // A refund link is an id with no copy of its own: "已关联" is all it can say, and the
    // `null` case above has already answered with 「无」.
    if (field === 'refund_of') return t('transaction:picker.linked_title');
    return value;
  }

  return (
    <Card variant="outlined" testID={`${idPrefix}-conflict`}>
      <Text variant="caption" tone="warning">
        {t('transaction:form.conflict_title')}
      </Text>
      {conflicts.map((conflict) => (
        <View key={conflict.field} style={styles.conflictRow}>
          <Text variant="caption" tone="secondary">
            {`${t(`transaction:form.field.${conflict.field}`)} · ${t(
              'transaction:form.conflict_server_value',
              { value: label(conflict.field, conflict.value) },
            )}`}
          </Text>
          <Button
            testID={`${idPrefix}-use-server-${conflict.field}`}
            variant="ghost"
            size="sm"
            label={t('transaction:form.conflict_use_server')}
            onPress={() => {
              ctrl.form.setValue(conflict.field, conflict.value as never, {
                shouldDirty: false,
              });
              onResolve(conflict.field);
            }}
          />
        </View>
      ))}
    </Card>
  );
}

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

  const goBack = React.useCallback((): void => {
    if (next) {
      router.replace(next as Href);
      return;
    }
    // Deep-linked straight into the form (a shared link, a PWA cold start): there is no
    // history to pop, so the list is the sensible landing place.
    if (router.canGoBack()) router.back();
    else router.replace(routes.l(ledgerId).transactions() as Href);
  }, [ledgerId, next, router]);

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

const styles = StyleSheet.create({
  fields: { gap: space['3'], alignSelf: 'stretch' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space['2'] },
  conflictRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space['2'],
  },
});
