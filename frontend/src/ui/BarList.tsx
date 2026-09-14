/**
 * Category ranking bars (04 §4.4, §6.2 rule 3): the top `max` level-1 categories plus one
 * "N more" row, each bar coloured from `chart.series[0..7]` — never from the four kind
 * colours, so 餐饮 can't end up looking like income.
 *
 * The label can carry the category's `categoryDesc()`: the stats endpoint doesn't send it,
 * the caller reads it from the category cache (decision §14.21). It is revealed under the
 * label on hover (react-native-web maps `onHoverIn` onto mouseenter) or on a long press —
 * a DOM `title` attribute would be dropped by react-native-web, so there is no tooltip.
 */
import React from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Money } from '@/api/types';
import { sumMoney } from '@/domain/money';
import { type Lang, useLang } from '@/i18n';
import { formatMoney } from '@/i18n/format';
import { chartSeries, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon } from './Icon';
import { Text } from './Text';

export interface BarListChild {
  code: string | null;
  label: string;
  amount: Money;
}

export interface BarListItem {
  code: string;
  label: string;
  amount: Money;
  /** 0..1, as the stats endpoint sends it. */
  share: number;
  /** The level-1 classification criterion, shown as a tooltip. */
  desc?: string | null;
  children?: readonly BarListChild[];
}

export interface BarListProps {
  items: readonly BarListItem[];
  currency: string;
  lang?: Lang;
  /** How many bars before the rest collapse into one "N more" row. */
  max?: number;
  onPress?(code: string): void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const BAR_HEIGHT = 8;

export function BarList({
  items,
  currency,
  lang,
  max = 8,
  onPress,
  style,
  testID,
}: BarListProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const activeLang = useLang();
  const l = lang ?? activeLang;
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const id = testID ?? 'bar-list';

  const series = chartSeries(colors);
  const shown = items.slice(0, max);
  const rest = items.slice(max);
  // Decimal-string arithmetic: bar totals never go through a float (04 §1.2).
  const restAmount = sumMoney(rest, (item) => item.amount);

  return (
    <View testID={id} style={[styles.wrap, style]}>
      {shown.map((item, i) => {
        const open = expanded === item.code;
        const hasChildren = (item.children?.length ?? 0) > 0;
        return (
          <View key={item.code}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={item.label}
              accessibilityHint={item.desc ?? undefined}
              onPress={() => {
                if (hasChildren) setExpanded(open ? null : item.code);
                onPress?.(item.code);
              }}
              onHoverIn={() => setHovered(item.code)}
              onHoverOut={() => setHovered((cur) => (cur === item.code ? null : cur))}
              onLongPress={() => setExpanded(open ? null : item.code)}
              testID={`${id}-row-${item.code}`}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? colors['bg.hover'] : 'transparent' },
              ]}
            >
              <View style={styles.header}>
                <Text variant="body" numberOfLines={1} style={styles.label}>
                  {item.label}
                </Text>
                <Text variant="body" mono testID={`${id}-amount-${item.code}`}>
                  {formatMoney(item.amount, currency, l)}
                </Text>
                {hasChildren ? (
                  <Icon
                    name={open ? 'chevron-down' : 'chevron-right'}
                    size={16}
                    color={colors['fg.muted']}
                  />
                ) : null}
              </View>
              {item.desc && (hovered === item.code || open) ? (
                <Text variant="caption" tone="muted" testID={`${id}-desc-${item.code}`}>
                  {item.desc}
                </Text>
              ) : null}
              <View style={[styles.track, { backgroundColor: colors['bg.subtle'] }]}>
                <View
                  testID={`${id}-bar-${item.code}`}
                  style={{
                    height: BAR_HEIGHT,
                    borderRadius: radius.pill,
                    backgroundColor: series[i % series.length],
                    width: `${Math.max(0, Math.min(1, item.share)) * 100}%`,
                  }}
                />
              </View>
            </Pressable>
            {open && item.children
              ? item.children.map((child) => (
                  <View key={child.code ?? `${item.code}-none`} style={styles.childRow}>
                    <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.label}>
                      {child.label}
                    </Text>
                    <Text variant="caption" tone="secondary" mono>
                      {formatMoney(child.amount, currency, l)}
                    </Text>
                  </View>
                ))
              : null}
          </View>
        );
      })}

      {rest.length > 0 ? (
        <View style={styles.row} testID={`${id}-rest`}>
          <View style={styles.header}>
            <Text variant="body" tone="secondary" style={styles.label}>
              {t('stats:home.category_other_n', { count: rest.length })}
            </Text>
            <Text variant="body" tone="secondary" mono>
              {formatMoney(restAmount, currency, l)}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space['2'], alignSelf: 'stretch' },
  row: { minHeight: 44, gap: space['1'], paddingVertical: space['1'], borderRadius: radius.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: space['2'] },
  label: { flex: 1 },
  track: { height: BAR_HEIGHT, borderRadius: radius.pill, overflow: 'hidden' },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['2'],
    paddingLeft: space['4'],
    paddingVertical: space['1'],
  },
});
