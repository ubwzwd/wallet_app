/**
 * EmptyState (04 §6.4, screen 15): icon + headline + one sentence + up to two actions.
 * Every list page passes its own copy, which always comes from the language pack.
 *
 * Screen 15 deliberately uses no illustration. Instead it draws a `GhostBlock` — striped
 * placeholder rows and columns — so the empty page shows *what will grow here* rather than
 * an empty box: "这里本该是一列交易", "分类排行和 12 个月趋势会长在这里".
 */
import React from 'react';
import {
  type DimensionValue,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** The twelve ghost columns' relative heights — an unremarkable year, not a pattern. */
const GHOST_COLUMNS = [0.5, 0.72, 0.4, 0.86, 0.6, 0.66, 1, 0.74, 0.54, 0.8, 0.62, 0.7];
const GHOST_WIDTHS: readonly DimensionValue[] = ['62%', '48%', '33%', '24%'];

export interface GhostBlockProps {
  /** Striped list rows; 0 draws none. */
  rows?: number;
  /** Adds the 12-column bar silhouette under the rows. */
  chart?: boolean;
  /** Small caption above the block ("记满一个月之后"). */
  caption?: string;
  /** One grey sentence under the block. */
  note?: string;
  /** Wraps the block in the dashed-looking outlined card screen 15 draws on the home page. */
  framed?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function GhostBlock({
  rows = 3,
  chart = false,
  caption,
  note,
  framed = false,
  style,
  testID,
}: GhostBlockProps): React.JSX.Element {
  const colors = useColors();
  const id = testID ?? 'ghost';
  return (
    <View
      testID={id}
      accessibilityElementsHidden={note === undefined && caption === undefined}
      style={[
        styles.ghost,
        framed
          ? {
              backgroundColor: colors['bg.surface'],
              borderWidth: 1.5,
              borderColor: colors['border.default'],
              padding: space['5'] - 2,
            }
          : null,
        style,
      ]}
    >
      {caption !== undefined ? (
        <Text variant="micro" tone="muted" mono weight={600}>
          {caption}
        </Text>
      ) : null}
      {rows > 0 ? (
        <View style={styles.ghostRows} testID={`${id}-rows`}>
          {Array.from({ length: rows }, (_, i) => (
            <View key={i} style={styles.ghostRow}>
              <View style={[styles.ghostDot, { backgroundColor: colors['border.default'] }]} />
              <View style={[styles.ghostName, { backgroundColor: colors['bg.subtle'] }]} />
              <View style={[styles.ghostTrack, { backgroundColor: colors['bg.canvas'] }]}>
                <View
                  style={[
                    styles.ghostFill,
                    {
                      width: GHOST_WIDTHS[i % GHOST_WIDTHS.length],
                      backgroundColor: colors['bg.subtle'],
                    },
                  ]}
                />
              </View>
              <View style={[styles.ghostValue, { backgroundColor: colors['bg.subtle'] }]} />
            </View>
          ))}
        </View>
      ) : null}
      {chart ? (
        <View style={styles.ghostChart} testID={`${id}-chart`}>
          {GHOST_COLUMNS.map((ratio, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: `${Math.round(ratio * 100)}%` as DimensionValue,
                borderRadius: 5,
                backgroundColor: colors['bg.subtle'],
              }}
            />
          ))}
        </View>
      ) : null}
      {note !== undefined ? (
        <Text variant="caption" tone="muted">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

export interface EmptyStateAction {
  label: string;
  onPress(): void;
}

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: string;
  /** Screen 15's striped placeholder, drawn above the headline. */
  placeholder?: GhostBlockProps;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function EmptyState({
  icon,
  title,
  body,
  placeholder,
  primaryAction,
  secondaryAction,
  style,
  testID,
}: EmptyStateProps): React.JSX.Element {
  const colors = useColors();
  return (
    <View testID={testID} style={[styles.wrap, style]}>
      {placeholder ? (
        <GhostBlock {...placeholder} testID={testID ? `${testID}-ghost` : undefined} />
      ) : null}
      {icon ? (
        <View style={[styles.icon, { backgroundColor: colors['bg.subtle'] }]}>
          <Icon name={icon} size={24} color={colors['fg.muted']} />
        </View>
      ) : null}
      <Text variant="heading" style={styles.centered}>
        {title}
      </Text>
      {body !== undefined ? (
        <Text variant="body" tone="muted" style={[styles.centered, styles.body]}>
          {body}
        </Text>
      ) : null}
      {primaryAction || secondaryAction ? (
        <View style={styles.actions}>
          {primaryAction ? (
            <Button
              label={primaryAction.label}
              onPress={primaryAction.onPress}
              testID={testID ? `${testID}-primary` : undefined}
            />
          ) : null}
          {secondaryAction ? (
            <Button
              label={secondaryAction.label}
              variant="ghost"
              onPress={secondaryAction.onPress}
              testID={testID ? `${testID}-secondary` : undefined}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space['3'], paddingVertical: space['10'] },
  icon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: { textAlign: 'center' },
  body: { maxWidth: 420 },
  actions: { flexDirection: 'row', gap: space['2'], marginTop: space['2'] },
  ghost: { alignSelf: 'stretch', gap: space['4'], borderRadius: radius.md + 2, maxWidth: 420 },
  ghostRows: { gap: space['3'] - 2 },
  ghostRow: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  ghostDot: { width: 10, height: 10, borderRadius: 3 },
  ghostName: { width: 58, height: 10, borderRadius: radius.pill },
  ghostTrack: { flex: 1, height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  ghostFill: { height: 8, borderRadius: radius.pill },
  ghostValue: { width: 46, height: 10, borderRadius: radius.pill },
  ghostChart: { flexDirection: 'row', alignItems: 'flex-end', gap: space['2'] - 2, height: 64 },
});
