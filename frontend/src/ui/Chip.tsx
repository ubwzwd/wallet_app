/**
 * Chip (04 §6.4, §6.2 rule 4): a round pill the user can toggle or dismiss — filters,
 * "from import #12", the review slices. Never used for system marks (that is `Badge`).
 */
import React from 'react';
import { Pressable, type StyleProp, View, type ViewStyle } from 'react-native';
import { controls, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface ChipProps {
  label: string;
  selected?: boolean;
  icon?: IconName;
  onPress?: () => void;
  /** Renders a × button; its accessible name falls back to the chip label. */
  onRemove?: () => void;
  removeLabel?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Chip({
  label,
  selected = false,
  icon,
  onPress,
  onRemove,
  removeLabel,
  disabled = false,
  style,
  testID,
}: ChipProps): React.JSX.Element {
  const colors = useColors();
  const fg = disabled
    ? colors['fg.muted']
    : selected
      ? colors['accent.solid']
      : colors['fg.primary'];

  const body = (
    <>
      {icon ? <Icon name={icon} size={16} color={fg} /> : null}
      <Text variant="body" style={{ color: fg }} numberOfLines={1}>
        {label}
      </Text>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={removeLabel ?? label}
          onPress={onRemove}
          disabled={disabled}
          hitSlop={space['2']}
          testID={testID ? `${testID}-remove` : 'chip-remove'}
        >
          <Icon name="x" size={16} color={fg} />
        </Pressable>
      ) : null}
    </>
  );

  const shape: ViewStyle = {
    height: controls.chip.height,
    borderRadius: radius.pill,
    paddingHorizontal: space['3'],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['2'],
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: selected ? colors['accent.solid'] : colors['border.default'],
    backgroundColor: selected ? colors['bg.selected'] : colors['bg.subtle'],
  };

  if (!onPress) {
    return (
      <View testID={testID} style={[shape, style]}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: 5, bottom: 5 }}
      style={({ pressed }) => [
        shape,
        pressed && !disabled ? { backgroundColor: colors['bg.hover'] } : null,
        style,
      ]}
    >
      {body}
    </Pressable>
  );
}
