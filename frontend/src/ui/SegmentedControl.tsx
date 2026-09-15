/**
 * SegmentedControl (04 §6.4, mockups 02 / 11 / 14): a pill track in `bg.subtle` holding
 * one white, softly lifted segment.
 *
 * Two sizes: `md` (44 high, radius 14) drives the kind tabs, the transfer subtype and the
 * appearance switch; `sm` (36 high, radius 12) is the小 filter in a page header
 * (「全部 / 待提交 / 已提交」). Always controlled.
 */
import React from 'react';
import { Pressable, type StyleProp, View, type ViewStyle } from 'react-native';
import { controls, radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type SegmentedSize = 'sm' | 'md';

/** Track height / radius and the padding that turns into the inner pill's inset. */
const SIZES = {
  sm: { height: controls.button.heights.sm + space['2'], radius: radius.md - 2, pad: space['1'] },
  md: { height: controls.button.heights.md + space['1'], radius: radius.md, pad: space['1'] },
};

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  icon?: IconName;
  /** A small trailing count (already formatted by the caller). */
  badge?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  value: T;
  onChange(next: T): void;
  options: readonly SegmentOption<T>[];
  size?: SegmentedSize;
  /** `sm` headers size to their content; the default stretches every segment equally. */
  stretch?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SegmentedControl<T extends string = string>({
  value,
  onChange,
  options,
  size = 'md',
  stretch,
  accessibilityLabel,
  style,
  testID,
}: SegmentedControlProps<T>): React.JSX.Element {
  const { colors, scheme } = useTheme();
  const step = SIZES[size];
  const fill = stretch ?? size === 'md';

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[
        {
          height: size === 'md' ? controls.button.heights.md : step.height,
          flexDirection: 'row',
          alignItems: 'stretch',
          alignSelf: fill ? 'stretch' : 'flex-start',
          padding: step.pad,
          gap: step.pad,
          borderRadius: step.radius,
          backgroundColor: colors['bg.subtle'],
        },
        style,
      ]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const fg = option.disabled
          ? colors['fg.muted']
          : selected
            ? colors['fg.primary']
            : colors['fg.secondary'];
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled: option.disabled ?? false }}
            accessibilityLabel={option.label}
            disabled={option.disabled}
            onPress={() => onChange(option.value)}
            testID={testID ? `${testID}-${option.value}` : undefined}
            // The track is 44 high but padded, so the segment itself is only 36. The
            // vertical slop takes the tap target back to 44 without changing the control's
            // drawn height (04 §6.4). Vertical only — a horizontal slop would overlap the
            // neighbouring segment across the gap.
            hitSlop={{ top: space['2'], bottom: space['2'] }}
            style={({ pressed }) => [
              {
                flex: fill ? 1 : undefined,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: space['1'] + 2,
                paddingHorizontal: fill ? space['2'] : space['4'] - 2,
                // The inner pill sits inside the track's padding, so its radius is the
                // track's minus that padding — still a token value, not a magic number.
                borderRadius: step.radius - step.pad,
                backgroundColor: selected
                  ? colors['bg.raised']
                  : pressed
                    ? colors['bg.hover']
                    : 'transparent',
              },
              // The selected pill lifts off the track; dark mode layers by lightness only.
              selected && scheme === 'light'
                ? {
                    shadowColor: colors['fg.primary'],
                    shadowOpacity: 0.14,
                    shadowRadius: 4,
                    shadowOffset: { width: 0, height: 1 },
                    elevation: 1,
                  }
                : null,
            ]}
          >
            {option.icon ? <Icon name={option.icon} size={16} color={fg} /> : null}
            <Text
              variant="body"
              weight={600}
              style={{ color: fg }}
              numberOfLines={1}
            >
              {option.label}
            </Text>
            {option.badge !== undefined ? (
              <Text variant="micro" mono style={{ color: colors['fg.muted'] }}>
                {option.badge}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
