/**
 * The 记一笔 layout (mockups 04 / 05 / 06, decision §14.45 — the mockups are the visual
 * source of truth).
 *
 * Wide: a page header (「记一笔」 + which ledger it goes into), a main column of white cards
 * and a 336 column holding 「这一笔」 — the read-back plus the save buttons. Narrow: the same
 * cards stacked, with 「这一笔」 collapsed into the save bar pinned to the bottom.
 *
 * Nothing about the form model lives here: the controller, the schema, the shortcuts and
 * the leave guard are all unchanged — this file only decides where things sit.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Money, TxKind } from '@/api/types';
import { evaluateExpression, isExpression } from '@/domain/calc';
import { KINDS } from '@/domain/kinds';
import { routes } from '@/domain/routes';
import { useLedgerContext, useAuth } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  Button,
  EmptyState,
  KIND_ICON,
  KeyboardHint,
  Page,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Text,
  trimMoney,
  type Shortcut,
} from '@/ui';

import { RefundAmountChips, RefundFields, RefundOverWarning, useRefundOrigin } from './RefundFields';
import { SingleFields } from './SingleFields';
import { StatsPreview } from './StatsPreview';
import { SummaryCard } from './SummaryCard';
import { TransferFields } from './TransferFields';
import { authorName, summaryContent } from './summaryBits';
import type { TxFormValues } from './schemas';
import { useFormShortcuts } from './useFormShortcuts';
import type { TxFormController } from './useTransactionForm';

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
  /** The page header's own title — 「记一笔」 while creating, 「编辑」 while editing. */
  pageTitle?: string;
  /** "Save and add another" only makes sense while creating (04 §4.6.5). */
  showSaveAndNext?: boolean;
  /** Edit mode: how much this entry already contributes to the cached monthly summary. */
  statsBaseline?: Money | null;
  onSwitchToIncome?(): void;
  /** Editing a two-leg transfer: no tabs, no single-leg toggle. */
  lockShape?: boolean;
  /** Editing a single-leg transfer: the tabs stay, but one leg can never become two. */
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
  pageTitle,
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
  const wide = useIsWide();
  const { ledgerId, ledger, baseCurrency } = useLedgerContext();
  const { user } = useAuth();
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

  const kindRow = lockShape ? null : (
    <View style={styles.kindBlock}>
      <SegmentedControl<TxKind>
        testID="tx-kind"
        accessibilityLabel={t('transaction:form.kind_label')}
        value={kind}
        onChange={setKind}
        style={wide ? styles.kindTabs : undefined}
        options={KINDS.map((k) => ({
          value: k,
          label: t(`transaction:kind.${k}`),
          icon: KIND_ICON[k],
          disabled: disabledKinds?.includes(k) ?? false,
        }))}
      />
      {disabledKindHint ? (
        <Text variant="caption" tone="secondary" testID="tx-kind-hint">
          {disabledKindHint}
        </Text>
      ) : null}
    </View>
  );

  const body =
    kind === 'transfer' ? (
      <TransferFields
        ctrl={ctrl}
        header={kindRow}
        onSwitchToIncome={onSwitchToIncome}
        lockShape={lockShape}
        lockLegs={lockLegs}
        disabled={submitting}
        autoFocusAmount={focusKey > 0}
      />
    ) : (
      <SingleFields
        ctrl={ctrl}
        header={kindRow}
        disabled={submitting}
        autoFocusAmount={focusKey > 0}
        amountChips={
          kind === 'refund' && refund.origin !== null ? (
            <RefundAmountChips ctrl={ctrl} state={refund} disabled={submitting} />
          ) : undefined
        }
        amountNote={
          kind === 'refund' ? <RefundOverWarning ctrl={ctrl} state={refund} /> : null
        }
        belowAmount={
          kind === 'refund' ? (
            <RefundFields ctrl={ctrl} state={refund} disabled={submitting} />
          ) : null
        }
      />
    );

  // ------------------------------------------------------------- 「这一笔」
  const { headline, rows, note } = summaryContent({ ctrl, t, userName: authorName(user) });

  const preview = (
    <StatsPreview
      ledgerId={ledgerId}
      kind={kind}
      categoryL1={values.category_l1}
      amount={values.amount}
      currency={values.currency}
      occurredAt={values.occurred_at}
      baseline={statsBaseline}
    />
  );

  const summary = (
    <SummaryCard
      title={t('transaction:form.summary_title')}
      headline={headline}
      rows={rows}
      note={note}
      preview={preview}
      submitLabel={submitLabel}
      onSubmit={() => submit(false)}
      submitting={submitting}
      submitDisabled={submitDisabled}
      saveAgainLabel={showSaveAndNext ? t('transaction:form.save_and_next') : undefined}
      saveAgainShortLabel={t('transaction:form.save_and_next_short')}
      onSaveAgain={showSaveAndNext ? () => submit(true) : undefined}
      shortcutHint={t('transaction:form.shortcut_hint')}
    />
  );

  const minorActions = (
    <View style={styles.minor}>
      <Button
        testID="tx-cancel"
        variant="ghost"
        size="sm"
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
  );

  const help = (
    <KeyboardHint
      open={helpOpen}
      onClose={() => setHelpOpen(false)}
      shortcuts={shortcuts}
      title={t('transaction:form.keyboard_hint_title')}
      testID="tx-keyboard-hint"
    />
  );

  if (wide) {
    return (
      <Page testID={testID ?? 'tx-form'}>
        {banner}
        <PageHeader
          title={pageTitle ?? t('transaction:form.page_title')}
          actions={
            <Text variant="caption" tone="muted" testID="tx-form-ledger-meta">
              {t('transaction:form.ledger_meta', {
                ledger: ledger.name,
                currency: baseCurrency,
              })}
            </Text>
          }
        />
        <View style={styles.columns} key={focusKey}>
          <View style={styles.main}>{body}</View>
          <View style={styles.aside}>
            {summary}
            {minorActions}
          </View>
        </View>
        {help}
      </Page>
    );
  }

  return (
    <View style={styles.screen}>
      <Page testID={testID ?? 'tx-form'}>
        {banner}
        <View style={styles.narrow} key={focusKey}>
          {body}
          {minorActions}
        </View>
      </Page>
      {summary}
      {help}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: space['6'] },
  main: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  aside: { width: 336, flexShrink: 0, gap: space['2'] },
  narrow: { gap: space['3'], alignSelf: 'stretch' },
  kindBlock: { gap: space['2'], alignSelf: 'stretch', minWidth: 0 },
  kindTabs: { maxWidth: 520 },
  minor: { flexDirection: 'row', alignItems: 'center', gap: space['2'] },
});
