/**
 * The refund tab's extra machinery (04 §4.6.3, decisions §1.1 / §14.52 A20 / B10 / B11),
 * drawn the way mockup 06 draws it: a 「关联原支出」 block under the amount that holds the
 * linked expense, how much of it has already come back and how much is still refundable.
 *
 * Linking the original expense is optional, but once it is linked it drives three things:
 * the category (prefilled, still editable), the account the money comes back to
 * (prefilled, changing it only earns a neutral note) and two quick-amount chips. Refunding
 * more than the original allows is a **warning**, never a block.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Transaction } from '@/api/types';
import { daysAgo } from '@/domain/dates';
import { absMoney, cmpMoney, normalizeAmountInput, subMoney } from '@/domain/money';
import { formatDate, formatMoney } from '@/i18n/format';
import { useTransaction } from '@/queries';
import { useLedgerContext } from '@/store';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Badge, Button, Chip, Icon, ProgressBar, Text, trimMoney } from '@/ui';

import { TransactionPicker } from '../TransactionPicker';
import { FieldLabel, FormCard } from './parts';
import { RefundCandidateRow, RefundPickerHeader, refundableOf } from './RefundPickerRow';
import type { TxFormController } from './useTransactionForm';

/** How far back the candidate list reaches by default (decision §1.1). */
export const REFUND_LOOKBACK_DAYS = 90;

export interface RefundOriginState {
  origin: Transaction | null;
  pickerOpen: boolean;
  openPicker(): void;
  closePicker(): void;
  onlyRefundable: boolean;
  setOnlyRefundable(next: boolean): void;
  link(tx: Transaction): void;
  unlink(): void;
}

export function useRefundOrigin(ctrl: TxFormController): RefundOriginState {
  const { ledgerId } = useLedgerContext();
  const { form } = ctrl;
  const refundOf = ctrl.values.refund_of;
  const [picked, setPicked] = React.useState<Transaction | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [onlyRefundable, setOnlyRefundable] = React.useState(false);

  // A row that came out of the picker already carries everything the summary card needs,
  // so only a `refund_of` that arrived from the URL costs a request.
  const alreadyHave = picked !== null && picked.id === refundOf;
  const query = useTransaction(ledgerId, alreadyHave ? undefined : (refundOf ?? undefined));
  const origin = alreadyHave ? picked : (query.data ?? null);

  const link = React.useCallback(
    (tx: Transaction): void => {
      setPicked(tx);
      form.setValue('refund_of', tx.id, { shouldDirty: true });
      // Category and account follow the original, both still editable (decision §1.1).
      form.setValue('category_l1', tx.category_l1, { shouldDirty: true });
      form.setValue('category_l2', tx.category_l2, { shouldDirty: true });
      ctrl.selectSource(tx.source_id);
    },
    [ctrl, form],
  );

  const unlink = React.useCallback((): void => {
    setPicked(null);
    form.setValue('refund_of', null, { shouldDirty: true });
  }, [form]);

  // Arriving through 「登记退款」 (`?refund_of=<id>`) has to prefill exactly what picking the
  // original in the picker prefills — the URL can carry an id, never a category (04 §4.6.3,
  // §4.7). It happens once: a later refetch must not overwrite what the user chose since.
  const inherited = React.useRef(false);
  const fetched = query.data;
  React.useEffect(() => {
    if (inherited.current || alreadyHave || ctrl.mode !== 'create') return;
    if (!fetched || fetched.id !== refundOf) return;
    inherited.current = true;
    // Nothing here is the user's own edit, so none of it may mark the form dirty — a
    // prefill that did would make 「登记退款 → 返回」 ask about unsaved changes (04 §4.6.5).
    // Only into an empty category box: a tab switch may already have carried one along.
    if (form.getValues('category_l1') === null) {
      form.setValue('category_l1', fetched.category_l1, { shouldDirty: false });
      form.setValue('category_l2', fetched.category_l2, { shouldDirty: false });
    }
    // An explicit `?source_id=` is the caller's own instruction and outranks the original.
    if (!ctrl.sourcePinned) {
      // `ctrl.selectSource` is the user-facing picker's setter and dirties the form, so
      // the account and its currency are written directly instead.
      form.setValue('source_id', fetched.source_id, { shouldDirty: false });
      const source = ctrl.sourceById(fetched.source_id);
      if (source) form.setValue('currency', source.default_currency, { shouldDirty: false });
    }
  }, [alreadyHave, ctrl, fetched, form, refundOf]);

  return {
    origin,
    pickerOpen,
    openPicker: () => setPickerOpen(true),
    closePicker: () => setPickerOpen(false),
    onlyRefundable,
    setOnlyRefundable,
    link,
    unlink,
  };
}

export interface RefundFieldsProps {
  ctrl: TxFormController;
  state: RefundOriginState;
  disabled?: boolean;
}

/** 「关联原支出」: the linked original with its refund progress, or the button to pick one. */
export function RefundFields({
  ctrl,
  state,
  disabled = false,
}: RefundFieldsProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const { lang, values } = ctrl;
  const { origin } = state;

  const full = origin ? absMoney(origin.amount) : null;
  const refunded = origin?.refunded_total ?? '0';
  const remaining = origin ? refundableOf(origin) : null;
  const done = full !== null && Number(full) > 0 ? Number(refunded) / Number(full) : 0;

  const body = (
    <>
      <FieldLabel
        label={t('transaction:form.refund_of')}
        right={
          <Badge
            label={t('transaction:form.refund_recommended')}
            tone={origin === null ? 'warning' : 'neutral'}
            testID="refund-recommended"
          />
        }
      />

      {origin === null ? (
        <Button
          testID="refund-link"
          variant="soft"
          fullWidth
          label={t('transaction:form.refund_of')}
          icon="link"
          onPress={state.openPicker}
          disabled={disabled}
        />
      ) : (
        <View
          testID="refund-origin-card"
          style={[styles.origin, { backgroundColor: colors['kind.refund.subtle'] }]}
        >
          <View style={styles.originRow}>
            <View style={[styles.well, { backgroundColor: colors['bg.surface'] }]}>
              <Icon name="link" size={18} color={colors['kind.refund']} />
            </View>
            <View style={styles.grow}>
              <Text variant="subheading" weight={600} numberOfLines={1}>
                {origin.merchant ?? origin.note ?? formatDate(origin.occurred_at, lang)}
              </Text>
              <Text variant="caption" tone="secondary" mono numberOfLines={2}>
                {`${formatDate(origin.occurred_at, lang)} · ${formatMoney(
                  origin.amount,
                  origin.currency,
                  lang,
                )}`}
              </Text>
            </View>
            <View style={styles.originRight}>
              <Text variant="caption" tone="secondary" mono testID="refund-origin-remaining">
                {t('transaction:form.refund_remaining_label', {
                  amount: formatMoney(remaining ?? '0', origin.currency, lang),
                })}
              </Text>
              <Button
                testID="refund-change"
                variant="ghost"
                size="sm"
                label={t('transaction:form.refund_change')}
                onPress={state.openPicker}
                disabled={disabled}
              />
            </View>
          </View>
          <ProgressBar
            value={done}
            accessibilityLabel={t('transaction:form.refund_of')}
            testID="refund-origin-progress"
          />
          <View style={styles.originRow}>
            <Text variant="caption" tone="secondary" mono style={styles.grow}>
              {t('transaction:detail.refunds_summary', {
                refunded: formatMoney(refunded, origin.currency, lang),
                refundable: formatMoney(remaining ?? '0', origin.currency, lang),
              })}
            </Text>
            <Button
              testID="refund-unlink"
              variant="ghost"
              size="sm"
              label={t('transaction:form.refund_of_clear')}
              onPress={state.unlink}
              disabled={disabled}
            />
          </View>
        </View>
      )}

      <Text variant="caption" tone="muted">
        {t('transaction:form.refund_optional_hint')}
      </Text>

      {origin !== null && values.source_id !== origin.source_id ? (
        <Text variant="caption" tone="secondary" testID="refund-other-source-hint">
          {t('transaction:form.refund_target_currency_hint')}
        </Text>
      ) : null}

      <RefundPicker ctrl={ctrl} state={state} />
    </>
  );

  if (wide) return <View style={styles.wrap}>{body}</View>;
  return <FormCard style={styles.wrap}>{body}</FormCard>;
}

/** The two amount chips that sit under the refund amount box (mockup 06). */
export function RefundAmountChips({
  ctrl,
  state,
  disabled = false,
}: RefundFieldsProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const { lang, form } = ctrl;
  const origin = state.origin;
  if (!origin) return null;
  const full = absMoney(origin.amount);
  const remaining = refundableOf(origin);
  return (
    <View style={styles.chips}>
      <Chip
        testID="refund-chip-full"
        label={t('transaction:form.refund_full_amount', {
          amount: formatMoney(full, origin.currency, lang),
        })}
        disabled={disabled}
        onPress={() => form.setValue('amount', trimMoney(full), { shouldDirty: true })}
      />
      {cmpMoney(remaining, '0') > 0 ? (
        <Chip
          testID="refund-chip-remaining"
          label={t('transaction:form.refund_remaining_amount', {
            amount: formatMoney(remaining, origin.currency, lang),
          })}
          disabled={disabled}
          onPress={() => form.setValue('amount', trimMoney(remaining), { shouldDirty: true })}
        />
      ) : null}
    </View>
  );
}

/** The candidate dialog of mockup 06 — a table on 1440, full-screen cards on 375. */
function RefundPicker({ ctrl, state }: RefundFieldsProps): React.JSX.Element {
  const { t } = useTranslation();
  const { lang, values } = ctrl;
  return (
    <TransactionPicker
      testID="refund-picker"
      open={state.pickerOpen}
      onClose={state.closePicker}
      onSelect={state.link}
      onClear={state.unlink}
      clearLabel={t('transaction:form.picker_no_link')}
      confirm
      confirmLabel={t('transaction:form.picker_use')}
      selectedId={values.refund_of}
      footerNote={t('transaction:form.picker_refund_note')}
      // 屏幕稿 06 titles the dialog with the field's own label, 「关联原支出」.
      title={t('transaction:form.refund_of')}
      // `refund_of` may only ever point at an expense (decision §1.1), so "expenses only"
      // is a static label here rather than a chip that can be clicked away (§14.52 B11).
      fixed={{ kind: ['expense'] }}
      initial={{
        source_id: values.source_id === '' ? undefined : [values.source_id],
        from: daysAgo(REFUND_LOOKBACK_DAYS),
      }}
      filterRows={(tx) => !state.onlyRefundable || cmpMoney(refundableOf(tx), '0') > 0}
      toolbar={
        <Chip
          testID="refund-only-refundable"
          label={t('transaction:form.refund_only_refundable_toggle')}
          selected={state.onlyRefundable}
          onPress={() => state.setOnlyRefundable(!state.onlyRefundable)}
        />
      }
      tableHeader={<RefundPickerHeader />}
      rowSummary={(tx) =>
        t('transaction:form.picker_selected_summary', {
          name: tx.merchant ?? tx.note ?? formatDate(tx.occurred_at, lang),
          amount: formatMoney(refundableOf(tx), tx.currency, lang),
        })
      }
      renderRow={(tx, selected) => (
        <RefundCandidateRow tx={tx} lang={lang} selected={selected} />
      )}
    />
  );
}

/** The amber "this goes past the original" note under the amount box — never a blocker. */
export function RefundOverWarning({
  ctrl,
  state,
}: {
  ctrl: TxFormController;
  state: RefundOriginState;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const { lang, values } = ctrl;
  const origin = state.origin;
  if (!origin) return null;
  const current = normalizeAmountInput(values.amount);
  if (current === null) return null;
  const remaining = refundableOf(origin);
  if (cmpMoney(current, remaining) <= 0) return null;

  return (
    <Text variant="caption" tone="warning" testID="refund-over-warning" style={styles.warning}>
      {t('transaction:form.refund_over_hint', {
        original: formatMoney(absMoney(origin.amount), origin.currency, lang),
        refunded: formatMoney(origin.refunded_total ?? '0', origin.currency, lang),
        current: formatMoney(current, values.currency, lang),
      })}
    </Text>
  );
}

/** What is still owed after this entry, for the summary card (mockup 06's 「后全额退完」). */
export function remainingAfter(origin: Transaction, amount: string): string | null {
  const current = normalizeAmountInput(amount);
  if (current === null) return null;
  return subMoney(refundableOf(origin), current);
}

const styles = StyleSheet.create({
  wrap: { gap: space['2'], alignSelf: 'stretch' },
  grow: { flex: 1, minWidth: 0 },
  origin: { borderRadius: radius.md + 2, padding: space['3'] + 2, gap: space['2'] },
  originRow: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  originRight: { alignItems: 'flex-end', flexShrink: 0, gap: space['1'] },
  well: {
    width: 36,
    height: 36,
    flexShrink: 0,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'], marginTop: space['2'] },
  warning: { marginTop: space['2'] },
});
