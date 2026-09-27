/**
 * The card at the top of the wide sidebar (mockups 01 / 14 at 1440).
 *
 * It is the same card on every page (§14.64 c) — the ledger pages, `/settings`, `/accounts*`
 * and `/ledgers*`: it names the tab's current ledger, the body opens the switcher, the
 * chevron goes to that ledger's settings (`/ledger`).
 *
 * Split out of `Sidebar.tsx` to keep both files inside the project's 400-line rule.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Ledger } from '@/api/types';
import { memberLabel, useMembers } from '@/queries';
import { density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Avatar, Icon, Text } from '@/ui';

/** At most this many members are named in full on the ledger card; beyond it, a count. */
const NAMED_MEMBER_LIMIT = 3;

/**
 * The card's second line: "CNY · 我 + 老婆" while the member list is small enough to name
 * everyone, "CNY · 4 人" otherwise (and while the list is still loading).
 */
export function useLedgerCardMeta(ledger: Ledger): string {
  const { t } = useTranslation();
  const { data } = useMembers(ledger.id);
  const items = data?.items;
  const names =
    items && items.length > 0 && items.length <= NAMED_MEMBER_LIMIT
      ? items.map(memberLabel).join(' + ')
      : t('common:nav.member_count', { count: ledger.member_count });
  return `${ledger.base_currency} · ${names}`;
}

export interface LedgerCardProps {
  ledger: Ledger;
  onOpenSwitcher(): void;
  onOpenSettings(): void;
}

export function LedgerCard({
  ledger,
  onOpenSwitcher,
  onOpenSettings,
}: LedgerCardProps): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  const meta = useLedgerCardMeta(ledger);

  return (
    // Screen 01 fills the card with `bg.canvas` at rest and darkens it to `bg.subtle` on
    // the press — the other way round, the press was one invisible step away from resting.
    <View style={[styles.card, { backgroundColor: colors['bg.canvas'] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common:nav.switch_ledger')}
        onPress={onOpenSwitcher}
        testID="sidebar-ledger"
        style={({ pressed }) => [
          styles.cardBody,
          { backgroundColor: pressed ? colors['bg.subtle'] : 'transparent' },
        ]}
      >
        <Avatar name={ledger.name} size={32} shape="square" tone="accent" />
        <View style={styles.cardText}>
          <Text weight={600} style={styles.cardName} numberOfLines={1}>
            {ledger.name}
          </Text>
          <Text mono tone="muted" style={styles.cardMeta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('common:nav.ledger_settings')}
        onPress={onOpenSettings}
        hitSlop={space['2']}
        testID="sidebar-ledger-settings"
        style={({ pressed }) => [
          styles.cardChevron,
          { backgroundColor: pressed ? colors['bg.subtle'] : 'transparent' },
        ]}
      >
        <Icon name="chevron-right" size={16} color={colors['fg.secondary']} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: density.listRowHeight,
    borderRadius: radius.md,
  },
  cardBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: density.listRowHeight,
    paddingHorizontal: space['3'],
    borderRadius: radius.md,
  },
  cardText: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 15, lineHeight: 20 },
  cardMeta: { fontSize: 11, lineHeight: 15 },
  cardChevron: {
    width: 28,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
});
