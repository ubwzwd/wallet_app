/**
 * The detail page's action row (04 §4.7, decision §14.52 A8).
 *
 * The screens decide *what* is offered — 编辑 / 复制一笔 / 登记退款（只有支出）/ 拆开（两腿）/
 * 删除 — and this renders it as one wrapping row so a narrow screen stacks instead of
 * clipping. There is deliberately no 「分享」(decision §14.52 A8).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { space } from '@/theme/tokens';
import { Button, type ButtonVariant, type IconName } from '@/ui';

export interface DetailAction {
  /** Stable key, also the button's `testID` suffix. */
  key: string;
  label: string;
  icon?: IconName;
  variant?: ButtonVariant;
  onPress(): void;
  disabled?: boolean;
  loading?: boolean;
}

export interface DetailActionsProps {
  actions: readonly DetailAction[];
  testID?: string;
}

export function DetailActions({ actions, testID }: DetailActionsProps): React.JSX.Element {
  const id = testID ?? 'detail-actions';
  return (
    <View style={styles.row} testID={id}>
      {actions.map((a) => (
        <Button
          key={a.key}
          testID={`${id}-${a.key}`}
          label={a.label}
          icon={a.icon}
          variant={a.variant ?? 'secondary'}
          size="sm"
          onPress={a.onPress}
          disabled={a.disabled}
          loading={a.loading}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'], alignSelf: 'stretch' },
});
