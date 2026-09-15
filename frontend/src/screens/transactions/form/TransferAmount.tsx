/**
 * The 金额 block of the transfer tab (mockup 05).
 *
 * One headline box while both sides share a currency — with 「单腿 · 只填一次」 sitting on the
 * label line when the other side is not an account — and two boxes side by side, the
 * read-only reference rate under them, when they do not (04 §4.6.4, decision §14.52 A10).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { normalizeAmountInput } from '@/domain/money';
import { formatDate } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { AmountField, Badge, Chip, Icon, Text } from '@/ui';

import { FieldColumns } from './parts';
import { txValidationMessage } from './schemas';
import type { TxFormController } from './useTransactionForm';

/** `1 USD ≈ 7.1694 CNY` from the two magnitudes the user typed; `null` if not computable. */
export function referenceRate(amountOut: string, amountIn: string): string | null {
  const out = normalizeAmountInput(amountOut);
  const inbound = normalizeAmountInput(amountIn);
  if (out === null || inbound === null) return null;
  const outNum = Number(out);
  if (!Number.isFinite(outNum) || outNum === 0) return null;
  const rate = Number(inbound) / outNum;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return rate.toFixed(4);
}

export interface TransferAmountProps {
  ctrl: TxFormController;
  /** Both sides in different currencies: the second box is open. */
  crossCurrency: boolean;
  /** One leg only — the currency follows the account and cannot be changed here. */
  external: boolean;
  autoFocusAmount?: boolean;
  disabled?: boolean;
}

export function TransferAmount({
  ctrl,
  crossCurrency,
  external,
  autoFocusAmount = false,
  disabled = false,
}: TransferAmountProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const {
    form: { control, formState },
    currencies,
    lang,
    values,
  } = ctrl;
  const { errors } = formState;
  const rate = crossCurrency ? referenceRate(values.amount, values.amount_in) : null;
  const badge = crossCurrency
    ? t('transaction:form.transfer_cross_badge')
    : external
      ? t('transaction:form.transfer_single_badge')
      : null;

  const out = (
    <Controller
      control={control}
      name="amount"
      render={({ field }) => (
        <Controller
          control={control}
          name="currency"
          render={({ field: currencyField }) => (
            <AmountField
              testID="transfer-amount"
              size="lg"
              label={
                crossCurrency
                  ? t('transaction:form.transfer_amount_out')
                  : t('transaction:form.amount')
              }
              value={field.value}
              onChange={field.onChange}
              currency={currencyField.value}
              // A single leg has no other side, so its currency is the account's,
              // read-only (decision §14.52 A11).
              onCurrencyChange={external ? undefined : currencyField.onChange}
              codes={currencies.codes}
              currencyNames={currencies.names}
              quickAdd={!crossCurrency}
              allowExpression
              autoFocus={autoFocusAmount}
              disabled={disabled}
              error={
                txValidationMessage(t, errors.amount?.message) ??
                txValidationMessage(t, errors.currency?.message)
              }
            />
          )}
        />
      )}
    />
  );

  const inbound = (
    <Controller
      control={control}
      name="amount_in"
      render={({ field }) => (
        <Controller
          control={control}
          name="currency_in"
          render={({ field: currencyField }) => (
            <AmountField
              testID="transfer-amount-in"
              size="lg"
              label={t('transaction:transfer.amount_in')}
              value={field.value}
              onChange={field.onChange}
              currency={currencyField.value}
              onCurrencyChange={currencyField.onChange}
              codes={currencies.codes}
              currencyNames={currencies.names}
              disabled={disabled}
              error={
                txValidationMessage(t, errors.amount_in?.message) ??
                txValidationMessage(t, errors.currency_in?.message)
              }
            />
          )}
        />
      )}
    />
  );

  const rateChip =
    rate === null ? null : (
      <Chip
        testID="transfer-rate"
        label={t('transaction:transfer.rate_readonly_hint', {
          from: values.currency,
          rate,
          to: values.currency_in,
          date: formatDate(values.occurred_at, lang),
        })}
        style={styles.rateChip}
      />
    );

  return (
    <View style={styles.block}>
      {badge === null ? null : (
        <View style={styles.badgeFloat}>
          <Badge
            testID="transfer-amount-badge"
            label={badge}
            tone={crossCurrency ? 'warning' : 'neutral'}
          />
        </View>
      )}
      {crossCurrency ? (
        <>
          {wide ? (
            <View style={styles.crossRow}>
              <View style={styles.grow}>{out}</View>
              <View style={styles.arrowSlot}>
                <Icon name="arrow-right" size={18} color={colors['fg.muted']} />
              </View>
              <View style={styles.grow}>{inbound}</View>
            </View>
          ) : (
            <>
              {out}
              {rateChip}
              {inbound}
            </>
          )}
          {wide ? rateChip : null}
          <Text variant="caption" tone="muted">
            {t('transaction:transfer.fee_hint')}
          </Text>
        </>
      ) : (
        <FieldColumns ratio={1.25}>
          {out}
          {external ? (
            <Text
              variant="caption"
              tone="muted"
              style={styles.lockedHint}
              testID="transfer-currency-locked-hint"
            >
              {t('transaction:transfer.counterparty_currency_locked_hint')}
            </Text>
          ) : (
            <View />
          )}
        </FieldColumns>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space['2'], alignSelf: 'stretch', position: 'relative' },
  // The 「跨币种」 / 「单腿」 badge sits on the amount label's own line, at the far right.
  badgeFloat: { position: 'absolute', top: 0, right: 0, zIndex: 1 },
  // Sits beside the amount box, not beside its label — the badge owns that line.
  lockedHint: { paddingTop: space['8'] },
  grow: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  crossRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space['3'] },
  arrowSlot: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    // Label (16) + its 6 of padding + half of the 72-tall well, so the arrow sits on the
    // amount's own centre line rather than on the label's.
    marginTop: space['10'] + space['1'],
  },
  rateChip: { alignSelf: 'center' },
});
