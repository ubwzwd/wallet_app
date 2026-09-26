/**
 * The four fields of the account form, laid out the way 屏幕稿 09 draws them: 名称, the 类型
 * blocks, 币种 (with the quick chips and the "locked once saved" note) and 期初余额 in the
 * mockup's tinted amount well. Wide puts 币种 and 期初余额 side by side; narrow stacks them.
 * Under them, 「共享到」 (decision §14.62): a chip per ledger I belong to, multi-select.
 *
 * Presentation only — every rule behind these fields (the locked currency of decision
 * §14.50, the positive-debt entry of §14.52 A13, the duplicate-name hint) is decided by
 * `SourceFormScreen` and arrives as a prop.
 */
import React from 'react';
import { View } from 'react-native';
import { Controller, type Control, type FieldErrors } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { Ledger, SourceType } from '@/api/types';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { AmountField, Chip, CurrencyPicker, Text, TextField } from '@/ui';

import { SOURCE_NAME_MAX_LENGTH, sourceValidationMessage, type SourceFormValues } from './schemas';
import { ShareChips } from './ShareChips';
import { TypePicker } from './TypePicker';

export interface SourceFormFieldsProps {
  control: Control<SourceFormValues>;
  errors: FieldErrors<SourceFormValues>;
  isEdit: boolean;
  busy: boolean;
  wide: boolean;
  type: SourceType;
  onTypeChange(next: SourceType): void;
  /** Another account already carries the typed name — a hint, never an error (01-6). */
  duplicateName: boolean;
  currencyCodes: readonly string[];
  currencyNames: Readonly<Record<string, string>>;
  /** The currency the amount well is denominated in (the picked one, or the ledger's). */
  currency: string;
  /** Shortcut chips over the full picker (屏幕稿 09: CNY / SGD / USD). */
  quickCurrencies: readonly string[];
  /** Every ledger I belong to — the 「共享到」 chips. */
  ledgers: readonly Ledger[];
  /** The 已归档 switch, rendered by the screen because it mutates on its own. */
  archivedSwitch?: React.ReactNode;
}

export function SourceFormFields(props: SourceFormFieldsProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const { control, errors, isEdit, busy, wide } = props;
  const isCredit = props.type === 'credit';

  const currencyField = (
    <Controller
      control={control}
      name="default_currency"
      render={({ field }) => (
        <View style={{ gap: space['2'], flex: wide ? 1 : undefined, minWidth: 0 }}>
          {isEdit ? (
            <Text variant="caption" tone="secondary">
              {t('source:form.currency_label')}
            </Text>
          ) : null}
          <CurrencyPicker
            testID="source-currency"
            label={t('source:form.currency_label')}
            codes={props.currencyCodes}
            names={props.currencyNames}
            value={field.value === '' ? null : field.value}
            onChange={field.onChange}
            readOnly={isEdit}
            error={sourceValidationMessage(t, errors.default_currency?.message)}
            disabled={busy}
          />
          {isEdit ? null : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] - 2 }}>
              {props.quickCurrencies.map((code) => (
                <Chip
                  key={code}
                  label={code}
                  selected={code === field.value}
                  disabled={busy}
                  onPress={() => field.onChange(code)}
                  testID={`source-currency-quick-${code}`}
                />
              ))}
            </View>
          )}
          <Text
            variant="caption"
            tone="muted"
            testID={isEdit ? 'source-currency-locked' : 'source-currency-hint'}
          >
            {t('source:form.currency_locked_hint')}
          </Text>
        </View>
      )}
    />
  );

  const openingField = (
    <Controller
      control={control}
      name="opening_balance"
      render={({ field }) => (
        <View style={{ gap: space['1'], flex: wide ? 1.15 : undefined, minWidth: 0 }}>
          <AmountField
            testID="source-opening-balance"
            size="lg"
            label={
              isCredit
                ? t('source:form.credit_debt_label')
                : t('source:form.opening_balance_label')
            }
            value={field.value}
            onChange={field.onChange}
            currency={props.currency}
            hint={isCredit ? t('source:form.credit_debt_hint') : undefined}
            error={sourceValidationMessage(t, errors.opening_balance?.message)}
            disabled={busy}
          />
        </View>
      )}
    />
  );

  const shareField = (
    <Controller
      control={control}
      name="share_to"
      render={({ field }) => (
        <View style={{ gap: space['2'] }} testID="source-share-field">
          <Text variant="caption" tone="secondary">
            {t('source:share.column')}
          </Text>
          {props.ledgers.length === 0 ? (
            <Text variant="caption" tone="muted" testID="source-share-none">
              {t('source:share.no_ledgers')}
            </Text>
          ) : (
            <ShareChips
              ledgers={props.ledgers}
              isShared={(lid) => field.value.includes(lid)}
              onToggle={(ledger) =>
                field.onChange(
                  field.value.includes(ledger.id)
                    ? field.value.filter((id) => id !== ledger.id)
                    : [...field.value, ledger.id],
                )
              }
              disabled={busy}
              testID="source-share"
            />
          )}
          <Text variant="caption" tone="muted" testID="source-share-hint">
            {t('source:share.hint')}
          </Text>
        </View>
      )}
    />
  );

  return (
    <View style={{ gap: space['5'], alignSelf: 'stretch' }}>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextField
            testID="source-name"
            label={t('source:form.name_label')}
            placeholder={t('source:form.name_placeholder')}
            accessibilityLabel={t('source:form.name_label')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={sourceValidationMessage(t, errors.name?.message)}
            hint={
              props.duplicateName
                ? t('source:form.name_duplicate_hint')
                : t('source:form.name_hint')
            }
            disabled={busy}
            maxLength={SOURCE_NAME_MAX_LENGTH}
            showCounter
          />
        )}
      />

      <View style={{ gap: space['2'] }}>
        <Text variant="caption" tone="secondary">
          {t('source:form.type_label')}
        </Text>
        <TypePicker
          value={props.type}
          onChange={props.onTypeChange}
          disabled={busy}
          label={t('source:form.type_label')}
        />
      </View>

      {wide ? (
        <View style={{ flexDirection: 'row', gap: space['5'], alignItems: 'flex-start' }}>
          {currencyField}
          {openingField}
        </View>
      ) : (
        <>
          {currencyField}
          {openingField}
        </>
      )}

      {shareField}

      {props.archivedSwitch}

      <View
        style={{
          padding: space['4'] - 2,
          borderRadius: radius.md,
          backgroundColor: colors['bg.subtle'],
        }}
      >
        <Text variant="caption" tone="secondary" testID="source-opening-balance-hint">
          {t('source:form.opening_balance_hint')}
        </Text>
      </View>
    </View>
  );
}
