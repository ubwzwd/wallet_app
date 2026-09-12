/**
 * The transfer tab — one form covering both shapes (04 §4.6.4, decisions §1.2 / §14.52
 * A10 / A11 / B16).
 *
 * Two legs by default; ticking "the other side isn't in this app" collapses it to a single
 * leg with a direction and a free-text counterparty. Same currency on both sides means one
 * amount box; different currencies open the second one. There is deliberately **no
 * merchant box and no category control** here.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { TransferRole, TransferSubtype } from '@/api/types';
import { maxAllowedDate } from '@/domain/dates';
import { normalizeAmountInput } from '@/domain/money';
import { formatDate } from '@/i18n/format';
import { space } from '@/theme/tokens';
import {
  AmountField,
  Button,
  Checkbox,
  Chip,
  DateField,
  SegmentedControl,
  SourcePicker,
  Text,
  TextField,
} from '@/ui';

import {
  COUNTERPARTY_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  showsSecondLeg,
  txValidationMessage,
} from './schemas';
import type { TxFormController } from './useTransactionForm';

export interface TransferFieldsProps {
  ctrl: TxFormController;
  /** "Record it as income instead" — only offered while creating (04 §4.6.4). */
  onSwitchToIncome?(): void;
  /** Editing a pair: the shape is fixed, so the single-leg checkbox is not offered. */
  lockShape?: boolean;
  /**
   * Editing a single leg: the checkbox is gone as well, because untying it would ask
   * `PATCH .../transactions/{id}` to grow a second leg — a conversion decision §1.2 does
   * not have. The direction stays editable (the PATCH sends `transfer_role` with it).
   */
  lockLegs?: boolean;
  /** "保存并再记一笔" puts the cursor straight back into the amount box (04 §4.6.5). */
  autoFocusAmount?: boolean;
  disabled?: boolean;
}

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

export function TransferFields({
  ctrl,
  onSwitchToIncome,
  lockShape = false,
  lockLegs = false,
  autoFocusAmount = false,
  disabled = false,
}: TransferFieldsProps): React.JSX.Element {
  const { t } = useTranslation();
  const {
    form,
    form: { control, formState },
    currencies,
    lang,
    selectSource,
    selectToSource,
    sources,
    values,
    allowArchivedId,
  } = ctrl;
  const { errors } = formState;
  const external = values.external && !lockShape;
  // One shared predicate with the submit path, so what is on screen is what is sent.
  const crossCurrency = showsSecondLeg({ ...values, external });
  const [repaymentHint, setRepaymentHint] = React.useState(false);

  // Choosing an account answers the hint: leaving it under the picker would go on
  // pointing at a choice the user has already corrected.
  function chooseToSource(id: string | null): void {
    setRepaymentHint(false);
    selectToSource(id);
  }

  function changeSubtype(next: TransferSubtype): void {
    form.setValue('subtype', next, { shouldDirty: true });
    if (next !== 'repayment') {
      setRepaymentHint(false);
      return;
    }
    // A repayment's receiving side is a credit card by definition (decision §14.52 A11):
    // an account that no longer qualifies is cleared, with a note saying why.
    const target = sources.find((s) => s.id === values.to_source_id);
    if (target && target.type !== 'credit') {
      form.setValue('to_source_id', '', { shouldDirty: true });
      setRepaymentHint(true);
    }
  }

  const rate = crossCurrency ? referenceRate(values.amount, values.amount_in) : null;

  return (
    <View style={styles.wrap}>
      {external && values.direction === 'in' && onSwitchToIncome ? (
        <View style={styles.banner} testID="transfer-income-suggestion">
          <Text variant="caption" tone="secondary">
            {t('transaction:transfer.suggest_income')}
          </Text>
          <Button
            testID="transfer-switch-income"
            variant="ghost"
            size="sm"
            label={t('transaction:transfer.suggest_income_action')}
            onPress={onSwitchToIncome}
          />
        </View>
      ) : null}

      <Controller
        control={control}
        name="subtype"
        render={({ field }) => (
          <SegmentedControl<TransferSubtype>
            testID="transfer-subtype"
            accessibilityLabel={t('transaction:transfer.subtype_label')}
            value={field.value}
            onChange={changeSubtype}
            options={[
              { value: 'plain', label: t('transaction:transfer.subtype.plain') },
              { value: 'repayment', label: t('transaction:transfer.subtype.repayment') },
            ]}
          />
        )}
      />
      {errors.subtype ? (
        // Only a server-side 422 can land here (the schema has no rule of its own), and a
        // message with nowhere to show would be a message the user never sees.
        <Text variant="caption" tone="danger" testID="transfer-subtype-error">
          {txValidationMessage(t, errors.subtype.message)}
        </Text>
      ) : null}

      <Controller
        control={control}
        name="source_id"
        render={({ field }) => (
          <SourcePicker
            testID="transfer-from"
            label={
              external && values.direction === 'in'
                ? t('transaction:transfer.to_source')
                : t('transaction:transfer.from_source')
            }
            sources={sources}
            value={field.value === '' ? null : field.value}
            onChange={selectSource}
            allowArchivedId={allowArchivedId}
            lang={lang}
            error={txValidationMessage(t, errors.source_id?.message)}
            disabled={disabled}
          />
        )}
      />

      {lockShape || lockLegs ? null : (
        <Checkbox
          testID="transfer-external"
          checked={values.external}
          onChange={(next) => {
            form.setValue('external', next, { shouldDirty: true });
            if (next) form.setValue('to_source_id', '', { shouldDirty: true });
          }}
          label={t('transaction:transfer.counterparty_toggle')}
          disabled={disabled}
        />
      )}

      {external ? (
        <>
          <Controller
            control={control}
            name="direction"
            render={({ field }) => (
              <SegmentedControl<TransferRole>
                testID="transfer-direction"
                accessibilityLabel={t('transaction:transfer.direction_label')}
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: 'out', label: t('transaction:transfer.role.out') },
                  { value: 'in', label: t('transaction:transfer.role.in') },
                ]}
              />
            )}
          />
          <Controller
            control={control}
            name="counterparty"
            render={({ field }) => (
              <TextField
                testID="transfer-counterparty"
                label={t('transaction:transfer.counterparty_label')}
                accessibilityLabel={t('transaction:transfer.counterparty_label')}
                value={field.value}
                onChangeText={field.onChange}
                maxLength={COUNTERPARTY_MAX_LENGTH}
                error={txValidationMessage(t, errors.counterparty?.message)}
                disabled={disabled}
              />
            )}
          />
        </>
      ) : (
        <Controller
          control={control}
          name="to_source_id"
          render={({ field }) => (
            <SourcePicker
              testID="transfer-to"
              label={t('transaction:transfer.to_source')}
              sources={sources}
              value={field.value === '' ? null : field.value}
              onChange={chooseToSource}
              filter={
                values.subtype === 'repayment' ? (source) => source.type === 'credit' : undefined
              }
              allowArchivedId={allowArchivedId}
              lang={lang}
              hint={repaymentHint ? t('transaction:transfer.repayment_target_hint') : undefined}
              error={txValidationMessage(t, errors.to_source_id?.message)}
              disabled={disabled}
            />
          )}
        />
      )}

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
                value={field.value}
                onChange={field.onChange}
                currency={currencyField.value}
                // A single leg has no other side, so its currency is the account's,
                // read-only (decision §14.52 A11).
                onCurrencyChange={external ? undefined : currencyField.onChange}
                codes={currencies.codes}
                currencyNames={currencies.names}
                quickAdd
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

      {external ? (
        <Text variant="caption" tone="muted" testID="transfer-currency-locked-hint">
          {t('transaction:transfer.counterparty_currency_locked_hint')}
        </Text>
      ) : null}

      {crossCurrency ? (
        <>
          {rate !== null ? (
            <Chip
              testID="transfer-rate"
              label={t('transaction:transfer.rate_readonly_hint', {
                from: values.currency,
                rate,
                to: values.currency_in,
                date: formatDate(values.occurred_at, lang),
              })}
            />
          ) : null}
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
          <Text variant="caption" tone="muted">
            {t('transaction:transfer.fee_hint')}
          </Text>
        </>
      ) : null}

      <Controller
        control={control}
        name="occurred_at"
        render={({ field }) => (
          <DateField
            testID="transfer-date"
            label={t('transaction:form.date')}
            value={field.value}
            onChange={field.onChange}
            max={maxAllowedDate()}
            error={txValidationMessage(t, errors.occurred_at?.message)}
            disabled={disabled}
          />
        )}
      />

      <Controller
        control={control}
        name="note"
        render={({ field }) => (
          <TextField
            testID="transfer-note"
            label={t('transaction:form.note')}
            accessibilityLabel={t('transaction:form.note')}
            value={field.value}
            onChangeText={field.onChange}
            multiline
            maxLength={NOTE_MAX_LENGTH}
            showCounter
            error={txValidationMessage(t, errors.note?.message)}
            disabled={disabled}
          />
        )}
      />

      {external ? (
        <Text variant="caption" tone="muted" testID="transfer-single-leg-hint">
          {t('transaction:transfer.single_leg_hint')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space['3'], alignSelf: 'stretch' },
  banner: { gap: space['1'] },
});
