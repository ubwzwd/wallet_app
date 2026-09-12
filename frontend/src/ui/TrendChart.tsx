/**
 * 12-month expense trend (04 §4.4; decisions §7, §14.52 B20).
 *
 * One line, expenses only — income is deliberately absent, and so are the monthly average
 * and peak markers (decision §14.52 A21). Every point carries its own value label, so the
 * chart is readable without hovering; the line colour is `chart.series[0]`, never a kind
 * colour (§6.2 rule 3).
 */
import React from 'react';
import {
  type LayoutChangeEvent,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Circle, Polyline } from 'react-native-svg';
import type { Money } from '@/api/types';
import { type Lang, useLang } from '@/i18n';
import { formatMonthShort, formatMoney } from '@/i18n/format';
import { chartSeries, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { EmptyState } from './EmptyState';
import { Text } from './Text';

export interface TrendPoint {
  /** `'YYYY-MM'`. */
  month: string;
  expense: Money;
}

export interface TrendChartProps {
  months: readonly TrendPoint[];
  currency: string;
  lang?: Lang;
  /** The month the summary block is showing; drawn with a larger dot. */
  selected?: string;
  onPressMonth?(month: string): void;
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const PAD_Y = 18;
const PAD_X = 10;

/** `'2026-08'` → `'8月'` / `'Aug'` — the shared formatter, so the axis reads the same here
 *  as anywhere else a short month is printed (04 §5.4). */
export function monthAbbrev(month: string, lang: Lang): string {
  return formatMonthShort(month, lang);
}

/** Y position of each point in a `height`-tall box; the scale always starts at 0. */
export function trendGeometry(
  values: readonly number[],
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  const peak = Math.max(0, ...values);
  const innerW = Math.max(0, width - PAD_X * 2);
  const innerH = Math.max(0, height - PAD_Y * 2);
  const step = values.length > 1 ? innerW / (values.length - 1) : 0;
  return values.map((v, i) => ({
    x: PAD_X + step * i + (values.length > 1 ? 0 : innerW / 2),
    y: PAD_Y + innerH * (1 - (peak === 0 ? 0 : v / peak)),
  }));
}

/** Where a point's value label sits: just above its dot, clamped inside the box. */
export function valueLabelTop(topRatio: number, height: number): number {
  const dotY = PAD_Y + (height - PAD_Y * 2) * topRatio;
  return Math.max(0, dotY - PAD_Y);
}

export function TrendChart({
  months,
  currency,
  lang,
  selected,
  onPressMonth,
  height = 160,
  style,
  testID,
}: TrendChartProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const activeLang = useLang();
  const l = lang ?? activeLang;
  const [width, setWidth] = React.useState(0);
  const id = testID ?? 'trend';

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

  const values = months.map((m) => Number(m.expense));
  const points = trendGeometry(values, width, height);
  const line = chartSeries(colors)[0];
  const peak = Math.max(0, ...values);

  const onLayout = (e: LayoutChangeEvent): void => setWidth(e.nativeEvent.layout.width);

  return (
    <View testID={id} style={[styles.wrap, style]}>
      <View style={{ height }} onLayout={onLayout}>
        {width > 0 ? (
          <Svg width={width} height={height} testID={`${id}-svg`}>
            <Polyline
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={line}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((p, i) => (
              <Circle
                key={months[i].month}
                cx={p.x}
                cy={p.y}
                r={months[i].month === selected ? 5 : 3}
                fill={line}
              />
            ))}
          </Svg>
        ) : null}

        <View style={[StyleSheet.absoluteFill, styles.columns]} pointerEvents="box-none">
          {months.map((m, i) => {
            // Twelve two-decimal labels would never fit side by side, so each one uses
            // `formatMoney`'s own compact notation ('¥1.2万' / '¥12K').
            const label = formatMoney(m.expense, currency, l, { compact: true });
            const topRatio = peak === 0 ? 1 : 1 - values[i] / peak;
            return (
              <Pressable
                key={m.month}
                accessibilityRole="button"
                accessibilityState={{ selected: m.month === selected }}
                accessibilityLabel={`${monthAbbrev(m.month, l)} ${label}`}
                disabled={onPressMonth === undefined}
                onPress={() => onPressMonth?.(m.month)}
                testID={`${id}-point-${m.month}`}
                style={styles.column}
              >
                <View style={[styles.valueSlot, { top: valueLabelTop(topRatio, height) }]}>
                  <Text
                    variant="micro"
                    mono
                    tone={m.month === selected ? 'accent' : 'secondary'}
                    testID={`${id}-value-${m.month}`}
                  >
                    {label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.columns}>
        {months.map((m) => (
          <Text
            key={m.month}
            variant="micro"
            tone={m.month === selected ? 'accent' : 'muted'}
            style={styles.axisLabel}
            testID={`${id}-month-${m.month}`}
          >
            {monthAbbrev(m.month, l)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space['1'], alignSelf: 'stretch' },
  columns: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { flex: 1, height: '100%', borderRadius: radius.sm },
  valueSlot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  axisLabel: { flex: 1, textAlign: 'center' },
});
