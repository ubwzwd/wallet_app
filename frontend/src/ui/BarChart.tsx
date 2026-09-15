/**
 * The 12-month expense chart (mockup 01, 04 §4.4; decisions §7, §14.52 B20).
 *
 * Twelve rounded columns, expenses only — income is deliberately absent, and so are the
 * average and peak markers (decision §14.52 A21), which the section header carries instead.
 * The current month is the solid `accent.solid` bar; the other eleven are a pale idle fill,
 * so the shape of the year reads before any number does.
 *
 * Wide screens are 132 tall with a value label over every bar and a month under every bar;
 * narrow screens are 72 tall, drop the value labels and keep five milestone months.
 */
import React from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Money } from '@/api/types';
import { type Lang, useLang } from '@/i18n';
import { formatMonthShort, formatMoney } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { EmptyState } from './EmptyState';
import { Text } from './Text';

export interface BarChartPoint {
  /** `'YYYY-MM'`. */
  month: string;
  expense: Money;
}

export const BAR_HEIGHT_WIDE = 132;
export const BAR_HEIGHT_NARROW = 72;
/**
 * The strip at the top of a wide column that belongs to the value label, not to the bar:
 * the mockup's 132-tall box scales its columns to 104 (屏幕 01 · 首页.dc.html:436
 * `buildMonths(104)`), leaving the 11/14 label plus its 6px gap room to sit inside the
 * card. Narrow columns draw no label and keep the whole box.
 */
export const BAR_LABEL_BAND = BAR_HEIGHT_WIDE - 104;
/** A bar with nothing in it is still drawn, so the month is not a hole in the row. */
export const BAR_MIN = 6;
const BAR_RADIUS = 6;

export interface BarChartProps {
  months: readonly BarChartPoint[];
  currency: string;
  lang?: Lang;
  /** The month the page is showing; drawn solid. */
  selected?: string;
  onPressMonth?(month: string): void;
  /** Overrides the responsive 132 / 72. */
  height?: number;
  /** Overrides the compact bar label ('5.2k'); the a11y label keeps the full amount. */
  formatValue?(point: BarChartPoint): string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** `'2026-08'` → `'8月'` / `'Aug'` — the shared formatter, so the axis reads the same here
 *  as anywhere else a short month is printed (04 §5.4). */
export function monthAbbrev(month: string, lang: Lang): string {
  return formatMonthShort(month, lang);
}

/**
 * The mockup's bar label: thousands as one decimal plus `k`, symbol-free, so twelve of
 * them fit side by side on one line (屏幕 01 · 首页.dc.html:397). Below a thousand the
 * rounded number is already short enough.
 */
export function compactBarLabel(value: number): string {
  const n = Math.abs(value);
  return n >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));
}

/** Pixel height of every bar, scaled to the peak; the scale always starts at 0. */
export function barHeights(values: readonly number[], height: number): number[] {
  const peak = Math.max(0, ...values);
  return values.map((v) =>
    peak <= 0 ? BAR_MIN : Math.max(BAR_MIN, Math.round((v / peak) * height)),
  );
}

/**
 * Which months keep a label on a narrow screen: the first, the last, and every third in
 * between — the mockup's 10 月 / 1 月 / 4 月 / 7 月 / 9 月.
 */
export function narrowLabelIndexes(count: number): number[] {
  if (count === 0) return [];
  const out: number[] = [];
  for (let i = 0; i < count - 1; i += 3) out.push(i);
  if (out[out.length - 1] !== count - 1) out.push(count - 1);
  return out;
}

export function BarChart({
  months,
  currency,
  lang,
  selected,
  onPressMonth,
  height,
  formatValue,
  style,
  testID,
}: BarChartProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const activeLang = useLang();
  const wide = useIsWide();
  const l = lang ?? activeLang;
  const id = testID ?? 'bars';

  if (months.length === 0) {
    return (
      <EmptyState
        testID={`${id}-empty`}
        icon="info"
        title={t('stats:home.trend_empty')}
        style={style}
      />
    );
  }

  const box = height ?? (wide ? BAR_HEIGHT_WIDE : BAR_HEIGHT_NARROW);
  // The column is the full box tall, but a wide one lends its top band to the value
  // label, so the tallest bar stops below the label instead of pushing it out of the card.
  const heights = barHeights(
    months.map((m) => Number(m.expense)),
    wide ? Math.max(BAR_MIN, box - BAR_LABEL_BAND) : box,
  );
  const labelled = new Set(wide ? months.map((_, i) => i) : narrowLabelIndexes(months.length));
  const gap = wide ? space['2'] + 2 : space['1'] + 1;

  return (
    <View testID={id} style={[styles.wrap, style]}>
      <View style={[styles.row, { gap, height: box }]}>
        {months.map((m, i) => {
          const current = m.month === selected;
          // Screen readers hear the amount with its currency; the drawn label is the
          // mockup's bare '5.2k', which a caller may override.
          const spoken = formatMoney(m.expense, currency, l, { compact: true });
          const value = formatValue?.(m) ?? compactBarLabel(Number(m.expense));
          return (
            // touch-target-exempt: a column is the full 72/132-tall chart box.
            <Pressable
              key={m.month}
              accessibilityRole="button"
              accessibilityState={{ selected: current }}
              accessibilityLabel={`${monthAbbrev(m.month, l)} ${spoken}`}
              disabled={onPressMonth === undefined}
              onPress={() => onPressMonth?.(m.month)}
              testID={`${id}-point-${m.month}`}
              style={[styles.column, { height: box }]}
            >
              {wide ? (
                <Text
                  variant="micro"
                  mono
                  weight={500}
                  tone={current ? 'accent' : 'secondary'}
                  numberOfLines={1}
                  style={styles.valueLabel}
                  testID={`${id}-value-${m.month}`}
                >
                  {value}
                </Text>
              ) : null}
              <View
                testID={`${id}-bar-${m.month}`}
                style={{
                  height: heights[i],
                  borderRadius: BAR_RADIUS,
                  backgroundColor: current ? colors['accent.solid'] : colors['border.strong'],
                }}
              />
            </Pressable>
          );
        })}
      </View>

      {/* Wide: one label under every column, centred in its slot. Narrow: only the five
          milestone months, spread edge to edge — the mockup's `space-between` row, not
          five labels squeezed into twelve flex slots, which wraps 「10 月」 onto two
          lines (屏幕 01 · 首页.dc.html:138). */}
      <View
        testID={`${id}-axis`}
        style={[
          styles.row,
          { marginTop: space['2'] },
          wide ? { gap } : styles.axisRowNarrow,
        ]}
      >
        {months.map((m, i) =>
          labelled.has(i) ? (
            <Text
              key={m.month}
              variant="micro"
              mono
              weight={m.month === selected ? 500 : 400}
              tone={m.month === selected ? 'accent' : 'muted'}
              numberOfLines={1}
              style={wide ? styles.axisLabel : null}
              testID={`${id}-month-${m.month}`}
            >
              {monthAbbrev(m.month, l)}
            </Text>
          ) : wide ? (
            <View key={m.month} style={styles.axisSpacer} />
          ) : null,
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  column: { flex: 1, justifyContent: 'flex-end', gap: space['1'] + 2 },
  valueLabel: { textAlign: 'center' },
  axisLabel: { flex: 1, textAlign: 'center' },
  axisSpacer: { flex: 1 },
  axisRowNarrow: { justifyContent: 'space-between', alignItems: 'center' },
});
