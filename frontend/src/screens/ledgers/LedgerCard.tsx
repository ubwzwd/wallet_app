/**
 * One ledger, as screen 13 draws it.
 *
 * A card carries only what one `GET /ledgers` already knows — name, base currency, member
 * count and my role. No net worth and no transaction count (decision §14.52 A16: both would
 * cost one accounts+rates round trip per ledger).
 *
 * The ledger the user is currently in is marked three times over — tinted fill, accent
 * outline, a tick, and (on narrow) a 「当前」 badge — because opening the wrong ledger is the
 * hardest mistake in this app to notice.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Ledger } from '@/api/types';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { Avatar, Button, Icon, Text, raisedShadow } from '@/ui';

const AVATAR = 44;

function useLedgerLines(ledger: Ledger): { role: string; members: string } {
  const { t } = useTranslation();
  return {
    role: t(
      ledger.role === 'owner' ? 'ledger:list.card.role_line_owner' : 'ledger:list.card.role_line_member',
    ),
    members: t('common:nav.member_count', { count: ledger.member_count }),
  };
}

export interface LedgerCardProps {
  ledger: Ledger;
  current: boolean;
  wide: boolean;
  onPress(): void;
}

export function LedgerCard({ ledger, current, wide, onPress }: LedgerCardProps): React.JSX.Element {
  const { colors, scheme } = useTheme();
  const { t } = useTranslation();
  const lines = useLedgerLines(ledger);

  const surface = {
    backgroundColor: current ? colors['bg.selected'] : colors['bg.surface'],
    borderWidth: current ? 1.5 : 0,
    borderColor: current ? colors['accent.solid'] : undefined,
  };
  const statBg = current ? colors['bg.surface'] : colors['bg.canvas'];

  const body = (
    <>
      <View style={styles.head}>
        <Avatar
          name={ledger.name}
          shape="square"
          size={AVATAR}
          tone={current ? 'accent' : 'muted'}
        />
        <View style={styles.headText}>
          <View style={styles.nameLine}>
            <Text weight={700} numberOfLines={1} style={styles.name}>
              {ledger.name}
            </Text>
            {current && !wide ? (
              <View style={[styles.badge, { backgroundColor: colors['accent.subtle'] }]}>
                <Text variant="micro" weight={600} tone="accent">
                  {t('ledger:list.current_badge')}
                </Text>
              </View>
            ) : null}
          </View>
          <Text
            variant="caption"
            tone="muted"
            numberOfLines={2}
            testID={`ledger-role-${ledger.id}`}
          >
            {lines.role}
          </Text>
        </View>
        {current ? <Icon name="check" size={22} color={colors['accent.solid']} /> : null}
      </View>

      {wide ? (
        <View style={styles.rows}>
          <View style={[styles.row, { borderBottomColor: colors['border.default'] }]}>
            <Text variant="body" tone="muted">
              {t('ledger:list.card.members_label')}
            </Text>
            <Text variant="body" mono weight={500}>
              {lines.members}
            </Text>
          </View>
          <View style={styles.rowLast}>
            <Text variant="body" tone="muted">
              {t('ledger:list.card.currency_label')}
            </Text>
            <Text variant="body" mono weight={500}>
              {ledger.base_currency}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.stats}>
          <View style={[styles.stat, { backgroundColor: statBg }]}>
            <Text variant="micro" weight={400} tone="muted">
              {t('ledger:list.card.members_label')}
            </Text>
            <Text variant="subheading" mono weight={500}>
              {lines.members}
            </Text>
          </View>
          <View style={[styles.stat, { backgroundColor: statBg }]}>
            <Text variant="micro" weight={400} tone="muted">
              {t('ledger:list.card.currency_label')}
            </Text>
            <Text variant="subheading" mono weight={500}>
              {ledger.base_currency}
            </Text>
          </View>
        </View>
      )}

      {wide ? (
        <Button
          testID={`ledger-open-${ledger.id}`}
          label={t(current ? 'ledger:list.enter' : 'ledger:list.switch_to')}
          variant={current ? 'primary' : 'soft'}
          onPress={onPress}
          fullWidth
        />
      ) : null}
    </>
  );

  const skin = [
    styles.card,
    { padding: wide ? space['5'] : space['4'] },
    surface,
    current ? null : raisedShadow(colors, scheme),
  ];

  // Wide cards carry their own button, so the card itself must not also be one: a button
  // inside a button is invalid on the web, and the label already says what the card does.
  // Narrow cards have no button, so the whole card is the target.
  if (wide) {
    return (
      <View
        accessibilityState={{ selected: current }}
        testID={`ledger-card-${ledger.id}`}
        style={skin}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ledger.name}
      accessibilityState={{ selected: current }}
      onPress={onPress}
      testID={`ledger-card-${ledger.id}`}
      // touch-target-exempt: the target is the whole card — `styles.card` carries the 44
      // floor, but it reaches the Pressable through the `skin` array the verifier cannot
      // follow, and the card is ~150 high in practice.
      style={({ pressed }) => [...skin, pressed ? { opacity: 0.92 } : null]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, gap: space['4'], minHeight: 44 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  name: { flexShrink: 1, fontSize: 18, lineHeight: 25 },
  badge: { height: 22, paddingHorizontal: space['2'], borderRadius: 7, justifyContent: 'center' },
  rows: { marginTop: -space['1'] },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space['3'],
    paddingVertical: space['2'],
    borderBottomWidth: 1,
  },
  rowLast: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space['3'],
    paddingVertical: space['2'],
  },
  stats: { flexDirection: 'row', gap: space['2'] },
  stat: {
    flex: 1,
    gap: 2,
    paddingVertical: 10,
    paddingHorizontal: space['3'],
    borderRadius: 12,
  },
});
