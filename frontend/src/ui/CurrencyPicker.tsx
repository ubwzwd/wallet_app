/**
 * Currency picker (04 §6.4). Two shapes, one behaviour:
 *  - `field`  — a full-width `Select` row, used by the account form and the filter bar;
 *  - `inline` — the compact `CNY ⌄` trigger embedded in `AmountField`.
 * Read-only mode (single-leg transfers, 04 §4.6.4) shows the code alone, no affordance.
 */
import React from 'react';
import {
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon } from './Icon';
import { Select } from './Select';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { TextField } from './TextField';

export interface CurrencyPickerProps {
  codes: readonly string[];
  value: string | null;
  onChange(next: string): void;
  /** Renders the code as plain text — the currency is decided elsewhere. */
  readOnly?: boolean;
  /** `code → English name` from `GET /rates/currencies`; shown as the option's hint. */
  names?: Readonly<Record<string, string>>;
  variant?: 'field' | 'inline';
  label?: string;
  error?: string | null;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function CurrencyPicker({
  codes,
  value,
  onChange,
  readOnly = false,
  names,
  variant = 'field',
  label,
  error,
  disabled = false,
  style,
  testID,
}: CurrencyPickerProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const fieldLabel = label ?? t('transaction:form.currency');
  const id = testID ?? 'currency';

  if (readOnly) {
    return (
      <View style={style}>
        <Text variant="subheading" tone="secondary" mono testID={id}>
          {value ?? ''}
        </Text>
      </View>
    );
  }

  if (variant === 'field') {
    return (
      <Select
        testID={id}
        label={fieldLabel}
        placeholder={fieldLabel}
        closeLabel={t('common:button.close')}
        searchable
        searchPlaceholder={fieldLabel}
        emptyLabel={t('common:status.none')}
        options={codes.map((code) => ({
          value: code,
          label: code,
          hint: names?.[code],
        }))}
        value={value}
        onChange={(next) => {
          if (next !== null) onChange(next);
        }}
        error={error}
        disabled={disabled}
        style={style}
      />
    );
  }

  const visible = codes.filter((code) => {
    const q = query.trim().toLowerCase();
    if (q === '') return true;
    return code.toLowerCase().includes(q) || (names?.[code]?.toLowerCase().includes(q) ?? false);
  });

  return (
    <View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fieldLabel}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        hitSlop={space['2']}
        testID={`${id}-trigger`}
        style={styles.inlineTrigger}
      >
        <Text variant="subheading" tone="secondary" mono>
          {value ?? ''}
        </Text>
        <Icon name="chevron-down" size={16} color={colors['fg.muted']} />
      </Pressable>
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          setQuery('');
        }}
        title={fieldLabel}
        closeLabel={t('common:button.close')}
        testID={`${id}-sheet`}
      >
        <View style={styles.list}>
          <TextField
            value={query}
            onChangeText={setQuery}
            placeholder={fieldLabel}
            accessibilityLabel={fieldLabel}
            prefix={<Icon name="search" size={16} color={colors['fg.muted']} />}
            testID={`${id}-search`}
          />
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            {visible.length === 0 ? (
              <Text variant="body" tone="muted" style={{ padding: density.rowInnerPadding }}>
                {t('common:status.none')}
              </Text>
            ) : null}
            {visible.map((code) => (
              <Pressable
                key={code}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: code === value }}
                accessibilityLabel={code}
                onPress={() => {
                  onChange(code);
                  setOpen(false);
                  setQuery('');
                }}
                testID={`${id}-option-${code}`}
                style={({ pressed }) => [
                  styles.option,
                  {
                    backgroundColor:
                      code === value
                        ? colors['bg.selected']
                        : pressed
                          ? colors['bg.hover']
                          : 'transparent',
                  },
                ]}
              >
                <Text variant="body" mono>
                  {code}
                </Text>
                {names?.[code] !== undefined ? (
                  <Text variant="caption" tone="muted" numberOfLines={1} style={styles.optionHint}>
                    {names[code]}
                  </Text>
                ) : null}
                {code === value ? (
                  <Icon name="check" size={18} color={colors['accent.solid']} />
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  inlineTrigger: { flexDirection: 'row', alignItems: 'center', gap: space['1'] },
  list: { gap: space['2'], maxHeight: 360 },
  scroll: { flexGrow: 0 },
  option: {
    minHeight: density.listRowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    paddingHorizontal: space['3'],
    borderRadius: radius.md,
  },
  optionHint: { flex: 1 },
});
