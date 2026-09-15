/**
 * The chrome around `TransactionPicker`'s candidate list (mockup 06): the search / account
 * / date-range row, the 「默认条件」 chip row under it, and the footer that says what is
 * currently chosen.
 *
 * It lives next to the picker rather than inside it only because 04 §6 caps a file at 400
 * lines; it has no state of its own — the picker owns the filters and hands them down.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { FinanceSource, TransactionListParams } from '@/api/types';
import type { Lang } from '@/i18n';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Badge, Button, Chip, DateField, Icon, SourcePicker, Text, TextField } from '@/ui';

export interface PickerFilterValues {
  q: string;
  source_id: string | null;
  from: string;
  to: string;
}

export interface PickerFiltersProps {
  id: string;
  wide: boolean;
  lang: Lang;
  filters: PickerFilterValues;
  onChange(next: (current: PickerFilterValues) => PickerFilterValues): void;
  sources: readonly FinanceSource[];
  /** Conditions the caller pinned; they are labels, never chips (decision §14.52 B11). */
  fixed: Partial<TransactionListParams>;
  /** An extra condition the caller owns — the refund tab's 「还有可退余额」 chip. */
  toolbar?: React.ReactNode;
}

export function PickerFilters({
  id,
  wide,
  lang,
  filters,
  onChange,
  sources,
  fixed,
  toolbar,
}: PickerFiltersProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();

  const conditions: React.ReactNode[] = [];
  if (fixed.kind && fixed.kind.length > 0) {
    conditions.push(
      <Badge
        key="kind"
        icon="tag"
        tone="neutral"
        testID={`${id}-fixed`}
        label={t('transaction:picker.fixed_kind', {
          kinds: fixed.kind.map((k) => t(`transaction:kind.${k}`)).join(' / '),
        })}
      />,
    );
  }
  const sourceName = sources.find((s) => s.id === filters.source_id)?.name;
  if (filters.source_id !== null && sourceName !== undefined) {
    conditions.push(
      <Chip
        key="source"
        variant="solid"
        label={sourceName}
        onRemove={() => onChange((f) => ({ ...f, source_id: null }))}
        removeLabel={t('common:button.close')}
        testID={`${id}-condition-source`}
      />,
    );
  }
  if (filters.from !== '' || filters.to !== '') {
    conditions.push(
      <Chip
        key="range"
        variant="solid"
        label={`${filters.from === '' ? '…' : filters.from} → ${filters.to === '' ? '…' : filters.to}`}
        onRemove={() => onChange((f) => ({ ...f, from: '', to: '' }))}
        removeLabel={t('common:button.close')}
        testID={`${id}-condition-range`}
      />,
    );
  }
  if (toolbar) conditions.push(<View key="toolbar">{toolbar}</View>);

  return (
    <>
      <View style={wide ? styles.rowWide : styles.rowNarrow}>
        <View style={styles.grow}>
          <TextField
            testID={`${id}-search`}
            value={filters.q}
            onChangeText={(q) => onChange((f) => ({ ...f, q }))}
            placeholder={t('transaction:picker.search_placeholder')}
            accessibilityLabel={t('transaction:picker.search_placeholder')}
            prefix={<Icon name="search" size={16} color={colors['fg.muted']} />}
          />
        </View>
        <SourcePicker
          testID={`${id}-source`}
          sources={sources}
          value={filters.source_id}
          onChange={(source_id) => onChange((f) => ({ ...f, source_id }))}
          lang={lang}
          style={styles.grow}
        />
        <View style={styles.dates}>
          <DateField
            testID={`${id}-from`}
            label={t('transaction:picker.date_from')}
            value={filters.from}
            onChange={(from) => onChange((f) => ({ ...f, from }))}
            style={styles.grow}
          />
          <DateField
            testID={`${id}-to`}
            label={t('transaction:picker.date_to')}
            value={filters.to}
            onChange={(to) => onChange((f) => ({ ...f, to }))}
            style={styles.grow}
          />
        </View>
      </View>
      {conditions.length > 0 ? (
        <View style={styles.conditions}>
          <Text variant="caption" tone="muted">
            {t('transaction:form.picker_default_filters')}
          </Text>
          {conditions}
        </View>
      ) : null}
    </>
  );
}

export interface PickerFooterProps {
  id: string;
  wide: boolean;
  /** 「已选：…」 once a row is chosen, otherwise the grey explainer. */
  note: string;
  confirmLabel: string;
  confirmDisabled: boolean;
  onConfirm(): void;
  clearLabel?: string;
  onClear?(): void;
}

export function PickerFooter({
  id,
  wide,
  note,
  confirmLabel,
  confirmDisabled,
  onConfirm,
  clearLabel,
  onClear,
}: PickerFooterProps): React.JSX.Element {
  const colors = useColors();
  return (
    <View
      style={[
        styles.footer,
        {
          borderTopColor: colors['border.default'],
          paddingHorizontal: wide ? space['5'] : 0,
        },
      ]}
    >
      <Text variant="caption" tone="muted" style={styles.grow} numberOfLines={2}>
        {note}
      </Text>
      {onClear && clearLabel !== undefined ? (
        <Button testID={`${id}-clear`} variant="soft" label={clearLabel} onPress={onClear} />
      ) : null}
      <Button
        testID={`${id}-confirm`}
        label={confirmLabel}
        disabled={confirmDisabled}
        onPress={onConfirm}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  rowWide: { flexDirection: 'row', gap: space['3'], alignItems: 'flex-start' },
  rowNarrow: { gap: space['2'] },
  dates: { flexDirection: 'row', gap: space['2'], flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  conditions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space['2'] },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    flexWrap: 'wrap',
    paddingTop: space['3'],
    marginTop: space['3'],
    borderTopWidth: 1,
  },
});
