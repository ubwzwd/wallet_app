/**
 * One row of the home page's category ranking (screen 01, 04 §4.4, decision §14.21).
 *
 * The mockup's row is a single line: a 10px colour chip, the category name in a fixed
 * column, a pill-shaped track, the share, the amount and a chevron. Opening it reveals the
 * classification criterion — which the stats endpoint does not send; it comes from the
 * category cache — and the level-2 rows, indented to line up with the level-1 name.
 *
 * Bar colours are `chart.series[0..7]`, never the four kind colours (04 §6.2 rule 3).
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Money, StatsCategoryNode } from '@/api/types';
import { cmpMoney } from '@/domain';
import type { CategoryIndex } from '@/domain/categories';
import { type Lang } from '@/i18n';
import { categoryDesc } from '@/i18n/category';
import { formatAmountPlain } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon, Text } from '@/ui';

export interface CategoryItem {
  code: string;
  label: string;
  amount: Money;
  share: number;
  desc: string | null;
  children: Array<{ code: string | null; label: string; amount: Money; share: number }>;
}

/** Category name in the active language — the stats endpoint ships both spellings. */
function nodeLabel(node: { name_zh: string; name_en: string }, lang: Lang): string {
  return lang === 'zh' ? node.name_zh : node.name_en;
}

/** Level-1 nodes as rows, biggest first, each carrying its classification hint. */
export function toCategoryItems(
  nodes: readonly StatsCategoryNode[],
  index: CategoryIndex | null,
  lang: Lang,
): CategoryItem[] {
  return [...nodes]
    .sort((a, b) => cmpMoney(b.amount, a.amount))
    .map((node) => {
      const category = index?.byL1[node.code];
      const top = node.children.reduce(
        (max, child) => (cmpMoney(child.amount, max) > 0 ? child.amount : max),
        '0.0000' as Money,
      );
      const peak = Number(top);
      return {
        code: node.code,
        label: nodeLabel(node, lang),
        amount: node.amount,
        share: node.share,
        desc: category ? categoryDesc(category, lang) : null,
        children: node.children.map((child) => ({
          code: child.code,
          label: nodeLabel(child, lang),
          amount: child.amount,
          // Level-2 bars are scaled inside their own group, so the biggest child fills it.
          share: peak > 0 ? Math.max(0, Number(child.amount)) / peak : 0,
        })),
      };
    });
}

export interface CategoryRowProps {
  item: CategoryItem;
  /** The row's `chart.series` colour, already resolved by the caller. */
  color: string;
  currency: string;
  open: boolean;
  onToggle(): void;
}

export function CategoryRow({
  item,
  color,
  currency,
  open,
  onToggle,
}: CategoryRowProps): React.JSX.Element {
  const colors = useColors();
  const wide = useIsWide();
  const share = Math.max(0, Math.min(1, item.share));
  const barHeight = wide ? 10 : 8;

  return (
    <View>
      {/* touch-target-exempt: `row` is 52 (wide) / 48 (narrow) tall. */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={item.label}
        accessibilityHint={item.desc ?? undefined}
        onPress={onToggle}
        testID={`home-categories-row-${item.code}`}
        style={({ pressed }) => [
          styles.row,
          wide ? styles.rowWide : styles.rowNarrow,
          { backgroundColor: pressed ? colors['bg.hover'] : 'transparent' },
        ]}
      >
        <View style={[styles.chip, { backgroundColor: color }]} />
        <Text
          variant="body"
          weight={500}
          numberOfLines={1}
          style={[styles.name, wide ? styles.nameWide : styles.nameNarrow]}
        >
          {item.label}
        </Text>
        <View
          style={[styles.track, { height: barHeight, backgroundColor: colors['bg.subtle'] }]}
        >
          <View
            testID={`home-categories-bar-${item.code}`}
            style={{
              height: barHeight,
              borderRadius: radius.pill,
              backgroundColor: color,
              width: `${share * 100}%`,
            }}
          />
        </View>
        {wide ? (
          <Text variant="caption" tone="muted" mono style={styles.share}>
            {`${Math.round(share * 100)}%`}
          </Text>
        ) : null}
        <Text variant="body" mono weight={500} style={styles.amount}>
          {formatAmountPlain(item.amount, currency)}
        </Text>
        <Icon
          name={open ? 'chevron-down' : 'chevron-right'}
          size={16}
          color={colors['border.strong']}
        />
      </Pressable>

      {open ? (
        <View style={wide ? styles.childrenWide : styles.childrenNarrow}>
          {item.desc ? (
            <Text
              variant="caption"
              tone="muted"
              style={styles.desc}
              testID={`home-categories-desc-${item.code}`}
            >
              {item.desc}
            </Text>
          ) : null}
          {item.children.map((child) => (
            <View
              key={child.code ?? `${item.code}-none`}
              style={[styles.childRow, { backgroundColor: colors['bg.canvas'] }]}
            >
              <Text variant="body" tone="secondary" numberOfLines={1} style={styles.childName}>
                {child.label}
              </Text>
              {wide ? (
                <View style={[styles.childTrack, { backgroundColor: colors['bg.selected'] }]}>
                  <View
                    style={{
                      height: 6,
                      borderRadius: radius.pill,
                      backgroundColor: color,
                      width: `${Math.max(0, Math.min(1, child.share)) * 100}%`,
                    }}
                  />
                </View>
              ) : null}
              <Text variant="body" tone="secondary" mono>
                {formatAmountPlain(child.amount, currency)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  rowWide: {
    minHeight: 52,
    paddingHorizontal: space['4'] + 2,
    paddingVertical: space['2'],
    gap: space['3'] + 2,
  },
  rowNarrow: {
    minHeight: 48,
    paddingHorizontal: space['3'] + 2,
    paddingVertical: space['2'] - 1,
    gap: space['3'],
  },
  chip: { width: 10, height: 10, borderRadius: 3, flexShrink: 0 },
  name: { flexShrink: 0 },
  nameWide: { width: 84, fontSize: 15, lineHeight: 21 },
  nameNarrow: { width: 70 },
  track: { flex: 1, minWidth: 0, borderRadius: radius.pill, overflow: 'hidden' },
  share: { width: 40, textAlign: 'right', flexShrink: 0 },
  amount: { flexShrink: 0 },
  childrenWide: {
    paddingLeft: 42,
    paddingRight: space['4'] + 2,
    paddingBottom: space['2'] + 2,
    gap: space['1'],
  },
  childrenNarrow: {
    paddingLeft: 36,
    paddingRight: space['3'] + 2,
    paddingBottom: space['2'],
    gap: space['1'],
  },
  desc: { paddingVertical: space['1'] },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    minHeight: 38,
    paddingHorizontal: space['3'] + 2,
    paddingVertical: space['1'] + 2,
    borderRadius: radius.sm + 2,
  },
  childName: { flex: 1, minWidth: 0 },
  childTrack: {
    width: 74,
    height: 6,
    borderRadius: radius.pill,
    overflow: 'hidden',
    flexShrink: 0,
  },
});
