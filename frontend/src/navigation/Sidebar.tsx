/**
 * The wide-layout sidebar (screens 01 / 09 / 12 / 13 / 14 at 1440, decisions §14.45, §14.56,
 * §14.64 c).
 *
 * Top to bottom: the ledger card (its body opens the switcher, its chevron goes to the
 * ledger's own settings), five destinations, the permanent "add a transaction" button, and
 * — pushed to the foot — the signed-in member.
 *
 * The column is the same on every page (§14.64 c): it names the tab's current ledger
 * (§14.66 b) on the ledger pages and on `/settings`, `/accounts*` and `/ledgers*` alike. On
 * `/ledgers*` none of the five is lit. The card's switcher lists every ledger, the ways to add
 * one, and — last — the ledger's settings (§14.65 a, `/ledger`); there is no ledger-list page.
 * Picking a ledger there changes the context, never the address (§14.66 d).
 *
 * "Ledger settings" is deliberately not a destination (§14.56): the card's chevron and the
 * personal-settings page are the two ways in. Neither is "reports" or "members" (§14.52
 * A21): statistics live on the home page, members inside the ledger's settings. Logging out
 * lives on the personal-settings page, not in this chrome.
 *
 * Every row here that changes page asks a form's leave guard first (§14.65 g).
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { User } from '@/api/types';
import { type RouteHref, routes } from '@/domain/routes';
import { density, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useAuth } from '@/store/AuthContext';
import { useOptionalLedgerContext } from '@/store/LedgerContext';
import { Avatar, Button, Icon, type IconName, Text } from '@/ui';

import { isActivePath } from './isActivePath';
import { useGuardedNavigate } from './leaveGuard';
import { isLedgerRoute } from './ledgerRoute';
import { LedgerSwitcherPopover, usePickLedger } from './LedgerSwitcher';
import { LedgerCard } from './SidebarCards';

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
 * Accounts belong to the user, not to a ledger (decision §14.62), so that entry is always
 * `/accounts`. For a user with no ledger at all, the three ledger pages would only bounce
 * to the onboarding page `/ledgers`, so they lead there directly.
 */
export function useSidebarDestinations(hasLedger: boolean): NavDestination[] {
  const { t } = useTranslation();
  const inLedger = (href: RouteHref): RouteHref => (hasLedger ? href : routes.ledgers());
  return [
    { key: 'home', label: t('common:nav.home'), icon: 'home', href: inLedger(routes.home()) },
    {
      key: 'transactions',
      label: t('common:nav.transactions'),
      icon: 'list',
      href: inLedger(routes.transactions()),
    },
    {
      key: 'sources',
      label: t('common:nav.sources'),
      icon: 'wallet',
      href: routes.accounts(),
    },
    {
      key: 'imports',
      label: t('common:nav.imports'),
      icon: 'upload',
      href: inLedger(routes.imports()),
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
  const guarded = useGuardedNavigate();
  const pathname = usePathname();
  const { user } = useAuth();
  const ledgerContext = useOptionalLedgerContext();

  // Mockup 14 keeps the ledger named even on `/settings`; §14.64 c does the same on
  // `/accounts*` (where 「账户」 is lit) and on `/ledgers*`, where none of the destinations
  // is the page the user is on.
  const onLedgerPages = isActivePath(pathname, routes.ledgers(), false);
  const ledger = ledgerContext?.ledger;
  const destinations = useSidebarDestinations(ledger !== undefined);
  const pick = usePickLedger();

  const cardRef = React.useRef<View | null>(null);
  const [switcherOpen, setSwitcherOpen] = React.useState(false);

  const pickLedger = (id: string): void => {
    setSwitcherOpen(false);
    pick(id);
  };

  const me = userLabel(user);
  // The role is the member's standing in the ledger the page shows, so only a ledger page
  // names it. Mockup 14: on the personal pages (`/settings`, `/accounts*`, `/ledgers*`) the
  // second line is the signed-in email instead — the row never shrinks to one line.
  const role = isLedgerRoute(pathname) ? ledgerContext?.myRole : undefined;
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
          onOpenSettings={() => guarded(() => router.navigate(routes.ledgerSettings()))}
        />
        <LedgerSwitcherPopover
          open={switcherOpen}
          onClose={() => setSwitcherOpen(false)}
          anchorRef={cardRef}
          ledgers={ledgerContext?.ledgers ?? []}
          currentId={ledger.id}
          onPick={pickLedger}
        />
      </View>
    );

  return (
    <View testID="sidebar" style={[styles.root, { backgroundColor: colors['bg.surface'] }]}>
      {/* The current ledger is settled before the shell renders (`CurrentLedgerProvider`),
          so the card never has to hold its slot or guess. */}
      {ledgerCard}

      <View style={styles.nav}>
        {destinations.map((item) => (
          <NavRow
            key={item.key}
            item={item}
            active={
              !onLedgerPages && isActivePath(pathname, item.href, item.href === routes.home())
            }
            onPress={() => guarded(() => router.navigate(item.href))}
          />
        ))}
      </View>

      {/* Nothing to add to for a user with no ledger. */}
      {ledger === undefined ? null : (
        <Button
          label={t('common:nav.add')}
          icon="plus"
          size="lg"
          fullWidth
          onPress={() => guarded(() => router.navigate(routes.transactionNew()))}
          testID="sidebar-add"
        />
      )}

      <Pressable
        accessibilityRole="link"
        accessibilityLabel={me}
        onPress={() => guarded(() => router.navigate(routes.settings()))}
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
