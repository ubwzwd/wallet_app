/**
 * `‹ 2026 年 8 月 ›` (04 §4.4): the home page's month selector. It never walks past
 * `max` (the current month by default) — there can be no future months to summarise.
 */
import React from 'react';
import { Pressable, type StyleProp, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { currentMonth, isAfterMonth, shiftMonth } from '@/domain/dates';
import { type Lang, useLang } from '@/i18n';
import { formatMonth } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon } from './Icon';
import { Text } from './Text';

export interface MonthSwitcherProps {
  /** `'YYYY-MM'`. */
  value: string;
  onChange(next: string): void;
  /** Latest selectable month, default: the current local month. */
  max?: string;
  /** Earliest selectable month; unbounded when omitted. */
  min?: string;
  lang?: Lang;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function MonthSwitcher({
  value,
  onChange,
  max,
  min,
  lang,
  style,
  testID,
}: MonthSwitcherProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const activeLang = useLang();
  const l = lang ?? activeLang;

  const upper = max ?? currentMonth();
  const prev = shiftMonth(value, -1);
  const next = shiftMonth(value, 1);
  const prevDisabled = min !== undefined && isAfterMonth(min, prev);
  const nextDisabled = isAfterMonth(next, upper);

  const arrow = (
    direction: 'prev' | 'next',
    target: string,
    disabled: boolean,
  ): React.JSX.Element => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(
        direction === 'prev' ? 'stats:home.month_prev' : 'stats:home.month_next',
      )}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onChange(target)}
      hitSlop={space['2']}
      testID={testID ? `${testID}-${direction}` : `month-${direction}`}
      style={({ pressed }) => [
        {
          width: 36,
          height: 36,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : 1,
          backgroundColor: pressed && !disabled ? colors['bg.hover'] : 'transparent',
        },
      ]}
    >
      <Icon
        name={direction === 'prev' ? 'chevron-left' : 'chevron-right'}
        color={colors[disabled ? 'fg.muted' : 'fg.secondary']}
      />
    </Pressable>
  );

  return (
    <View
      testID={testID}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }, style]}
    >
      {arrow('prev', prev, prevDisabled)}
      <Text
        variant="heading"
        mono
        style={{ minWidth: 140, textAlign: 'center' }}
        testID={testID ? `${testID}-label` : 'month-label'}
      >
        {formatMonth(value, l)}
      </Text>
      {arrow('next', next, nextDisabled)}
    </View>
  );
}
