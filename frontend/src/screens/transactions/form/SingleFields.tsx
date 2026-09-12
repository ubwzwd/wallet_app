/**
 * The fields expense / income / refund share (04 §4.6.1–§4.6.3): account, amount, date,
 * category, merchant and note.
 *
 * Transfers do **not** come through here — they have no category and no merchant box at
 * all (decision §14.52 B16, 04 §6.5.2 row 14) and get `TransferFields` instead.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { maxAllowedDate } from '@/domain/dates';
import { space } from '@/theme/tokens';
import { AmountField, CategoryPicker, DateField, Skeleton, SourcePicker, TextField } from '@/ui';

import { MerchantField } from './MerchantField';
import { NOTE_MAX_LENGTH, txValidationMessage } from './schemas';
import type { TxFormController } from './useTransactionForm';

export interface SingleFieldsProps {
  ctrl: TxFormController;
  /** Refund-only block that must sit right above the amount box (04 §4.6.3). */
  aboveAmount?: React.ReactNode;
  /** Rendered under the amount box — the over-refund warning. */
  belowAmount?: React.ReactNode;
  /** "保存并再记一笔" puts the cursor straight back into the amount box (04 §4.6.5). */
  autoFocusAmount?: boolean;
  disabled?: boolean;
}

export function SingleFields({
  ctrl,
  aboveAmount,
  belowAmount,
  autoFocusAmount = false,
  disabled = false,
}: SingleFieldsProps): React.JSX.Element {
  const { t } = useTranslation();
  const {
    form: { control, formState },
    currencies,
    index,
    kind,
    lang,
    recentCategories,
    recentMerchants,
    selectSource,
    sources,
    allowArchivedId,
  } = ctrl;
  const { errors } = formState;

  return (
    <View style={styles.wrap}>
      <Controller
        control={control}
        name="source_id"
        render={({ field }) => (
          <SourcePicker
            testID="tx-source"
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

      {aboveAmount}

      <Controller
        control={control}
        name="amount"
        render={({ field }) => (
          <Controller
            control={control}
            name="currency"
            render={({ field: currencyField }) => (
              <AmountField
                testID="tx-amount"
                value={field.value}
                onChange={field.onChange}
                currency={currencyField.value}
                onCurrencyChange={currencyField.onChange}
                codes={currencies.codes}
                currencyNames={currencies.names}
                kind={kind}
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

      {belowAmount}

      <Controller
        control={control}
        name="occurred_at"
        render={({ field }) => (
          <DateField
            testID="tx-date"
            label={t('transaction:form.date')}
            value={field.value}
            onChange={field.onChange}
            max={maxAllowedDate()}
            error={txValidationMessage(t, errors.occurred_at?.message)}
            disabled={disabled}
          />
        )}
      />

      {index === null ? (
        <Skeleton variant="row" testID="tx-category-loading" />
      ) : (
        <Controller
          control={control}
          name="category_l1"
          render={({ field }) => (
            <Controller
              control={control}
              name="category_l2"
              render={({ field: l2Field }) => (
                <CategoryPicker
                  testID="tx-category"
                  index={index}
                  kind={kind}
                  lang={lang}
                  recent={recentCategories}
                  value={{ l1: field.value, l2: l2Field.value }}
                  onChange={(next) => {
                    field.onChange(next.l1);
                    l2Field.onChange(next.l2);
                  }}
                  error={txValidationMessage(t, errors.category_l1?.message)}
                  disabled={disabled}
                />
              )}
            />
          )}
        />
      )}

      <Controller
        control={control}
        name="merchant"
        render={({ field }) => (
          <MerchantField
            testID="tx-merchant"
            value={field.value}
            onChange={field.onChange}
            recent={recentMerchants}
            categoryL1={ctrl.values.category_l1}
            disabled={disabled}
            error={txValidationMessage(t, errors.merchant?.message)}
          />
        )}
      />

      <Controller
        control={control}
        name="note"
        render={({ field }) => (
          <TextField
            testID="tx-note"
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space['3'], alignSelf: 'stretch' },
});
