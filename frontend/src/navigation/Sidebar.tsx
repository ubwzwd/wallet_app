/**
 * The wide-layout sidebar (screens 01 / 09 / 12 / 13 / 14 at 1440, decisions §14.45, §14.56).
 *
 * Top to bottom: the ledger card (its body opens the switcher, its chevron goes to the
 * ledger's own settings), five destinations, the permanent "add a transaction" button, and
 * — pushed to the foot — the signed-in member.
 *
 * `/ledgers*` is the one place that column is different (mockup 13): the card names the
 * ledger *list*, the nav shrinks to the three ledger-scoped entries that still have somewhere
 * to go, and there is no 「＋ 记一笔」 — no ledger is open, so there is nothing to add to.
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

import type { Ledger, User, Uuid } from '@/api/types';
import { type RouteHref, routes } from '@/domain/routes';
import { useLedgers } from '@/queries';
import { density, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useAuth } from '@/store/AuthContext';
import { useOptionalLedgerContext } from '@/store/LedgerContext';
import { Avatar, Button, Icon, type IconName, Text } from '@/ui';

import { isActivePath } from './isActivePath';
import { pickLandingLedger } from './LandingRedirect';
import { LedgerSwitcherPopover } from './LedgerSwitcher';
import {
  LedgerCard,
  LedgerCardPlaceholder,
  LedgerManageCard,
  showsLedgerManageCard,
} from './SidebarCards';
import { useLastLedgerId } from './useLastLedgerId';

// Re-exported so the shell's tests and `src/navigation/index.ts` keep one import site.
export { showsLedgerManageCard };

/**
 * Screen 01 at 1440. The mockup's column is `width:252px;padding:20px 14px` with no
 * border-box reset, so the white band it paints is 252 + 2×14 = 280 wide; RN's box model
 * is border-box, so the same 14 of padding needs the outer 280 here.
 */
export const SIDEBAR_WIDTH = 280;

/** One navigation row, mockup 01's `height:44px` — also the unit the cold placeholder uses. */
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
 * Without a ledger to scope them to, the four ledger-scoped entries all lead to the ledger
 * list — which is where the user has to pick one anyway.
 *
 * `manage` is mockup 13's own column (`/ledgers*`): only 首页 / 交易 / 导入, pointing at the
 * ledger the user last had open, and nothing at all when there is no such ledger — a link
 * from the ledger list back to the ledger list is not a destination.
 */
export function useSidebarDestinations(ledgerId: string | null, manage = false): NavDestination[] {
  const { t } = useTranslation();
  const l = ledgerId === null ? null : routes.l(ledgerId);
  const inLedger = (href: RouteHref | undefined): RouteHref => href ?? routes.ledgers();
  const home: NavDestination = {
    key: 'home',
    label: t('common:nav.home'),
    icon: 'home',
    href: inLedger(l?.home()),
  };
  const transactions: NavDestination = {
    key: 'transactions',
    label: t('common:nav.transactions'),
    icon: 'list',
    href: inLedger(l?.transactions()),
  };
  const imports: NavDestination = {
    key: 'imports',
    label: t('common:nav.imports'),
    icon: 'upload',
    href: inLedger(l?.imports()),
  };
  if (manage) return l === null ? [] : [home, transactions, imports];
  return [
    home,
    transactions,
    {
      key: 'sources',
      label: t('common:nav.sources'),
      icon: 'wallet',
      href: inLedger(l?.sources()),
    },
    imports,
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

interface ChromeLedger {
  ledgerId: string | null;
  ledger: Ledger | null;
  /** Every ledger the user belongs to — what the switcher popover lists. */
  ledgers: readonly Ledger[];
  pending: boolean;
}

/**
 * Which ledger the chrome names outside a ledger route (`/settings`, `/ledgers*`), and
 * whether that answer is known yet.
 *
 * Cold-opening `/settings` — a bookmark, a reload — has neither the preference nor the
 * ledger list in hand on the first frame. Guessing there is what made the card flicker
 * 「账本管理」 before swapping to the ledger, so while either answer is outstanding this
 * reports `pending` and the column holds its card slot empty. Once both have landed the
 * remembered ledger wins, and `pickLandingLedger` falls back to the first one — the same
 * ledger `/` would have opened.
 */
function useChromeLedger(): ChromeLedger {
  const ledgerContext = useOptionalLedgerContext();
  const lastLedgerId = useLastLedgerId();
  // Outside a ledger route the list has to come from the cache; inside one the context
  // already holds it, and this is the same query key, so it costs nothing extra.
  const { data, isPending } = useLedgers();
  const known = data?.items;

  if (ledgerContext) {
    return {
      ledgerId: ledgerContext.ledgerId,
      ledger: ledgerContext.ledger,
      ledgers: ledgerContext.ledgers,
      pending: false,
    };
  }
  const pending = lastLedgerId === undefined || (known === undefined && isPending);
  const ledger = pending ? null : pickLandingLedger(known ?? [], lastLedgerId ?? null);
  return { ledgerId: ledger?.id ?? null, ledger, ledgers: known ?? [], pending };
}

export function Sidebar(): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const ledgerContext = useOptionalLedgerContext();

  // Mockup 13's pages are about the list, not about one ledger; everywhere else the column
  // names a ledger (mockup 14 keeps it even on `/settings`).
  const manage = isActivePath(pathname, routes.ledgers(), false);
  const chrome = useChromeLedger();
  const ledger = chrome.ledger ?? undefined;
  const ledgerId = chrome.ledgerId;
  const destinations = useSidebarDestinations(ledgerId, manage);
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
  // Mockup 13 keeps the role line on `/ledgers`, where there is no ledger context to ask:
  // it is the role in the ledger the three entries above lead to.
  const role = ledgerContext?.myRole ?? (manage ? chrome.ledger?.role : undefined);
  // Mockup 14: on `/settings` there is no ledger to take a role from, and the second line
  // is the signed-in email instead — the row never shrinks to one line mid-navigation.
  const userSubtitle = role
    ? t(role === 'owner' ? 'ledger:list.card.role_owner' : 'ledger:list.card.role_member')
    : (user?.email ?? '');

  const manageCard = (
    <LedgerManageCard
      count={user?.ledger_count ?? 0}
      onPress={() => router.navigate(routes.ledgers())}
    />
  );

  // Unreachable when `showsLedgerManageCard` says no (it answers `true` for an unknown
  // ledger), but written as a guard rather than a `!` so the narrowing is the compiler's.
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
      {/* Which card the column opens with — the placeholder only while the answer is still
          in flight (a cold `/settings`), then whatever `showsLedgerManageCard` decides. */}
      {chrome.pending ? (
        <LedgerCardPlaceholder />
      ) : showsLedgerManageCard(pathname, ledger) ? (
        manageCard
      ) : (
        ledgerCard
      )}

      {/* The same reason the card has a placeholder: on a cold `/ledgers` the three entries
          point at the ledger the user last had open, which is not known until `GET /ledgers`
          lands, so without this the column would draw an empty nav area and pop three rows in
          a round trip later. Everywhere else `destinations` is complete on the first frame. */}
      <View style={styles.nav}>
        {chrome.pending && manage ? (
          <View testID="sidebar-nav-pending" style={styles.navPlaceholder} />
        ) : (
          destinations.map((item) => (
            <NavRow
              key={item.key}
              item={item}
              active={isActivePath(pathname, item.href, item.href === homeHref)}
              onPress={() => router.navigate(item.href)}
            />
          ))
        )}
      </View>

      {/* Mockup 13 draws no primary button: there is no open ledger to add a transaction to. */}
      {ledgerId === null || manage ? null : (
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
  /** Three `navRow`s plus the two 2px gaps of `nav` — mockup 13's column, to the pixel. */
  navPlaceholder: { height: NAV_ROW_HEIGHT * 3 + 2 * 2 },
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
