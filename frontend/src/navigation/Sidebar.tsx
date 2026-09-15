/**
 * The wide-layout sidebar (screens 01 / 09 / 12 / 13 at 1440, decisions §14.45 and §14.56).
 *
 * Top to bottom: the ledger card (its body opens the switcher, its chevron goes to the
 * ledger's own settings), five destinations, the permanent "add a transaction" button, and
 * — pushed to the foot — the signed-in member.
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
import { memberLabel, useLedgers, useMembers } from '@/queries';
import { density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useAuth } from '@/store/AuthContext';
import { useOptionalLedgerContext } from '@/store/LedgerContext';
import { Avatar, Button, Icon, type IconName, Text } from '@/ui';
import { PREF_NAMES, getPref, getPrefSync } from '@/utils/prefs';

import { LedgerSwitcherPopover } from './LedgerSwitcher';

/**
 * Screen 01 at 1440. The mockup's column is `width:252px;padding:20px 14px` with no
 * border-box reset, so the white band it paints is 252 + 2×14 = 280 wide; RN's box model
 * is border-box, so the same 14 of padding needs the outer 280 here.
 */
export const SIDEBAR_WIDTH = 280;

/** At most this many members are named in full on the ledger card; beyond it, a count. */
const NAMED_MEMBER_LIMIT = 3;

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

/** `/l/<id>` matches only itself; every other entry also owns its sub-paths. */
export function isActivePath(pathname: string, href: string, exact: boolean): boolean {
  if (pathname === href) return true;
  return !exact && pathname.startsWith(`${href}/`);
}

/**
 * The ledger the sidebar's ledger-scoped entries point at when the page itself is outside
 * any ledger (`/settings`): the one the user last had open. `null` while nothing is known,
 * and forever on a device that never opened one.
 */
export function useLastLedgerId(): string | null {
  const [id, setId] = React.useState<string | null>(() => getPrefSync(PREF_NAMES.lastLedgerId));
  React.useEffect(() => {
    let alive = true;
    void getPref(PREF_NAMES.lastLedgerId).then((value) => {
      if (alive && value) setId(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return id;
}

/**
 * The five sidebar destinations, in order (§14.56): home, transactions, accounts, imports,
 * me. Without a ledger to scope them to, the four ledger-scoped entries all lead to the
 * ledger list — which is where the user has to pick one anyway.
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
    { key: 'sources', label: t('common:nav.sources'), icon: 'wallet', href: inLedger(l?.sources()) },
    { key: 'imports', label: t('common:nav.imports'), icon: 'upload', href: inLedger(l?.imports()) },
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

// ---------------------------------------------------------------------- ledger card

/**
 * The card's second line: "CNY · 我 + 老婆" while the member list is small enough to name
 * everyone, "CNY · 4 人" otherwise (and while the list is still loading).
 */
function useLedgerCardMeta(ledger: Ledger): string {
  const { t } = useTranslation();
  const { data } = useMembers(ledger.id);
  const items = data?.items;
  const names =
    items && items.length > 0 && items.length <= NAMED_MEMBER_LIMIT
      ? items.map(memberLabel).join(' + ')
      : t('common:nav.member_count', { count: ledger.member_count });
  return `${ledger.base_currency} · ${names}`;
}

function LedgerCard({
  ledger,
  onOpenSwitcher,
  onOpenSettings,
}: {
  ledger: Ledger;
  onOpenSwitcher(): void;
  onOpenSettings(): void;
}): React.JSX.Element {
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

/**
 * Which card sits at the top of the column.
 *
 * Mockup 14 (个人设置 1440) keeps the *ledger* card on `/settings`, so the chrome does not
 * change identity when the user opens 「我的」; only mockup 13's own pages — `/ledgers`,
 * `/ledgers/new`, `/ledgers/join` — swap it for 「账本管理 · N 本」. A user with no ledger
 * to name gets the list card wherever they are, because there is nothing else to show.
 *
 * (The `/ledgers*` branch cannot be reached yet: `app/(app)/_layout.tsx` still renders
 * those pages without the shell. It is written the way §14.56 rules so the card is right
 * the moment that gate widens.)
 */
export function showsLedgerManageCard(pathname: string, ledger: Ledger | undefined): boolean {
  return ledger === undefined || isActivePath(pathname, routes.ledgers(), false);
}

/** Screen 13: on the ledger pages themselves the card names the ledger list instead. */
function LedgerManageCard({
  count,
  onPress,
}: {
  count: number;
  onPress(): void;
}): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  const title = t('common:nav.ledgers');
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={title}
      onPress={onPress}
      testID="sidebar-ledgers-link"
      style={({ pressed }) => [
        styles.card,
        styles.cardBody,
        styles.cardAlone,
        { backgroundColor: pressed ? colors['bg.subtle'] : colors['bg.canvas'] },
      ]}
    >
      <Avatar name={title} size={32} shape="square" tone="accent" />
      <View style={styles.cardText}>
        <Text weight={600} style={styles.cardName} numberOfLines={1}>
          {title}
        </Text>
        <Text mono tone="muted" style={styles.cardMeta} numberOfLines={1}>
          {t('common:nav.ledger_count', { count })}
        </Text>
      </View>
      <Icon name="chevron-right" size={16} color={colors['fg.secondary']} />
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
  // `/settings` renders the shell without a ledger context (04 §1.4): the chrome then
  // aims at the ledger the user last had open, and at the ledger list when there is none.
  const ledgerContext = useOptionalLedgerContext();
  const lastLedgerId = useLastLedgerId();
  const ledgerId = ledgerContext?.ledgerId ?? lastLedgerId;
  const destinations = useSidebarDestinations(ledgerId);
  const homeHref = ledgerId === null ? null : routes.l(ledgerId).home();

  // Outside a ledger route the list has to come from the cache; inside one the context
  // already holds it, and this is the same query key, so it costs nothing extra.
  const known = useLedgers().data?.items;
  const ledgers = ledgerContext?.ledgers ?? known ?? [];
  const ledger =
    ledgerContext?.ledger ??
    (ledgerId === null ? undefined : ledgers.find((l) => l.id === ledgerId));

  const manageCard = showsLedgerManageCard(pathname, ledger);

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

  return (
    <View testID="sidebar" style={[styles.root, { backgroundColor: colors['bg.surface'] }]}>
      {ledger !== undefined && !manageCard ? (
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
            ledgers={ledgers}
            currentId={ledger.id}
            onPick={pickLedger}
          />
        </View>
      ) : (
        <LedgerManageCard
          count={user?.ledger_count ?? 0}
          onPress={() => router.navigate(routes.ledgers())}
        />
      )}

      <View style={styles.nav}>
        {destinations.map((item) => (
          <NavRow
            key={item.key}
            item={item}
            active={isActivePath(pathname, item.href, item.href === homeHref)}
            onPress={() => router.navigate(item.href)}
          />
        ))}
      </View>

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
        <View style={styles.cardText}>
          <Text weight={500} style={styles.userName} numberOfLines={1}>
            {me}
          </Text>
          {role ? (
            <Text tone="muted" style={styles.userRole} numberOfLines={1}>
              {t(role === 'owner' ? 'ledger:list.card.role_owner' : 'ledger:list.card.role_member')}
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
  // The one-piece card is a row of its own, so it must not grow like the inner body does.
  cardAlone: { flexGrow: 0, gap: 10, paddingRight: space['3'] },
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
  nav: { gap: 2 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    height: 44,
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
  userName: { fontSize: 14, lineHeight: 19 },
  userRole: { fontSize: 11, lineHeight: 15 },
});
