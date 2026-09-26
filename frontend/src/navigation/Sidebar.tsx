/**
 * The wide-layout sidebar (screens 01 / 09 / 12 / 13 / 14 at 1440, decisions §14.45, §14.56,
 * §14.64 c).
 *
 * Top to bottom: the ledger card (its body opens the switcher, its chevron goes to the
 * ledger's own settings), five destinations, the permanent "add a transaction" button, and
 * — pushed to the foot — the signed-in member.
 *
 * The column is the same on every page (§14.64 c): outside a ledger route (`/settings`,
 * `/ledgers*`) it names the ledger the user last had open. On `/ledgers*` none of the five
 * is lit. The card's switcher lists every ledger, the ways to add one, and — last — the
 * ledger's settings (§14.65 a); there is no ledger-list page.
 *
 * "Ledger settings" is deliberately not a destination (§14.56): the card's chevron and the
 * personal-settings page are the two ways in. Neither is "reports" or "members" (§14.52
 * A21): statistics live on the home page, members inside the ledger's settings. Logging out
 * lives on the personal-settings page, not in this chrome.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { User, Uuid } from '@/api/types';
import { type RouteHref, routes } from '@/domain/routes';
import { density, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useAuth } from '@/store/AuthContext';
import { useOptionalLedgerContext } from '@/store/LedgerContext';
import { Avatar, Button, Icon, type IconName, Text } from '@/ui';

import { isActivePath } from './isActivePath';
import { LedgerSwitcherPopover } from './LedgerSwitcher';
import { LedgerCard, LedgerCardPlaceholder } from './SidebarCards';
import { useChromeLedger } from './useChromeLedger';

/**
 * Screen 01 at 1440. The mockup's column is `width:252px;padding:20px 14px` with no
 * border-box reset, so the white band it paints is 252 + 2×14 = 280 wide; RN's box model
 * is border-box, so the same 14 of padding needs the outer 280 here.
 */
export const SIDEBAR_WIDTH = 280;

/** One navigation row, mockup 01's `height:44px`. */
const NAV_ROW_HEIGHT = 44;

/** How a signed-in user is named in the chrome: display name, else the email's local part. */
export function userLabel(user: Pick<User, 'display_name' | 'email'> | null): string {
  if (!user) return '';
  const name = user.display_name?.trim();
  if (name) return name;
  const at = user.email.indexOf('@');
  return at > 0 ? user.email.slice(0, at) : user.email;
}

// -------------------------------------------------------------------- destinations

export interface NavDestination {
  key: string;
  label: string;
  icon: IconName;
  href: RouteHref;
}

/**
 * The sidebar destinations, in order (§14.56): home, transactions, accounts, imports, me.
 * Without a ledger to scope them to, the four ledger-scoped entries all lead to `/ledgers`
 * — which lands on a ledger, or is the onboarding page for a user with none.
 */
export function useSidebarDestinations(ledgerId: string | null): NavDestination[] {
  const { t } = useTranslation();
  const l = ledgerId === null ? null : routes.l(ledgerId);
  const inLedger = (href: RouteHref | undefined): RouteHref => href ?? routes.ledgers();
  return [
    { key: 'home', label: t('common:nav.home'), icon: 'home', href: inLedger(l?.home()) },
    {
      key: 'transactions',
      label: t('common:nav.transactions'),
      icon: 'list',
      href: inLedger(l?.transactions()),
    },
    {
      key: 'sources',
      label: t('common:nav.sources'),
      icon: 'wallet',
      href: inLedger(l?.sources()),
    },
    {
      key: 'imports',
      label: t('common:nav.imports'),
      icon: 'upload',
      href: inLedger(l?.imports()),
    },
    // Personal settings — labelled "me", the same word the narrow tab bar uses.
    { key: 'settings', label: t('common:nav.me'), icon: 'user', href: routes.settings() },
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
      <Text weight={active ? 600 : 500} style={[styles.navLabel, { color: fg }]} numberOfLines={1}>
        {item.label}
      </Text>
    </Pressable>
  );
}

// -------------------------------------------------------------------------- sidebar

export function Sidebar(): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const ledgerContext = useOptionalLedgerContext();

  // Mockup 14 keeps the ledger named even on `/settings`; §14.64 c does the same on
  // `/ledgers*`, where none of the destinations is the page the user is on.
  const onLedgerPages = isActivePath(pathname, routes.ledgers(), false);
  const chrome = useChromeLedger();
  const ledger = chrome.ledger ?? undefined;
  const ledgerId = chrome.ledgerId;
  const destinations = useSidebarDestinations(ledgerId);
  const homeHref = ledgerId === null ? null : routes.l(ledgerId).home();

  const cardRef = React.useRef<View | null>(null);
  const [switcherOpen, setSwitcherOpen] = React.useState(false);

  const pickLedger = (id: Uuid): void => {
    setSwitcherOpen(false);
    // Inside a ledger, switching keeps the page you are on (04 §2.2). Outside one there is
    // no page to keep, so picking a ledger opens it.
    if (ledgerContext) ledgerContext.switchTo(id);
    else router.navigate(routes.l(id).home());
  };

  const me = userLabel(user);
  const role = ledgerContext?.myRole;
  // Mockup 14: outside a ledger there is no ledger to take a role from, and the second line
  // is the signed-in email instead — the row never shrinks to one line mid-navigation.
  const userSubtitle = role
    ? t(role === 'owner' ? 'ledger:list.card.role_owner' : 'ledger:list.card.role_member')
    : (user?.email ?? '');

  // No card for a user who belongs to no ledger at all: there is nothing to name, and the
  // five entries already lead to `/ledgers`, the onboarding page.
  const ledgerCard =
    ledger === undefined ? null : (
      <View ref={cardRef} collapsable={false}>
        <LedgerCard
          ledger={ledger}
          onOpenSwitcher={() => setSwitcherOpen(true)}
          onOpenSettings={() => router.navigate(routes.l(ledger.id).settings())}
        />
        <LedgerSwitcherPopover
          open={switcherOpen}
          onClose={() => setSwitcherOpen(false)}
          anchorRef={cardRef}
          ledgers={chrome.ledgers}
          currentId={ledger.id}
          onPick={pickLedger}
        />
      </View>
    );

  return (
    <View testID="sidebar" style={[styles.root, { backgroundColor: colors['bg.surface'] }]}>
      {/* The placeholder holds the card's slot while the answer is still in flight (a cold
          `/settings` or `/ledgers`), so the chrome never names the wrong ledger first. */}
      {chrome.pending ? <LedgerCardPlaceholder /> : ledgerCard}

      <View style={styles.nav}>
        {destinations.map((item) => (
          <NavRow
            key={item.key}
            item={item}
            active={!onLedgerPages && isActivePath(pathname, item.href, item.href === homeHref)}
            onPress={() => router.navigate(item.href)}
          />
        ))}
      </View>

      {/* Nothing to add to until a ledger is known (and never for a user with none). */}
      {ledgerId === null ? null : (
        <Button
          label={t('common:nav.add')}
          icon="plus"
          size="lg"
          fullWidth
          onPress={() => router.navigate(routes.l(ledgerId).transactionNew())}
          testID="sidebar-add"
        />
      )}

      <Pressable
        accessibilityRole="link"
        accessibilityLabel={me}
        onPress={() => router.navigate(routes.settings())}
        testID="sidebar-user"
        style={({ pressed }) => [
          styles.userRow,
          { backgroundColor: pressed ? colors['bg.hover'] : 'transparent' },
        ]}
      >
        <Avatar name={me} size={32} shape="circle" tone="muted" />
        <View style={styles.userText}>
          <Text weight={500} style={styles.userName} numberOfLines={1}>
            {me}
          </Text>
          {userSubtitle ? (
            <Text tone="muted" style={styles.userRole} numberOfLines={1}>
              {userSubtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: SIDEBAR_WIDTH,
    paddingHorizontal: density.rowInnerPadding,
    paddingVertical: space['5'],
    gap: space['5'],
  },
  nav: { gap: 2 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    height: NAV_ROW_HEIGHT,
    paddingHorizontal: space['3'],
    borderRadius: 12,
  },
  navLabel: { fontSize: 15, lineHeight: 20 },
  userRow: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingVertical: space['2'],
    paddingHorizontal: space['3'],
    borderRadius: 12,
  },
  userText: { flex: 1, minWidth: 0 },
  userName: { fontSize: 14, lineHeight: 19 },
  userRole: { fontSize: 11, lineHeight: 15 },
});
