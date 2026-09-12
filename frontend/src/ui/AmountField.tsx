/**
 * Amount field (04 §4.6, §6.4; decision §14.52 A19).
 *
 * The user never types a sign — the kind decides it (decision §1), so the sign is a
 * read-only prefix. The field itself carries the two entry aids that make quick catch-up
 * bookkeeping bearable: `+10 / +50 / +100 / ×2` chips and an inline calculator
 * (`12.5+8.8*2` evaluated on blur, the expression kept in a dismissible grey tag).
 *
 * All arithmetic goes through the decimal-string helpers in `src/domain` — the amount is a
 * `Money` string end to end and never becomes a float.
 */
import React from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Money, TxKind } from '@/api/types';
import { evaluateExpression, isExpression } from '@/domain/calc';
import { addMoney, normalizeAmountInput } from '@/domain/money';
import { formatAmountPlain } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { Chip } from './Chip';
import { CurrencyPicker } from './CurrencyPicker';
import { Text } from './Text';
import { TextField } from './TextField';

/** U+2212, the same minus `formatMoney` uses. */
const MINUS = '−';

/** The read-only sign a kind puts in front of the amount (transfers show none, §6.2 rule 2). */
export const KIND_SIGN: Readonly<Record<TxKind, string | null>> = {
  expense: MINUS,
  income: '+',
  refund: '+',
  transfer: null,
};

/** Quick-add steps (decision §14.52 A19). */
export const QUICK_ADD_STEPS = [10, 50, 100] as const;

/** `'48.0000'` → `'48'`, `'30.1000'` → `'30.1'` — what the user should see in the box. */
export function trimMoney(amount: Money): string {
  if (!amount.includes('.')) return amount;
  return amount.replace(/0+$/, '').replace(/\.$/, '');
}

export interface AmountFieldProps {
  /** The raw user input, never a parsed number. */
  value: string;
  onChange(next: string): void;
  currency: string;
  /** Omit to render the currency as read-only text. */
  onCurrencyChange?(next: string): void;
  codes?: readonly string[];
  currencyNames?: Readonly<Record<string, string>>;
  /** Decides the read-only sign shown in front of the number. */
  kind?: TxKind;
  quickAdd?: boolean;
  allowExpression?: boolean;
  error?: string | null;
  label?: string;
  hint?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function AmountField({
  value,
  onChange,
  currency,
  onCurrencyChange,
  codes,
  currencyNames,
  kind,
  quickAdd = false,
  allowExpression = false,
  error,
  label,
  hint,
  disabled = false,
  autoFocus = false,
  style,
  testID,
}: AmountFieldProps): React.JSX.Element {
  const { t } = useTranslation();
  const [focused, setFocused] = React.useState(false);
  const [expression, setExpression] = React.useState<string | null>(null);
  const id = testID ?? 'amount';

  const sign = kind ? KIND_SIGN[kind] : null;
  const normalized = normalizeAmountInput(value);
  // Thousands separators would fight the caret while typing, so they only appear at rest.
  const shown = !focused && normalized !== null ? formatAmountPlain(normalized, currency) : value;

  function handleBlur(): void {
    setFocused(false);
    const raw = value.trim();
    if (!allowExpression || raw === '' || !isExpression(raw)) return;
    const evaluated = evaluateExpression(raw);
    if (evaluated === null) return;
    setExpression(raw);
    onChange(trimMoney(evaluated));
  }

  /**
   * What the box is worth right now: a plain amount, or the value of the expression in it
   * (`12.5+8.8` then `+10` must be 31.3, not 10). `null` means "nothing usable" — an empty
   * box (the caller substitutes 0) or an expression that does not evaluate.
   */
  function currentAmount(): Money | null {
    const raw = value.trim();
    if (raw === '') return null;
    const normalized = normalizeAmountInput(raw);
    if (normalized !== null) return normalized;
    return isExpression(raw) ? evaluateExpression(raw) : null;
  }

  function applyDelta(delta: number): void {
    const base = currentAmount();
    // A box that holds neither an amount nor a working expression is left exactly as it is.
    if (base === null && value.trim() !== '') return;
    onChange(trimMoney(addMoney(base ?? '0', String(delta))));
    setExpression(null);
  }

  function applyDouble(): void {
    const base = currentAmount();
    if (base === null) return;
    const doubled = evaluateExpression(`${base}*2`);
    if (doubled === null) return;
    onChange(trimMoney(doubled));
    setExpression(null);
  }

  return (
    <View style={[styles.wrap, style]}>
      <TextField
        label={label ?? t('transaction:form.amount')}
        hint={hint ?? (allowExpression ? t('transaction:form.calculator_hint') : undefined)}
        error={error}
        mono
        disabled={disabled}
        autoFocus={autoFocus}
        keyboardType="decimal-pad"
        inputMode="decimal"
        value={shown}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        accessibilityLabel={label ?? t('transaction:form.amount')}
        testID={id}
        prefix={
          sign !== null ? (
            <Text variant="subheading" tone="secondary" mono testID={`${id}-sign`}>
              {sign}
            </Text>
          ) : undefined
        }
        suffix={
          <CurrencyPicker
            codes={codes ?? [currency]}
            value={currency}
            onChange={(next) => onCurrencyChange?.(next)}
            readOnly={onCurrencyChange === undefined}
            names={currencyNames}
            variant="inline"
            disabled={disabled}
            testID={`${id}-currency`}
          />
        }
      />

      {expression !== null ? (
        <Chip
          label={expression}
          onRemove={() => setExpression(null)}
          removeLabel={t('common:button.close')}
          testID={`${id}-expression`}
        />
      ) : null}

      {quickAdd ? (
        <View
          accessibilityRole="toolbar"
          accessibilityLabel={t('transaction:form.quick_add')}
          style={styles.quickRow}
        >
          {QUICK_ADD_STEPS.map((step) => (
            <Chip
              key={step}
              label={`+${step}`}
              disabled={disabled}
              onPress={() => applyDelta(step)}
              testID={`${id}-plus-${step}`}
            />
          ))}
          <Chip
            label={t('transaction:form.quick_multiply')}
            disabled={disabled}
            onPress={applyDouble}
            testID={`${id}-double`}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space['2'], alignSelf: 'stretch' },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: space['2'], flexWrap: 'wrap' },
});
