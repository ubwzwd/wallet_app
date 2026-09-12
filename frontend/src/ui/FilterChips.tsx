/**
 * The row of active filters under the transaction list's filter bar (04 §4.5, §6.2 rule 4):
 * round, dismissible `Chip`s — one per active condition — plus "清空筛选".
 *
 * A `key` may appear more than once (two kinds, three accounts), so removal is addressed by
 * `(key, value)`, which is exactly what the URL query needs.
 */
import React from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { space } from '@/theme/tokens';
import { Chip } from './Chip';

export interface FilterChip {
  /** The query parameter, e.g. `kind` or `source_id`. */
  key: string;
  value: string;
  label: string;
}

export interface FilterChipsProps {
  chips: readonly FilterChip[];
  onRemove(key: string, value: string): void;
  onClear(): void;
  /** Hides the "clear all" chip when only one filter is active. */
  clearFrom?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function FilterChips({
  chips,
  onRemove,
  onClear,
  clearFrom = 2,
  style,
  testID,
}: FilterChipsProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const id = testID ?? 'filter-chips';

  if (chips.length === 0) return null;

  return (
    <View testID={id} style={[styles.row, style]}>
      {chips.map((chip) => (
        <Chip
          key={`${chip.key}:${chip.value}`}
          label={chip.label}
          onRemove={() => onRemove(chip.key, chip.value)}
          // The × needs an accessible name that says what pressing it *does*; repeating the
          // chip's own text tells a screen reader nothing. `filter.remove_filter` is not in
          // the language pack yet, so until it lands the action word comes from `common`.
          removeLabel={t('transaction:list.filter.remove_filter', {
            label: chip.label,
            defaultValue: `${t('common:button.close')} ${chip.label}`,
          })}
          testID={`${id}-${chip.key}-${chip.value}`}
        />
      ))}
      {chips.length >= clearFrom ? (
        <Chip
          label={t('transaction:list.filter.clear_filters')}
          icon="x"
          onPress={onClear}
          testID={`${id}-clear`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space['2'] },
});
