/**
 * SegmentedControl (04 §6.4): height 44, radius 14. Drives the kind tabs, the transfer
 * subtype and the review row slices — always controlled.
 */
import React from 'react';
import { Pressable, type StyleProp, View, type ViewStyle } from 'react-native';
import { controls, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

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
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SegmentedControl<T extends string = string>({
  value,
  onChange,
  options,
  accessibilityLabel,
  style,
  testID,
}: SegmentedControlProps<T>): React.JSX.Element {
  const colors = useColors();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[
        {
          height: controls.button.heights.md,
          flexDirection: 'row',
          alignItems: 'stretch',
          padding: space['1'],
          gap: space['1'],
          borderRadius: radius.md,
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
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: space['1'],
              // The inner pill sits inside the track's padding, so its radius is the
              // track's minus that padding — still a token value, not a magic number.
              borderRadius: radius.md - space['1'],
              backgroundColor: selected
                ? colors['bg.raised']
                : pressed
                  ? colors['bg.hover']
                  : 'transparent',
            })}
          >
            {option.icon ? <Icon name={option.icon} size={16} color={fg} /> : null}
            <Text variant="body" weight={selected ? 600 : 400} style={{ color: fg }} numberOfLines={1}>
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
