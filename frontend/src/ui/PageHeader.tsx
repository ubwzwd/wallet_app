/**
 * The wide-screen page header every mockup opens with (01 / 02 / 09 / 11 / 12 / 14):
 * a 28/700 title, the page's numbers inline on the same baseline in mono, and one or two
 * actions pushed to the right. Screens 07 and 08 use the breadcrumb form instead — a round
 * back button plus a grey trail ("交易 · 09-08 · 招行储蓄卡 → 建行信用卡").
 *
 * Narrow screens keep the app's top bar, which already shows the title, so the header does
 * not draw it twice: only the inline stats, the subtitle and the actions survive
 * (decision §14.56).
 */
import React from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { raisedShadow } from './Card';
import { Icon } from './Icon';
import { Text } from './Text';

/** The mockups' back button: a true 40×40 circle (屏幕 08:42), lifted off the canvas. */
const BACK_SIZE = 40;
const BACK_SLOP = (44 - BACK_SIZE) / 2;

export interface PageHeaderBack {
  /** The grey trail shown next to the button. */
  crumb: string;
  onPress(): void;
  /** Accessible name for the button itself. */
  label: string;
}

export interface PageHeaderProps {
  title: string;
  /** Inline stats on the title's baseline. A string is rendered as mono secondary text. */
  meta?: React.ReactNode;
  /** The grey explainer under the title (screen 10). */
  subtitle?: string;
  /** One or two buttons, right-aligned. */
  actions?: React.ReactNode;
  back?: PageHeaderBack;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Width of `BackButton`, for layouts that balance it with a spacer of the same size. */
export const BACK_BUTTON_SIZE = BACK_SIZE;

export interface BackButtonProps {
  /** Accessible name — "back". */
  label: string;
  onPress(): void;
  testID?: string;
}

/**
 * The app's one round back button (decision §14.64 e): the wide header's crumb row, the
 * narrow sub-page top bar and the standalone ledger pages all draw this rather than their
 * own. A 40 circle lifted off the canvas, with slop out to the 44 touch target.
 */
export function BackButton({ label, onPress, testID }: BackButtonProps): React.JSX.Element {
  const { colors, scheme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={BACK_SLOP}
      testID={testID}
      style={({ pressed }) => [
        styles.back,
        raisedShadow(colors, scheme),
        { backgroundColor: pressed ? colors['bg.hover'] : colors['bg.raised'] },
      ]}
    >
      <Icon name="chevron-left" color={colors['fg.secondary']} />
    </Pressable>
  );
}

export interface PageBackRowProps extends PageHeaderBack {
  /** The row's testID. */
  testID?: string;
  /** The button's testID; `${testID}-back` by default. */
  backTestID?: string;
}

/**
 * The wide back row on its own: the round `BackButton` and the grey trail beside it
 * (屏幕稿 08). `PageHeader` draws its `back` with this, and so does a page whose head is not
 * a `PageHeader` (屏幕稿 12's ledger head is its own card), so the two can never drift.
 */
export function PageBackRow({
  crumb,
  onPress,
  label,
  testID,
  backTestID,
}: PageBackRowProps): React.JSX.Element {
  return (
    <View style={styles.crumbRow} testID={testID}>
      <BackButton
        label={label}
        onPress={onPress}
        testID={backTestID ?? (testID === undefined ? undefined : `${testID}-back`)}
      />
      <Text variant="caption" tone="muted" numberOfLines={1} style={styles.crumb}>
        {crumb}
      </Text>
    </View>
  );
}

function MetaNode({ meta, testID }: { meta: React.ReactNode; testID?: string }): React.JSX.Element {
  if (typeof meta === 'string') {
    return (
      <Text variant="body" tone="secondary" mono weight={500} testID={testID}>
        {meta}
      </Text>
    );
  }
  return <>{meta}</>;
}

export function PageHeader({
  title,
  meta,
  subtitle,
  actions,
  back,
  style,
  testID,
}: PageHeaderProps): React.JSX.Element | null {
  const wide = useIsWide();
  const id = testID ?? 'page-header';

  const hasBody = meta !== undefined || subtitle !== undefined || actions !== undefined;
  // Narrow: the top bar owns the title and the back arrow. With nothing else to say the
  // header would only add empty space, so it renders nothing at all.
  if (!wide && !hasBody) return null;

  return (
    <View testID={id} style={[styles.wrap, style]}>
      {wide && back ? (
        <PageBackRow
          crumb={back.crumb}
          onPress={back.onPress}
          label={back.label}
          backTestID={`${id}-back`}
        />
      ) : null}

      <View style={styles.row}>
        <View style={styles.titleBlock}>
          <View style={styles.titleLine}>
            {wide ? (
              <Text variant="title" testID={`${id}-title`}>
                {title}
              </Text>
            ) : null}
            {meta !== undefined ? <MetaNode meta={meta} testID={`${id}-meta`} /> : null}
          </View>
          {subtitle !== undefined ? (
            <Text variant="caption" tone="muted" testID={`${id}-subtitle`} style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actions !== undefined ? <View style={styles.actions}>{actions}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: space['4'] },
  crumbRow: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  back: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crumb: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space['5'],
  },
  titleBlock: { flexShrink: 1, minWidth: 0, gap: space['1'] },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: space['3'],
  },
  subtitle: { maxWidth: 560 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space['2'], flexShrink: 0 },
});
