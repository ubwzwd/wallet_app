/**
 * "Once you join" — the block screen 13 puts under the code input, because what a member
 * can and cannot do is the question families actually ask.
 *
 * A second white card with three bulleted lines, at both widths (the wide dialog that
 * folded them into one tinted paragraph is gone, §14.65 d).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Card, Text } from '@/ui';

const BULLET = 6;

export function JoinBenefits(): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const lines = [
    t('ledger:join.benefits.one'),
    t('ledger:join.benefits.two'),
    t('ledger:join.benefits.three'),
  ];

  return (
    <Card variant="raised" testID="join-benefits" style={styles.card}>
      <Text variant="caption" weight={600} tone="secondary">
        {t('ledger:join.benefits.title')}
      </Text>
      <View style={styles.lines}>
        {lines.map((line, i) => (
          <View key={line} style={styles.line}>
            <View
              style={[
                styles.bullet,
                { backgroundColor: i === 0 ? colors['accent.solid'] : colors['border.strong'] },
              ]}
            />
            <Text variant="body" tone="secondary" style={styles.lineText}>
              {line}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: space['4'], gap: space['2'] },
  lines: { gap: space['2'] },
  line: { flexDirection: 'row', gap: 9 },
  bullet: { width: BULLET, height: BULLET, borderRadius: radius.pill, marginTop: 7 },
  lineText: { flex: 1 },
});
