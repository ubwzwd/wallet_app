/**
 * The two-column fact list a detail page ends with (mockups 07 / 08: 日期 / 分类 / 账户 /
 * 原币金额 / 折算 / 备注 / 记录人).
 *
 * A fixed label column on the left in `fg.secondary`, the value on the right in
 * `fg.primary`, 48 per row, a hairline between rows, the whole thing inside a white card.
 * Values that are numbers or dates ask for `mono` so the column reads as a column.
 */
import React from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { ListCard } from './ListCard';
import { Text } from './Text';

/** The label column's width on a wide screen; narrow screens fall back to 100. */
export const KEY_COLUMN_WIDTH = 160;
const ROW_HEIGHT = 48;

export interface KeyValueRow {
  /** Stable id; falls back to the label when omitted. */
  id?: string;
  label: string;
  /** A string is rendered for you; a node lets a row hold a badge or a link. */
  value: React.ReactNode;
  /** Dates, amounts and rates. */
  mono?: boolean;
  /** Lets a long value (a 500-character 备注) wrap instead of being clipped to one line. */
  wrap?: boolean;
}

export interface KeyValueRowsProps {
  rows: readonly KeyValueRow[];
  /** Renders the rows bare, for a caller that brings its own container. */
  plain?: boolean;
  labelWidth?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function KeyValueRows({
  rows,
  plain = false,
  labelWidth,
  style,
  testID,
}: KeyValueRowsProps): React.JSX.Element {
  const colors = useColors();
  const wide = useIsWide();
  const id = testID ?? 'kv';
  const keyWidth = labelWidth ?? (wide ? KEY_COLUMN_WIDTH : 100);

  const body = rows.map((row, i) => {
    const key = row.id ?? row.label;
    return (
      <View
        key={key}
        testID={`${id}-row-${key}`}
        style={[
          styles.row,
          i > 0 ? { borderTopWidth: 1, borderTopColor: colors['border.default'] } : null,
        ]}
      >
        <Text variant="body" tone="secondary" style={{ width: keyWidth }} numberOfLines={1}>
          {row.label}
        </Text>
        <View style={styles.value}>
          {typeof row.value === 'string' ? (
            <Text
              variant="body"
              mono={row.mono ?? false}
              numberOfLines={row.wrap === true ? undefined : 1}
              testID={`${id}-value-${key}`}
            >
              {row.value}
            </Text>
          ) : (
            row.value
          )}
        </View>
      </View>
    );
  });

  if (plain) {
    return (
      <View testID={id} style={style}>
        {body}
      </View>
    );
  }
  return (
    <ListCard testID={id} style={style}>
      {body}
    </ListCard>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['4'],
    paddingHorizontal: space['5'],
    paddingVertical: space['3'],
  },
  value: { flex: 1, minWidth: 0 },
});
