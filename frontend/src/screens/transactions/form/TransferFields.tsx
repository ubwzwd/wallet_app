/**
 * The transfer tab — one form covering both shapes (04 §4.6.4, decisions §1.2 / §14.52
 * A10 / A11 / B16), laid out as mockup 05 draws it: the two account rows side by side with
 * a round arrow between them, then one 金额 block that grows a second box only when the
 * two sides really are in different currencies.
 *
 * Ticking 「不在应用里」 collapses the pair to a single leg: the side that is not an account
 * becomes a free-text counterparty, the currency follows the remaining account and the
 * 「跨币种」 badge turns into 「单腿 · 只填一次」. There is deliberately **no merchant box and
 * no category control** here.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { TransferRole, TransferSubtype } from '@/api/types';
import { maxAllowedDate } from '@/domain/dates';
import { controls, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Chip, Icon, SegmentedControl, Text, TextField } from '@/ui';

import { DateRowField } from './DateRowField';
import { SourceField } from './SourceField';
import { TransferAmount } from './TransferAmount';
import { FieldColumns, FieldLabel, FormCard } from './parts';
import {
  COUNTERPARTY_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  showsSecondLeg,
  txValidationMessage,
} from './schemas';
import type { TxFormController } from './useTransactionForm';

export interface TransferFieldsProps {
  ctrl: TxFormController;
  /** The kind tabs; they share the card's first row with the subtype control. */
  header?: React.ReactNode;
  /** "Record it as income instead" — only offered while creating (04 §4.6.4). */
  onSwitchToIncome?(): void;
  /** Editing a pair: the shape is fixed, so the single-leg toggle is not offered. */
  lockShape?: boolean;
  /**
   * Editing a single leg: the toggle is gone as well, because untying it would ask
   * `PATCH .../transactions/{id}` to grow a second leg — a conversion decision §1.2 does
   * not have. The direction stays editable (the PATCH sends `transfer_role` with it).
   */
  lockLegs?: boolean;
  /** "保存并再记一笔" puts the cursor straight back into the amount box (04 §4.6.5). */
  autoFocusAmount?: boolean;
  disabled?: boolean;
}

export { referenceRate } from './TransferAmount';

export function TransferFields({
  ctrl,
  header,
  onSwitchToIncome,
  lockShape = false,
  lockLegs = false,
  autoFocusAmount = false,
  disabled = false,
}: TransferFieldsProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const {
    form,
    form: { control, formState },
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

  /** The single leg's free-text side is whichever end is not the account. */
  const outIsAccount = !external || values.direction === 'out';

  // Both legs' labels must sit on the same line, and the 「不在应用里」 chip is taller than a
  // bare label — so the leg that does not carry it reserves the same height.
  const legSpacer = <View style={styles.legSpacer} />;

  const externalToggle =
    lockShape || lockLegs ? null : (
      <Chip
        testID="transfer-external"
        label={t('transaction:form.transfer_external_toggle')}
        icon={values.external ? 'check' : undefined}
        selected={values.external}
        disabled={disabled}
        onPress={() => {
          const next = !values.external;
          form.setValue('external', next, { shouldDirty: true });
          if (next) form.setValue('to_source_id', '', { shouldDirty: true });
        }}
      />
    );

  const accountLeg = (
    <Controller
      control={control}
      name="source_id"
      render={({ field }) => (
        <SourceField
          testID="transfer-from"
          label={
            outIsAccount
              ? t('transaction:transfer.from_source')
              : t('transaction:transfer.to_source')
          }
          labelRight={external ? legSpacer : (externalToggle ?? legSpacer)}
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

  const toLeg = (
    <Controller
      control={control}
      name="to_source_id"
      render={({ field }) => (
        <SourceField
          testID="transfer-to"
          label={t('transaction:transfer.to_source')}
          labelRight={legSpacer}
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
  );

  const counterpartyLeg = (
    <View>
      <FieldLabel
        label={
          outIsAccount
            ? t('transaction:form.transfer_counterparty_in')
            : t('transaction:form.transfer_counterparty_out')
        }
        right={externalToggle ?? legSpacer}
      />
      <Controller
        control={control}
        name="counterparty"
        render={({ field }) => (
          <TextField
            testID="transfer-counterparty"
            accessibilityLabel={t('transaction:transfer.counterparty_label')}
            placeholder={t('transaction:transfer.counterparty_label')}
            value={field.value}
            onChangeText={field.onChange}
            maxLength={COUNTERPARTY_MAX_LENGTH}
            error={txValidationMessage(t, errors.counterparty?.message)}
            disabled={disabled}
          />
        )}
      />
      <Text variant="caption" tone="muted" style={styles.counterpartyHint}>
        {t('transaction:form.transfer_counterparty_hint')}
      </Text>
      <Controller
        control={control}
        name="direction"
        render={({ field }) => (
          <SegmentedControl<TransferRole>
            testID="transfer-direction"
            size="sm"
            accessibilityLabel={t('transaction:transfer.direction_label')}
            value={field.value}
            onChange={field.onChange}
            options={[
              { value: 'out', label: t('transaction:transfer.role.out') },
              { value: 'in', label: t('transaction:transfer.role.in') },
            ]}
            style={styles.direction}
          />
        )}
      />
    </View>
  );

  const arrow = (
    <View style={styles.arrowSlot}>
      <View style={[styles.arrow, { backgroundColor: colors['bg.subtle'] }]}>
        <Icon
          // 屏幕稿 05: a real arrow in the disc, pointing the way the two fields sit.
          name={wide ? 'arrow-right' : 'arrow-down'}
          size={18}
          color={colors['fg.secondary']}
        />
      </View>
    </View>
  );

  const body = (
    <>
      <View style={wide ? styles.kindRow : styles.kindStack}>
        {header ? <View style={wide ? styles.grow : undefined}>{header}</View> : null}
        <Controller
          control={control}
          name="subtype"
          render={({ field }) => (
            <SegmentedControl<TransferSubtype>
              testID="transfer-subtype"
              accessibilityLabel={t('transaction:transfer.subtype_label')}
              value={field.value}
              onChange={changeSubtype}
              stretch={!wide}
              options={[
                {
                  value: 'plain',
                  label: t('transaction:transfer.subtype.plain'),
                  icon: 'arrow-left-right',
                },
                {
                  value: 'repayment',
                  label: t('transaction:transfer.subtype.repayment'),
                  icon: 'credit-card',
                },
              ]}
            />
          )}
        />
      </View>
      {errors.subtype ? (
        // Only a server-side 422 can land here (the schema has no rule of its own), and a
        // message with nowhere to show would be a message the user never sees.
        <Text variant="caption" tone="danger" testID="transfer-subtype-error">
          {txValidationMessage(t, errors.subtype.message)}
        </Text>
      ) : null}

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

      <View style={wide ? styles.legsWide : styles.legsNarrow}>
        <View style={styles.grow}>{outIsAccount ? accountLeg : counterpartyLeg}</View>
        {arrow}
        <View style={styles.grow}>{outIsAccount ? (external ? counterpartyLeg : toLeg) : accountLeg}</View>
      </View>

      <TransferAmount
        ctrl={ctrl}
        crossCurrency={crossCurrency}
        external={external}
        autoFocusAmount={autoFocusAmount}
        disabled={disabled}
      />

      <FieldColumns ratio={0.8}>
        <Controller
          control={control}
          name="occurred_at"
          render={({ field }) => (
            <DateRowField
              testID="transfer-date"
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
                testID="transfer-note"
                accessibilityLabel={t('transaction:form.note')}
                placeholder={t('transaction:form.transfer_note_placeholder')}
                value={field.value}
                onChangeText={field.onChange}
                maxLength={NOTE_MAX_LENGTH}
                error={txValidationMessage(t, errors.note?.message)}
                disabled={disabled}
              />
            )}
          />
        </View>
      </FieldColumns>

      {/* 屏幕稿 05 单腿 says this once. On a wide screen the amber card in 「这一笔」
          already carries the sentence, so only the narrow frame — which has no right
          column — repeats it at the bottom of the main card. */}
      {external && !wide ? (
        <Text variant="caption" tone="muted" testID="transfer-single-leg-hint">
          {t('transaction:transfer.single_leg_hint')}
        </Text>
      ) : null}
    </>
  );

  return <FormCard style={styles.card}>{body}</FormCard>;
}

const styles = StyleSheet.create({
  card: { gap: space['5'], alignSelf: 'stretch' },
  grow: { flex: 1, minWidth: 0 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: space['3'], flexWrap: 'wrap' },
  kindStack: { gap: space['3'], alignSelf: 'stretch' },
  banner: { gap: space['1'] },
  legsWide: { flexDirection: 'row', alignItems: 'flex-start', gap: space['3'] },
  legsNarrow: { gap: space['2'] },
  // The arrow lines up with the middle of the two account rows, below their labels.
  arrowSlot: { alignItems: 'center', justifyContent: 'center', paddingTop: space['8'] + 4 },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterpartyHint: { marginTop: space['1'] + 2 },
  legSpacer: { height: controls.chip.height },
  direction: { marginTop: space['2'] },
});
