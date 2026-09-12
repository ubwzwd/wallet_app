/**
 * The wide-layout sidebar (04 §1.4, screen 01 at 1440): ledger switcher on top, "add a
 * transaction" as the permanent primary button, six destinations, and the signed-in member
 * at the foot.
 *
 * There is deliberately no "reports" and no "members" entry (decision §14.52 A21):
 * statistics live on the home page, members inside the ledger's own settings page.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { User } from '@/api/types';
import { routes } from '@/domain/routes';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useAuth } from '@/store/AuthContext';
import { useLedgerContext } from '@/store/LedgerContext';
import { Button, Divider, Icon, type IconName, Text } from '@/ui';

export const SIDEBAR_WIDTH = 240;

/** How a signed-in user is named in the chrome: display name, else the email's local part. */
export function userLabel(user: Pick<User, 'display_name' | 'email'> | null): string {
  if (!user) return '';
  const name = user.display_name?.trim();
  if (name) return name;
  const at = user.email.indexOf('@');
  return at > 0 ? user.email.slice(0, at) : user.email;
}

export interface NavDestination {
  key: string;
  label: string;
  icon: IconName;
  href: string;
  /** A separator is drawn above this entry. */
  dividerBefore?: boolean;
}

/** `/l/<id>` matches only itself; every other entry also owns its sub-paths. */
export function isActivePath(pathname: string, href: string, exact: boolean): boolean {
  if (pathname === href) return true;
  return !exact && pathname.startsWith(`${href}/`);
}

/** The six sidebar destinations, in order (04 §1.4). */
export function useSidebarDestinations(ledgerId: string): NavDestination[] {
  const { t } = useTranslation();
  const l = routes.l(ledgerId);
  return [
    { key: 'home', label: t('common:nav.home'), icon: 'home', href: l.home() },
    { key: 'transactions', label: t('common:nav.transactions'), icon: 'list', href: l.transactions() },
    { key: 'sources', label: t('common:nav.sources'), icon: 'wallet', href: l.sources() },
    { key: 'imports', label: t('common:nav.imports'), icon: 'upload', href: l.imports() },
    {
      key: 'ledger-settings',
      label: t('common:nav.ledger_settings'),
      icon: 'users',
      href: l.settings(),
      dividerBefore: true,
    },
    { key: 'settings', label: t('common:nav.settings'), icon: 'settings', href: routes.settings() },
  ];
}

function NavRow({
  item,
  active,
  onPress,
}: {
  item: NavDestination;
  active: boolean;
  onPress(): void;
}): React.JSX.Element {
  const colors = useColors();
  const fg = active ? colors['accent.solid'] : colors['fg.secondary'];
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      testID={`sidebar-${item.key}`}
      style={({ pressed }) => [
        styles.navRow,
        {
          backgroundColor: active
            ? colors['bg.selected']
            : pressed
              ? colors['bg.hover']
              : 'transparent',
        },
      ]}
    >
      <Icon name={item.icon} size={18} color={fg} />
      <Text variant="subheading" style={{ color: fg }} numberOfLines={1}>
        {item.label}
      </Text>
    </Pressable>
  );
}

export interface SidebarProps {
  onOpenSwitcher(): void;
}

export function Sidebar({ onOpenSwitcher }: SidebarProps): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { ledgerId, ledger } = useLedgerContext();
  const destinations = useSidebarDestinations(ledgerId);
  const homeHref = routes.l(ledgerId).home();

  const signOut = async (): Promise<void> => {
    await logout();
    router.replace(routes.login());
  };

  return (
    <View
      testID="sidebar"
      style={[
        styles.root,
        { backgroundColor: colors['bg.surface'], borderRightColor: colors['border.default'] },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common:nav.switch_ledger')}
        onPress={onOpenSwitcher}
        testID="sidebar-ledger"
        style={({ pressed }) => [
          styles.ledgerRow,
          { backgroundColor: pressed ? colors['bg.hover'] : 'transparent' },
        ]}
      >
        <View style={styles.ledgerText}>
          <Text variant="subheading" numberOfLines={1}>
            {ledger.name}
          </Text>
          <Text variant="micro" tone="muted" mono numberOfLines={1}>
            {ledger.base_currency}
          </Text>
        </View>
        <Icon name="chevron-down" size={16} color={colors['fg.secondary']} />
      </Pressable>

      <Button
        label={t('common:nav.add')}
        icon="plus"
        fullWidth
        onPress={() => router.navigate(routes.l(ledgerId).transactionNew())}
        testID="sidebar-add"
      />

      <ScrollView style={styles.nav} contentContainerStyle={styles.navContent}>
        {destinations.map((item) => (
          <React.Fragment key={item.key}>
            {item.dividerBefore ? <Divider style={styles.divider} /> : null}
            <NavRow
              item={item}
              active={isActivePath(pathname, item.href, item.href === homeHref)}
              onPress={() => router.navigate(item.href)}
            />
          </React.Fragment>
        ))}
      </ScrollView>

      <Divider />
      <View style={styles.footer}>
        <Icon name="user" size={18} color={colors['fg.secondary']} />
        <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.footerName}>
          {userLabel(user)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common:nav.logout')}
          onPress={() => void signOut()}
          hitSlop={space['2']}
          testID="sidebar-logout"
        >
          <Icon name="log-out" size={18} color={colors['fg.secondary']} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: SIDEBAR_WIDTH,
    borderRightWidth: 1,
    paddingHorizontal: space['3'],
    paddingVertical: space['4'],
    gap: space['3'],
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['2'],
    padding: space['2'],
    borderRadius: radius.md,
  },
  ledgerText: { flex: 1 },
  nav: { flex: 1 },
  navContent: { gap: space['1'] },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    height: 44,
    paddingHorizontal: space['3'],
    borderRadius: radius.md,
  },
  divider: { marginVertical: space['2'] },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space['2'] },
  footerName: { flex: 1 },
});
