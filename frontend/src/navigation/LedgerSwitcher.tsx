/**
 * The ledger switcher (04 §1.4, screens 01 and 13): every ledger the user belongs to, plus
 * the two ways to get another one. Picking a ledger keeps the page you are on — that is
 * `LedgerContext.switchTo` (04 §2.2), not a jump home.
 *
 * Screen 01 draws it as a small overlay: a square letter tile, the ledger's name, its base
 * currency and member count beneath, a tick on the current one, then "create a ledger".
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Ledger } from '@/api/types';
import { type RouteHref, routes } from '@/domain/routes';
import { density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useLedgerContext } from '@/store/LedgerContext';
import { Divider, Icon, type IconName, Sheet, Text } from '@/ui';

import { LetterAvatar } from './LetterAvatar';

export interface LedgerSwitcherProps {
  open: boolean;
  onClose(): void;
}

function LedgerRow({
  ledger,
  current,
  onPress,
}: {
  ledger: Ledger;
  current: boolean;
  onPress(): void;
}): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: current }}
      onPress={onPress}
      testID={`ledger-switcher-row-${ledger.id}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: current
            ? colors['bg.selected']
            : pressed
              ? colors['bg.hover']
              : 'transparent',
        },
      ]}
    >
      <LetterAvatar name={ledger.name} size={26} shape="square" tone={current ? 'accent' : 'subtle'} />
      <View style={styles.rowText}>
        <Text weight={current ? 600 : 500} style={styles.rowName} numberOfLines={1}>
          {ledger.name}
        </Text>
        <Text mono tone="muted" style={styles.rowMeta} numberOfLines={1}>
          {`${ledger.base_currency} · ${t('common:nav.member_count', { count: ledger.member_count })}`}
        </Text>
      </View>
      {current ? <Icon name="check" size={18} color={colors['accent.solid']} /> : null}
    </Pressable>
  );
}

function ActionRow({
  label,
  icon,
  onPress,
  testID,
}: {
  label: string;
  icon: IconName;
  onPress(): void;
  testID: string;
}): React.JSX.Element {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors['bg.hover'] : 'transparent' },
      ]}
    >
      <Icon name={icon} size={18} color={colors['accent.solid']} />
      <Text weight={600} tone="accent" style={styles.rowName} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function LedgerSwitcher({ open, onClose }: LedgerSwitcherProps): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { ledgerId, ledgers, switchTo } = useLedgerContext();

  const go = (href: RouteHref): void => {
    onClose();
    router.navigate(href);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('common:nav.switch_ledger')}
      closeLabel={t('common:button.close')}
      testID="ledger-switcher"
    >
      <ScrollView style={styles.list}>
        {ledgers.map((ledger) => (
          <LedgerRow
            key={ledger.id}
            ledger={ledger}
            current={ledger.id === ledgerId}
            onPress={() => {
              onClose();
              switchTo(ledger.id);
            }}
          />
        ))}
      </ScrollView>
      <Divider style={styles.divider} />
      <ActionRow
        label={t('ledger:list.empty.create_button')}
        icon="plus"
        onPress={() => go(routes.ledgersNew())}
        testID="ledger-switcher-new"
      />
      <ActionRow
        label={t('ledger:list.empty.join_button')}
        icon="key-round"
        onPress={() => go(routes.ledgersJoin())}
        testID="ledger-switcher-join"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 320 },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: space['2'],
    paddingHorizontal: space['3'],
    borderRadius: 11,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 15, lineHeight: 20 },
  rowMeta: { fontSize: 12, lineHeight: 16 },
  divider: { marginVertical: space['1'], marginHorizontal: density.rowInnerPadding },
});
