/**
 * The blocks 屏幕稿 07 / 08 build a detail page out of (decision §14.45: the mockups are the
 * visual source of truth) — the headline badges, the tinted account strip, the two kinds of
 * side card and the wide layout's two columns.
 *
 * Nothing here knows about the API or the router: the screens hand down already-formatted
 * strings.
 */
import React from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { IsoDate, Money, TxKind } from '@/api/types';
import { type FormatMoneyOptions, formatAmountPlain, parseLocalDate } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors, useTheme } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  Badge,
  type BadgeTone,
  KIND_ICON,
  KindIcon,
  Text,
  type TextTone,
  kindLabelKey,
  raisedShadow,
} from '@/ui';

/** The right-hand column of the wide layout (屏幕稿 07 / 08: `minmax(0,1fr) 300px`). */
export const SIDE_COLUMN_WIDTH = 300;

// ------------------------------------------------------------------------- badges

const KIND_BADGE_TONE: Readonly<Record<TxKind, BadgeTone>> = {
  expense: 'kind-expense',
  income: 'kind-income',
  refund: 'kind-refund',
  transfer: 'kind-transfer',
};

/** The headline kind pill: 28 tall on a wide screen, 26 narrow (屏幕稿 08). */
export function KindHeadBadge({
  kind,
  testID,
}: {
  kind: TxKind;
  testID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const wide = useIsWide();
  return (
    <Badge
      testID={testID}
      size={wide ? 'lg' : 'md'}
      tone={KIND_BADGE_TONE[kind]}
      icon={KIND_ICON[kind]}
      label={t(kindLabelKey(kind))}
    />
  );
}

/** A neutral / info / warning pill next to it: the category path, 「已折算」, 「2 条腿」. */
export function InfoBadge({
  label,
  tone = 'neutral',
  testID,
}: {
  label: string;
  tone?: BadgeTone;
  testID?: string;
}): React.JSX.Element {
  const wide = useIsWide();
  return <Badge testID={testID} size={wide ? 'lg' : 'md'} tone={tone} label={label} />;
}

// --------------------------------------------------------------------- account row

export interface AccountRowProps {
  kind: TxKind;
  /** The merchant, or the account name when there is no merchant. */
  title: string;
  /** 「DBS Multiplier · 储蓄卡 · SGD」 */
  subtitle?: string | null;
  testID?: string;
}

/** 屏幕稿 08: the tinted strip under the amount — icon well, merchant, account line. */
export function AccountRow({
  kind,
  title,
  subtitle,
  testID,
}: AccountRowProps): React.JSX.Element {
  const colors = useColors();
  const wide = useIsWide();
  return (
    <View
      testID={testID}
      style={[styles.accountRow, { backgroundColor: colors['bg.canvas'] }]}
    >
      <KindIcon kind={kind} size={wide ? 36 : 34} />
      <View style={styles.accountText}>
        <Text
          variant="subheading"
          weight={500}
          numberOfLines={1}
          testID={testID ? `${testID}-title` : undefined}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            variant="caption"
            tone="muted"
            numberOfLines={1}
            testID={testID ? `${testID}-sub` : undefined}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------- side cards

export interface SideCardProps {
  title: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A white right-column card with the mockups' 15/700 title (「对 9 月的影响」). */
export function SideCard({ title, children, style, testID }: SideCardProps): React.JSX.Element {
  const { colors, scheme } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.sideCard,
        raisedShadow(colors, scheme),
        { backgroundColor: colors['bg.surface'] },
        style,
      ]}
    >
      <Text variant="subheading" weight={700} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

export interface TintSideCardProps {
  /** 屏幕稿 07 / 08 only ever tint a side card beige (`status.warning.*`). */
  title: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The beige side card: 「已关联的退款」, 「这笔是单腿」. */
export function TintSideCard({
  title,
  children,
  style,
  testID,
}: TintSideCardProps): React.JSX.Element {
  const colors = useColors();
  return (
    <View
      testID={testID}
      style={[styles.sideCard, { backgroundColor: colors['status.warning.bg'] }, style]}
    >
      <Text variant="subheading" weight={700} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

export interface FactRowProps {
  label: string;
  value: string;
  tone?: TextTone;
  /** Inside a `TintSideCard`: both halves take the tint's own foreground. */
  onTint?: boolean;
  /** No hairline under the last row. */
  last?: boolean;
  testID?: string;
}

/** One 「9 月支出 … 6,842.50」 line inside a side card. */
export function FactRow({
  label,
  value,
  tone,
  onTint = false,
  last = false,
  testID,
}: FactRowProps): React.JSX.Element {
  const colors = useColors();
  const labelTone: TextTone = onTint ? 'warning' : 'secondary';
  const valueTone: TextTone = tone ?? labelTone;
  return (
    <View
      testID={testID}
      style={[
        styles.factRow,
        last
          ? null
          : {
              borderBottomWidth: 1,
              borderBottomColor: colors[onTint ? 'border.strong' : 'border.default'],
            },
      ]}
    >
      <Text variant="caption" tone={labelTone} style={styles.factLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text variant="caption" mono weight={500} tone={valueTone} style={styles.factValue}>
        {value}
      </Text>
    </View>
  );
}

// -------------------------------------------------------------------- page layout

export interface DetailColumnsProps {
  main: React.ReactNode;
  side: React.ReactNode;
  testID?: string;
}

/**
 * 屏幕稿 07 / 08: a `minmax(0,1fr) 300px` grid on a wide screen. Narrow stacks the two
 * columns in reading order — the main card first, the side blocks after the fact list.
 */
export function DetailColumns({ main, side, testID }: DetailColumnsProps): React.JSX.Element {
  const wide = useIsWide();
  if (!wide) {
    return (
      <View style={styles.stack} testID={testID}>
        {main}
        {side}
      </View>
    );
  }
  return (
    <View style={styles.grid} testID={testID}>
      <View style={styles.mainColumn}>{main}</View>
      <View style={styles.sideColumn}>{side}</View>
    </View>
  );
}

// ------------------------------------------------------------------------ helpers

/**
 * 「2026-09-08 周二」 — the long date the fact list uses (屏幕稿 07 / 08). The list form
 * (「9月8日」) lives in `formatDate`; a detail page states the whole day, weekday included,
 * because this is the page people copy a date off.
 */
export function longDate(iso: IsoDate, t: (key: string) => string): string {
  // One set of weekday names for the whole feature: the list's `list.weekday` (DayGroup).
  const weekday = t(`transaction:list.weekday.${parseLocalDate(iso).getDay()}`);
  return `${iso} ${weekday}`;
}

/**
 * 「3,000.00」 / 「+5,000.00」 — an amount with no currency symbol, the way 屏幕稿 07 writes
 * every figure on a transfer: the currency is already spelled out beside it (the grey line
 * 「CNY · 账本内部搬钱…」, the leg's own 「储蓄卡 · CNY」), and repeating the symbol on a 40px
 * number is what made the phase-6 page look like a receipt.
 *
 * `formatAmountPlain` writes its own U+2212 and never a '+', so `never` drops that minus and
 * `always` adds the plus here — the same sign rules `formatMoney` applies.
 */
export function plainAmount(
  amount: Money,
  currency: string,
  signDisplay: FormatMoneyOptions['signDisplay'],
): string {
  const value = Number(amount);
  const digits = formatAmountPlain(amount, currency);
  if (signDisplay === 'never') return value < 0 ? digits.slice(1) : digits;
  if (signDisplay === 'always' && value > 0) return `+${digits}`;
  return digits;
}

const styles = StyleSheet.create({
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'] + 2,
    padding: space['4'],
    borderRadius: radius.md + 2,
    alignSelf: 'stretch',
  },
  accountText: { flex: 1, minWidth: 0 },
  sideCard: {
    borderRadius: radius.lg,
    padding: space['4'] + 2,
    gap: space['3'],
    alignSelf: 'stretch',
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space['2'] + 2,
    paddingVertical: space['2'] + 1,
  },
  factLabel: { flexShrink: 1 },
  factValue: { flexShrink: 0, textAlign: 'right' },
  stack: { alignSelf: 'stretch', gap: space['3'] },
  grid: { flexDirection: 'row', alignItems: 'flex-start', gap: space['6'], alignSelf: 'stretch' },
  mainColumn: { flex: 1, minWidth: 0, gap: space['5'] },
  sideColumn: { width: SIDE_COLUMN_WIDTH, flexShrink: 0, gap: space['5'] },
});
