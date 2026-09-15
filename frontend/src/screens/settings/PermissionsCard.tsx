/**
 * Ledger settings → 权限 (屏幕稿 12): two bullets that say what a member may do and what
 * only the owner may do (decision §2). Read-only; it is the legend for everything else on
 * the page, which is why it sits at the top of the right column.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Card, Text } from '@/ui';

function Bullet({ strong, children }: { strong: boolean; children: string }): React.JSX.Element {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: space['2'] + 1 }}>
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: radius.pill,
          marginTop: 7,
          flexShrink: 0,
          backgroundColor: strong ? colors['accent.solid'] : colors['border.strong'],
        }}
      />
      <Text variant="body" tone="secondary" style={{ flex: 1, lineHeight: 20 }}>
        {children}
      </Text>
    </View>
  );
}

export function PermissionsCard(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Card variant="raised" testID="permission-hint" style={{ padding: space['5'], gap: space['3'] }}>
      <Text variant="subheading" weight={700} accessibilityRole="header">
        {t('ledger:settings.permission.title')}
      </Text>
      <View style={{ gap: space['2'] + 2 }}>
        <Bullet strong={false}>{t('ledger:settings.permission.member_line')}</Bullet>
        <Bullet strong>{t('ledger:settings.permission.owner_line')}</Bullet>
      </View>
    </Card>
  );
}

export default PermissionsCard;
