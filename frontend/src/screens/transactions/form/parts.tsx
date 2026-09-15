/**
 * The presentation pieces the 记一笔 screens are built from (mockups 04 / 05 / 06).
 *
 * Nothing here knows the form model: these are the white card, the small field label, the
 * two-column grid and the row-shaped trigger the mockups draw, and they are shared by the
 * expense / transfer / refund bodies so every block lines up the same way.
 */
import React from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon, type IconName, Text, raisedShadow } from '@/ui';

/** The mockups' white block: `bg.raised`, radius 18, the hairline lift, 20 / 16 padding. */
export function FormCard({
  children,
  padded = true,
  style,
  testID,
}: {
  children?: React.ReactNode;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}): React.JSX.Element {
  const { colors, scheme } = useTheme();
  const wide = useIsWide();
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        raisedShadow(colors, scheme),
        { backgroundColor: colors['bg.raised'] },
        padded ? { padding: wide ? space['5'] : space['4'] } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** 12/600 secondary, with 「选填」 trailing in mono — the label above every box. */
export function FieldLabel({
  label,
  optional,
  right,
  testID,
}: {
  label: string;
  /** The word for "optional"; omitted shows nothing. */
  optional?: string;
  right?: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.labelRow}>
      <Text variant="caption" weight={600} tone="secondary" testID={testID}>
        {label}
      </Text>
      {optional !== undefined ? (
        <Text variant="micro" tone="muted" mono weight={400}>
          {optional}
        </Text>
      ) : null}
      {right !== undefined ? <View style={styles.labelRight}>{right}</View> : null}
    </View>
  );
}

/**
 * The mockups' two-column field grid. Narrow layouts stack, so the same children give the
 * 1440 pair and the 375 column with no second code path.
 */
export function FieldColumns({
  children,
  /** The first column's share of the row (mockup 04's 金额 / 日期 is 1.25 : 1). */
  ratio = 1,
  style,
}: {
  children: React.ReactNode;
  ratio?: number;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const wide = useIsWide();
  const items = React.Children.toArray(children);
  if (!wide) return <View style={[styles.stack, style]}>{items}</View>;
  return (
    <View style={[styles.columns, style]}>
      {items.map((child, i) => (
        <View key={i} style={{ flex: i === 0 ? ratio : 1, minWidth: 0 }}>
          {child}
        </View>
      ))}
    </View>
  );
}

/** A card's own header strip: 17/700 title on the left, anything on the right. */
export function CardHeader({
  title,
  right,
  divider = true,
  testID,
}: {
  title: string;
  right?: React.ReactNode;
  divider?: boolean;
  testID?: string;
}): React.JSX.Element {
  const colors = useTheme().colors;
  const wide = useIsWide();
  return (
    <View
      testID={testID}
      style={[
        styles.cardHeader,
        {
          paddingHorizontal: wide ? space['5'] : space['4'],
          paddingTop: wide ? space['4'] : space['3'],
          paddingBottom: wide ? space['3'] + 2 : space['3'],
          borderBottomWidth: divider ? 1 : 0,
          borderBottomColor: colors['border.default'],
        },
      ]}
    >
      <Text variant={wide ? 'subheading' : 'body'} weight={700} style={styles.grow}>
        {title}
      </Text>
      {right}
    </View>
  );
}

/** The uppercase mono strip above a column of options (「一级 · 必填」). */
export function ColumnCaption({ label }: { label: string }): React.JSX.Element {
  return (
    <Text variant="micro" mono weight={600} tone="muted" style={styles.columnCaption}>
      {label}
    </Text>
  );
}

export interface RowFieldProps {
  icon?: IconName;
  iconNode?: React.ReactNode;
  label?: string;
  value: string;
  valueMono?: boolean;
  valueTone?: 'primary' | 'muted';
  /** Second line under the value ("储蓄 · CNY"). */
  hint?: string;
  amount?: string;
  amountSub?: string;
  trailing?: React.ReactNode;
  onPress?(): void;
  disabled?: boolean;
  /** `false` paints the row flat (inside a white card) instead of on `bg.subtle`. */
  filled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The row-shaped trigger of mockups 04 / 05: a round icon well, a label over a value, an
 * optional right-hand number and a chevron. Used for the account and for the narrow date.
 */
export function RowField({
  icon,
  iconNode,
  label,
  value,
  valueMono = false,
  valueTone,
  hint,
  amount,
  amountSub,
  trailing,
  onPress,
  disabled = false,
  filled = true,
  accessibilityLabel,
  style,
  testID,
}: RowFieldProps): React.JSX.Element {
  const colors = useTheme().colors;
  const wide = useIsWide();

  const body = (
    <>
      {iconNode ??
        (icon ? (
          <View style={[styles.well, { backgroundColor: colors['bg.canvas'] }]}>
            <Icon name={icon} size={18} color={colors['fg.secondary']} />
          </View>
        ) : null)}
      <View style={styles.grow}>
        {label !== undefined ? (
          <Text variant="caption" weight={600} tone="secondary" numberOfLines={1}>
            {label}
          </Text>
        ) : null}
        <Text
          variant="subheading"
          weight={valueMono ? 450 : 500}
          mono={valueMono}
          tone={valueTone ?? 'primary'}
          numberOfLines={1}
          testID={testID ? `${testID}-value` : undefined}
        >
          {value}
        </Text>
        {hint !== undefined ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {hint}
          </Text>
        ) : null}
      </View>
      {amount !== undefined || amountSub !== undefined ? (
        <View style={styles.amountBlock}>
          {amount !== undefined ? (
            <Text variant="body" mono weight={450} tone="secondary" numberOfLines={1}>
              {amount}
            </Text>
          ) : null}
          {amountSub !== undefined ? (
            <Text variant="micro" mono tone="muted" numberOfLines={1}>
              {amountSub}
            </Text>
          ) : null}
        </View>
      ) : null}
      {trailing}
      {onPress ? <Icon name="chevron-down" size={18} color={colors['fg.muted']} /> : null}
    </>
  );

  const shape: ViewStyle = {
    minHeight: wide ? 64 : 56,
    borderRadius: filled ? radius.md + 2 : 0,
    paddingHorizontal: wide ? space['4'] : space['3'] + 2,
    paddingVertical: space['2'] + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: wide ? space['3'] + 2 : space['3'],
    opacity: disabled ? 0.6 : 1,
  };

  if (!onPress) {
    return (
      <View
        testID={testID}
        style={[shape, filled ? { backgroundColor: colors['bg.subtle'] } : null, style]}
      >
        {body}
      </View>
    );
  }
  return (
    // touch-target-exempt: `shape` above gives every row minHeight 56 (narrow) / 64 (wide).
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label ?? value}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        shape,
        {
          backgroundColor: pressed && !disabled
            ? colors['bg.hover']
            : filled
              ? colors['bg.subtle']
              : 'transparent',
        },
        style,
      ]}
    >
      {body}
    </Pressable>
  );
}

/** A 1px rule between the rows of a card (mockup 04's account / date block). */
export function RowDivider(): React.JSX.Element {
  const colors = useTheme().colors;
  return <View style={[styles.divider, { backgroundColor: colors['border.default'] }]} />;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, alignSelf: 'stretch', minWidth: 0 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['1'] + 2,
    paddingBottom: space['1'] + 2,
  },
  labelRight: { marginLeft: 'auto' },
  grow: { flex: 1, minWidth: 0 },
  columns: { flexDirection: 'row', gap: space['5'], alignItems: 'flex-start' },
  stack: { gap: space['3'] },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  columnCaption: {
    letterSpacing: 0.66,
    paddingHorizontal: space['5'],
    paddingTop: space['2'],
    paddingBottom: space['1'] + 2,
  },
  well: {
    width: 36,
    height: 36,
    flexShrink: 0,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountBlock: { alignItems: 'flex-end', flexShrink: 0 },
  divider: { height: 1, marginHorizontal: space['3'] + 2 },
});
