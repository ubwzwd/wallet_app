/** Themed wrapper around the platform switch, with an optional inline label. */
import React from 'react';
import { Switch as RNSwitch, type StyleProp, View, type ViewStyle } from 'react-native';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Text } from './Text';

export interface SwitchProps {
  value: boolean;
  onChange(next: boolean): void;
  label?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Switch({
  value,
  onChange,
  label,
  accessibilityLabel,
  disabled = false,
  style,
  testID,
}: SwitchProps): React.JSX.Element {
  const colors = useColors();
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: space['3'], minHeight: 44 },
        style,
      ]}
    >
      {label !== undefined ? (
        <Text variant="body" tone={disabled ? 'muted' : 'primary'} style={{ flex: 1 }}>
          {label}
        </Text>
      ) : null}
      <RNSwitch
        accessibilityRole="switch"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ checked: value, disabled }}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        testID={testID}
        trackColor={{ false: colors['bg.hover'], true: colors['accent.solid'] }}
        thumbColor={colors['bg.raised']}
      />
    </View>
  );
}
