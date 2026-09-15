/**
 * The expense / income / refund body (04 §4.6.1–§4.6.3), laid out the way mockups 04 and
 * 06 draw it: one white card holding the kind tabs, the headline amount next to the date,
 * the account row and the merchant / note pair, then the category card underneath.
 *
 * Narrow screens stack the same blocks as separate cards (amount · account+date ·
 * category · merchant+note), which is mockup 04's 375 frame.
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
import { useIsWide } from '@/theme/useBreakpoint';
import { AmountField, DateField, Skeleton, TextField } from '@/ui';

import { CategoryCard } from './CategoryCard';
import { MerchantField } from './MerchantField';
import { SourceField } from './SourceField';
import { FieldColumns, FieldLabel, FormCard } from './parts';
import { NOTE_MAX_LENGTH, txValidationMessage } from './schemas';
import type { TxFormController } from './useTransactionForm';

export interface SingleFieldsProps {
  ctrl: TxFormController;
  /** The kind tabs; they sit inside the first card on a wide screen (mockup 04). */
  header?: React.ReactNode;
  /** Refund-only block: the linked original, right under the amount (mockup 06). */
  belowAmount?: React.ReactNode;
  /** Rendered directly under the amount box — the over-refund warning. */
  amountNote?: React.ReactNode;
  /** Replaces the `+10 / +50 / +100 / ×2` chips (the refund tab brings its own). */
  amountChips?: React.ReactNode;
  /** "保存并再记一笔" puts the cursor straight back into the amount box (04 §4.6.5). */
  autoFocusAmount?: boolean;
  disabled?: boolean;
}

export function SingleFields({
  ctrl,
  header,
  belowAmount,
  amountNote,
  amountChips,
  autoFocusAmount = false,
  disabled = false,
}: SingleFieldsProps): React.JSX.Element {
  const { t } = useTranslation();
  const wide = useIsWide();
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

  const amount = (
    <View>
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
                size="lg"
                label={
                  kind === 'refund' ? t('transaction:form.amount_refund') : t('transaction:form.amount')
                }
                value={field.value}
                onChange={field.onChange}
                currency={currencyField.value}
                onCurrencyChange={currencyField.onChange}
                codes={currencies.codes}
                currencyNames={currencies.names}
                kind={kind}
                quickAdd={amountChips === undefined}
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
      {amountChips}
      {amountNote}
    </View>
  );

  const date = (
    <Controller
      control={control}
      name="occurred_at"
      render={({ field }) => (
        <DateField
          testID="tx-date"
          label={t('transaction:form.date')}
          todayLabel={t('transaction:form.today')}
          value={field.value}
          onChange={field.onChange}
          max={maxAllowedDate()}
          error={txValidationMessage(t, errors.occurred_at?.message)}
          disabled={disabled}
        />
      )}
    />
  );

  const account = (
    <Controller
      control={control}
      name="source_id"
      render={({ field }) => (
        <SourceField
          testID="tx-source"
          label={t('transaction:form.source')}
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
  );

  const merchant = (
    <Controller
      control={control}
      name="merchant"
      render={({ field }) => (
        <MerchantField
          testID="tx-merchant"
          value={field.value}
          onChange={field.onChange}
          placeholder={t('transaction:form.merchant_placeholder')}
          recent={recentMerchants}
          categoryL1={ctrl.values.category_l1}
          disabled={disabled}
          error={txValidationMessage(t, errors.merchant?.message)}
        />
      )}
    />
  );

  const note = (
    <View>
      <FieldLabel
        label={t('transaction:form.note')}
        optional={t('transaction:form.optional')}
      />
      <Controller
        control={control}
        name="note"
        render={({ field }) => (
          <TextField
            testID="tx-note"
            accessibilityLabel={t('transaction:form.note')}
            placeholder={t('transaction:form.note_placeholder')}
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

  const category =
    index === null ? (
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
              <CategoryCard
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
    );

  if (wide) {
    return (
      <View style={styles.wide}>
        <FormCard style={styles.mainCard}>
          {header}
          <FieldColumns ratio={1.25}>
            {amount}
            {date}
          </FieldColumns>
          {belowAmount}
          {account}
          <FieldColumns>
            {merchant}
            {note}
          </FieldColumns>
        </FormCard>
        {category}
      </View>
    );
  }

  return (
    <View style={styles.narrow}>
      {header}
      <FormCard>{amount}</FormCard>
      {belowAmount}
      <FormCard style={styles.rowCard}>
        {account}
        {date}
      </FormCard>
      {category}
      <FormCard style={styles.rowCard}>
        {merchant}
        {note}
      </FormCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wide: { gap: space['5'], alignSelf: 'stretch' },
  narrow: { gap: space['3'], alignSelf: 'stretch' },
  mainCard: { gap: space['5'] },
  rowCard: { gap: space['3'] },
});
