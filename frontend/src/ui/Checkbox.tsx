/** Checkbox: a 20px box plus optional label, one implementation on both platforms. */
import React from 'react';
import { Pressable, type StyleProp, View, type ViewStyle } from 'react-native';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon } from './Icon';
import { Text } from './Text';

export interface CheckboxProps {
  checked: boolean;
  onChange(next: boolean): void;
  label?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  /** Renders the "some but not all" state (bulk selection headers). */
  indeterminate?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Checkbox({
  checked,
  onChange,
  label,
  accessibilityLabel,
  disabled = false,
  indeterminate = false,
  style,
  testID,
}: CheckboxProps): React.JSX.Element {
  const colors = useColors();
  const on = checked || indeterminate;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: indeterminate ? 'mixed' : checked, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      hitSlop={space['3']}
      testID={testID}
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: space['2'], minHeight: 44 },
        style,
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        pointerEvents="none"
        style={{
          width: 20,
          height: 20,
          borderRadius: radius.sm - 2,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1.5,
          borderColor: disabled
            ? colors['border.default']
            : on
              ? colors['accent.solid']
              : colors['border.strong'],
          backgroundColor: on ? colors['accent.solid'] : 'transparent',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {on ? (
          <Icon
            name={indeterminate && !checked ? 'chevron-down' : 'check'}
            size={14}
            color={colors['accent.fg']}
          />
        ) : null}
      </View>
      {label !== undefined ? (
        <Text variant="body" tone={disabled ? 'muted' : 'primary'}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}
