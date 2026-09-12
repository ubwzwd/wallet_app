/**
 * EmptyState (04 §6.4, screen 15): icon + headline + one sentence + up to two actions.
 * Every list page passes its own copy, which always comes from the language pack.
 */
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface EmptyStateAction {
  label: string;
  onPress(): void;
}

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function EmptyState({
  icon,
  title,
  body,
  primaryAction,
  secondaryAction,
  style,
  testID,
}: EmptyStateProps): React.JSX.Element {
  const colors = useColors();
  return (
    <View
      testID={testID}
      style={[
        { alignItems: 'center', gap: space['3'], paddingVertical: space['10'] },
        style,
      ]}
    >
      {icon ? (
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors['bg.subtle'],
          }}
        >
          <Icon name={icon} size={24} color={colors['fg.muted']} />
        </View>
      ) : null}
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {body !== undefined ? (
        <Text variant="body" tone="muted" style={{ textAlign: 'center', maxWidth: 420 }}>
          {body}
        </Text>
      ) : null}
      {primaryAction || secondaryAction ? (
        <View style={{ flexDirection: 'row', gap: space['2'], marginTop: space['2'] }}>
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
