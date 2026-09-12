/**
 * The ledger switcher (04 §1.4, screens 01 and 13): every ledger the user belongs to, plus
 * the two ways to get another one. Picking a ledger keeps the page you are on — that is
 * `LedgerContext.switchTo` (04 §2.2), not a jump home.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Ledger } from '@/api/types';
import { routes } from '@/domain/routes';
import { density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useLedgerContext } from '@/store/LedgerContext';
import { Badge, Button, Icon, Sheet, Text } from '@/ui';

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
  const roleLabel = t(
    ledger.role === 'owner' ? 'ledger:list.card.role_owner' : 'ledger:list.card.role_member',
  );

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
      <View style={styles.rowText}>
        <Text variant="subheading" numberOfLines={1}>
          {ledger.name}
        </Text>
        <Text variant="caption" tone="muted" mono numberOfLines={1}>
          {ledger.base_currency}
        </Text>
      </View>
      <Badge label={roleLabel} tone={ledger.role === 'owner' ? 'info' : 'neutral'} />
      {current ? <Icon name="check" size={18} color={colors['accent.solid']} /> : null}
    </Pressable>
  );
}

export function LedgerSwitcher({ open, onClose }: LedgerSwitcherProps): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { ledgerId, ledgers, switchTo } = useLedgerContext();

  const go = (href: string): void => {
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
      <View style={styles.actions}>
        <Button
          label={t('ledger:list.empty.create_button')}
          icon="plus"
          variant="secondary"
          fullWidth
          onPress={() => go(routes.ledgersNew())}
          testID="ledger-switcher-new"
        />
        <Button
          label={t('ledger:list.empty.join_button')}
          icon="key-round"
          variant="ghost"
          fullWidth
          onPress={() => go(routes.ledgersJoin())}
          testID="ledger-switcher-join"
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 320 },
  row: {
    height: density.listRowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    paddingHorizontal: space['3'],
    borderRadius: radius.md,
  },
  rowText: { flex: 1, gap: space['1'] },
  actions: { gap: space['2'], paddingTop: space['3'] },
});
