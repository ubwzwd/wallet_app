/**
 * The refund tab's extra machinery (04 §4.6.3, decisions §1.1 / §14.52 A20 / B10 / B11).
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
import { absMoney, cmpMoney, normalizeAmountInput } from '@/domain/money';
import { formatDate, formatMoney } from '@/i18n/format';
import { useTransaction } from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { Button, Card, Chip, Switch, Text, trimMoney } from '@/ui';

import { TransactionPicker } from '../TransactionPicker';
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

/** `refundable` as the list/detail endpoints report it, or the full amount as a fallback. */
function refundableOf(tx: Transaction): string {
  return tx.refundable ?? absMoney(tx.amount);
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
    // Only into an empty category box: a tab switch may already have carried one along.
    if (form.getValues('category_l1') === null) {
      form.setValue('category_l1', fetched.category_l1);
      form.setValue('category_l2', fetched.category_l2);
    }
    // An explicit `?source_id=` is the caller's own instruction and outranks the original.
    if (!ctrl.sourcePinned) ctrl.selectSource(fetched.source_id);
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

/** The block above the amount box: link button or linked card, plus the two quick chips. */
export function RefundFields({
  ctrl,
  state,
  disabled = false,
}: RefundFieldsProps): React.JSX.Element {
  const { t } = useTranslation();
  const { lang, form, values } = ctrl;
  const { origin } = state;

  const full = origin ? absMoney(origin.amount) : null;
  const remaining = origin ? refundableOf(origin) : null;

  return (
    <View style={styles.wrap}>
      {origin === null ? (
        <Button
          testID="refund-link"
          variant="secondary"
          label={t('transaction:form.refund_of')}
          icon="link"
          onPress={state.openPicker}
          disabled={disabled}
        />
      ) : (
        <Card variant="outlined" testID="refund-origin-card">
          <View style={styles.cardHeader}>
            <Text variant="caption" tone="secondary">
              {t('transaction:picker.linked_title')}
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
          <Text variant="body">
            {`${formatDate(origin.occurred_at, lang)} · ${origin.merchant ?? ''}`}
          </Text>
          <Text variant="body" mono>
            {formatMoney(origin.amount, origin.currency, lang)}
          </Text>
          <Text variant="caption" tone="secondary" testID="refund-origin-remaining">
            {t('transaction:detail.refunds_summary', {
              refunded: formatMoney(origin.refunded_total ?? '0', origin.currency, lang),
              refundable: formatMoney(remaining ?? '0', origin.currency, lang),
            })}
          </Text>
        </Card>
      )}

      {origin !== null && values.source_id !== origin.source_id ? (
        <Text variant="caption" tone="secondary" testID="refund-other-source-hint">
          {t('transaction:form.refund_target_currency_hint')}
        </Text>
      ) : null}

      {origin !== null && full !== null ? (
        <View style={styles.chips}>
          <Chip
            testID="refund-chip-full"
            label={t('transaction:form.refund_full_amount', {
              amount: formatMoney(full, origin.currency, lang),
            })}
            disabled={disabled}
            onPress={() => form.setValue('amount', trimMoney(full), { shouldDirty: true })}
          />
          {remaining !== null && cmpMoney(remaining, '0') > 0 ? (
            <Chip
              testID="refund-chip-remaining"
              label={t('transaction:form.refund_remaining_amount', {
                amount: formatMoney(remaining, origin.currency, lang),
              })}
              disabled={disabled}
              onPress={() =>
                form.setValue('amount', trimMoney(remaining), { shouldDirty: true })
              }
            />
          ) : null}
        </View>
      ) : null}

      <TransactionPicker
        testID="refund-picker"
        open={state.pickerOpen}
        onClose={state.closePicker}
        onSelect={state.link}
        title={t('transaction:picker.title_refund_origin')}
        // `refund_of` may only ever point at an expense (decision §1.1), so "expenses only"
        // is a static label here rather than a chip that can be clicked away (§14.52 B11).
        fixed={{ kind: ['expense'] }}
        initial={{
          source_id: values.source_id === '' ? undefined : [values.source_id],
          from: daysAgo(REFUND_LOOKBACK_DAYS),
        }}
        filterRows={(tx) => !state.onlyRefundable || cmpMoney(refundableOf(tx), '0') > 0}
        toolbar={
          <Switch
            testID="refund-only-refundable"
            value={state.onlyRefundable}
            onChange={state.setOnlyRefundable}
            label={t('transaction:form.refund_only_refundable_toggle')}
          />
        }
        renderRow={(tx) => (
          <View style={styles.row}>
            <Text variant="body" mono>
              {formatDate(tx.occurred_at, lang)}
            </Text>
            <View style={styles.rowMain}>
              <Text variant="body" numberOfLines={1}>
                {tx.merchant ?? tx.note ?? ''}
              </Text>
              <Text
                variant="caption"
                tone={cmpMoney(refundableOf(tx), '0') > 0 ? 'secondary' : 'muted'}
                testID={`refund-candidate-remaining-${tx.id}`}
              >
                {cmpMoney(refundableOf(tx), '0') > 0
                  ? t('transaction:detail.refunds_summary', {
                      refunded: formatMoney(tx.refunded_total ?? '0', tx.currency, lang),
                      refundable: formatMoney(refundableOf(tx), tx.currency, lang),
                    })
                  : t('transaction:picker.refunded_out')}
              </Text>
            </View>
            <Text variant="body" mono>
              {formatMoney(tx.amount, tx.currency, lang)}
            </Text>
          </View>
        )}
      />
    </View>
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
    <Text variant="caption" tone="warning" testID="refund-over-warning">
      {t('transaction:form.refund_over_hint', {
        original: formatMoney(absMoney(origin.amount), origin.currency, lang),
        refunded: formatMoney(origin.refunded_total ?? '0', origin.currency, lang),
        current: formatMoney(current, values.currency, lang),
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space['2'], alignSelf: 'stretch' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  rowMain: { flex: 1, gap: 2 },
});
