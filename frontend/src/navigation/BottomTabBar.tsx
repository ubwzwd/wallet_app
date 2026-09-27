/**
 * The narrow-layout bottom bar (04 §1.4, screen 01 at 375): home / transactions / ✚ /
 * imports / me.
 *
 * The centre button is not a tab — it goes straight to a new expense, and a long press
 * offers the four kinds. "Me" is not a tab either: it opens a sheet that gathers personal
 * settings, ledger settings, my accounts and signing out (decision §14.52 A21 — there is no
 * top-level reports or members page; §14.62 — accounts belong to the user). Switching ledger is the top bar's ledger pill, and only that
 * (§14.65 b).
 *
 * Decision §14.64 b: the bar is on every page of the shell, not only on the ledger pages. Its
 * slots are ledger-free paths (§14.66 a) that show the tab's current ledger; 「我的」 is lit
 * on `/settings`, and nothing is lit on `/accounts` or `/ledgers*`, which none of the five
 * slots leads to.
 *
 * Every slot, sheet row and kind that changes page asks a form's leave guard first
 * (§14.65 g). The bar itself is not drawn on the form pages (§14.65 f), but a wide window
 * narrowed over a half-filled form must not open an unguarded exit either.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { TxKind } from '@/api/types';
import { KINDS } from '@/domain/kinds';
import { type RouteHref, routes } from '@/domain/routes';
import { density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useAuth } from '@/store/AuthContext';
import { useOptionalLedgerContext } from '@/store/LedgerContext';
import { Icon, type IconName, KIND_ICON, Sheet, Text } from '@/ui';

import { isActivePath } from './isActivePath';
import { useGuardedNavigate } from './leaveGuard';

/**
 * Screen 01 at 375: 8 above, a 49 tall slot, 14 below.
 *
 * The centre slot is what sets the row's cross size: a 52 circle, a 4 gap and a 13 label
 * line make 69, and `marginTop: -20` lifts 20 of that out of the row, leaving 49. Measured
 * against the rendered bar, not assumed — the toast host offsets itself by this number.
 */
export const TAB_BAR_HEIGHT = 71;

interface TabSpec {
  key: string;
  label: string;
  icon: IconName;
  href: RouteHref;
  exact: boolean;
}

function Tab({
  spec,
  active,
  onPress,
}: {
  spec: TabSpec;
  active: boolean;
  onPress(): void;
}): React.JSX.Element {
  const colors = useColors();
  const fg = active ? colors['accent.solid'] : colors['fg.muted'];
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={spec.label}
      onPress={onPress}
      testID={`tab-${spec.key}`}
      style={styles.tab}
    >
      <Icon name={spec.icon} size={20} color={fg} />
      <Text weight={active ? 600 : 500} style={[styles.tabLabel, { color: fg }]} numberOfLines={1}>
        {spec.label}
      </Text>
    </Pressable>
  );
}

/** The sheet behind the "me" tab: 个人设置 / 账本设置 / 账户 / 登出 (§14.65 b, §14.62). */
function MeSheet({ open, onClose }: { open: boolean; onClose(): void }): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const guarded = useGuardedNavigate();
  const { logout } = useAuth();
  // 账本设置 is the current ledger's, so there is no such row for a user with none.
  const hasLedger = useOptionalLedgerContext() !== null;
  const colors = useColors();

  const rows: { key: string; label: string; icon: IconName; run(): void }[] = [
    {
      key: 'settings',
      label: t('common:nav.settings'),
      icon: 'user',
      run: () => router.navigate(routes.settings()),
    },
    ...(hasLedger
      ? [
          {
            key: 'ledger-settings',
            label: t('common:nav.ledger_settings'),
            icon: 'users' as const,
            run: () => router.navigate(routes.ledgerSettings()),
          },
        ]
      : []),
    // My accounts are not scoped to a ledger, so the row is there inside a ledger or not.
    {
      key: 'accounts',
      label: t('common:nav.sources'),
      icon: 'wallet',
      run: () => router.navigate(routes.accounts()),
    },
    {
      key: 'logout',
      label: t('common:nav.logout'),
      icon: 'log-out',
      run: () => {
        void logout().then(() => router.replace(routes.login()));
      },
    },
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('common:nav.me')}
      closeLabel={t('common:button.close')}
      testID="me-sheet"
    >
      {rows.map((row) => (
        <Pressable
          key={row.key}
          accessibilityRole="button"
          onPress={() => {
            onClose();
            guarded(row.run);
          }}
          testID={`me-sheet-${row.key}`}
          style={styles.sheetRow}
        >
          <Icon name={row.icon} size={18} color={colors['fg.secondary']} />
          <Text variant="subheading">{row.label}</Text>
        </Pressable>
      ))}
    </Sheet>
  );
}

/** The four kinds offered by a long press on the centre button. */
function KindSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose(): void;
  onPick(kind: TxKind): void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('common:nav.add')}
      closeLabel={t('common:button.close')}
      testID="kind-sheet"
    >
      {KINDS.map((kind) => (
        <Pressable
          key={kind}
          accessibilityRole="button"
          onPress={() => {
            onClose();
            onPick(kind);
          }}
          testID={`kind-sheet-${kind}`}
          style={styles.sheetRow}
        >
          <Icon name={KIND_ICON[kind]} size={18} color={colors['fg.secondary']} />
          <Text variant="subheading">{t(`transaction:kind.${kind}`)}</Text>
        </Pressable>
      ))}
    </Sheet>
  );
}

export function BottomTabBar(): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const guarded = useGuardedNavigate();
  const pathname = usePathname();
  const hasLedger = useOptionalLedgerContext() !== null;
  const bottom = React.useContext(SafeAreaInsetsContext)?.bottom ?? 0;

  const [meOpen, setMeOpen] = React.useState(false);
  const [kindOpen, setKindOpen] = React.useState(false);

  // The shell draws no tab bar for a user with no ledger; should one be drawn anyway, the
  // ledger pages would only bounce to the onboarding page, so the slots go there directly.
  const scoped = (href: RouteHref): RouteHref => (hasLedger ? href : routes.ledgers());
  const left: TabSpec[] = [
    { key: 'home', label: t('common:nav.home'), icon: 'home', href: scoped(routes.home()), exact: true },
    {
      key: 'transactions',
      label: t('common:nav.transactions'),
      icon: 'list',
      href: scoped(routes.transactions()),
      exact: false,
    },
  ];
  const right: TabSpec[] = [
    {
      key: 'imports',
      label: t('common:nav.imports'),
      icon: 'upload',
      href: scoped(routes.imports()),
      exact: false,
    },
  ];
  // None of the five slots is `/ledgers*`, so nothing is lit there.
  const onLedgerPages = isActivePath(pathname, routes.ledgers(), false);
  const isActive = (spec: TabSpec): boolean =>
    !onLedgerPages && isActivePath(pathname, spec.href, spec.exact);

  const openAdd = (kind: TxKind): void =>
    guarded(() => router.navigate(scoped(routes.transactionNew({ kind }))));

  return (
    <>
      <View
        testID="bottom-tab-bar"
        accessibilityRole="tablist"
        style={[
          styles.bar,
          {
            // Screen 01 at 375: 14 below the labels, plus whatever the device asks for.
            paddingBottom: bottom + density.rowInnerPadding,
            backgroundColor: colors['bg.surface'],
          },
        ]}
      >
        {left.map((spec) => (
          <Tab
            key={spec.key}
            spec={spec}
            active={isActive(spec)}
            onPress={() => guarded(() => router.navigate(spec.href))}
          />
        ))}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common:nav.add')}
          onPress={() => openAdd('expense')}
          onLongPress={() => setKindOpen(true)}
          testID="tab-add"
          style={styles.addSlot}
        >
          {/* The disc and its label are what set the bar's height; they carry testIDs so a
              test can add the bar up from its own style objects instead of restating 71. */}
          <View
            testID="tab-add-disc"
            style={[styles.addButton, { backgroundColor: colors['accent.solid'] }]}
          >
            <Icon name="plus" size={24} color={colors['accent.fg']} />
          </View>
          <Text
            weight={600}
            testID="tab-add-label"
            style={[styles.tabLabel, { color: colors['fg.muted'] }]}
          >
            {t('common:nav.add')}
          </Text>
        </Pressable>

        {right.map((spec) => (
          <Tab
            key={spec.key}
            spec={spec}
            active={isActive(spec)}
            onPress={() => guarded(() => router.navigate(spec.href))}
          />
        ))}

        <Tab
          spec={{
            key: 'me',
            label: t('common:nav.me'),
            icon: 'user',
            // Opens the "me" sheet rather than navigating; the href only names where it leads.
            href: routes.settings(),
            exact: true,
          }}
          // Lit while its sheet is open, and on the page it names (§14.64 b).
          active={meOpen || isActivePath(pathname, routes.settings(), true)}
          onPress={() => setMeOpen(true)}
        />
      </View>

      <MeSheet open={meOpen} onClose={() => setMeOpen(false)} />
      <KindSheet open={kindOpen} onClose={() => setKindOpen(false)} onPick={openAdd} />
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    paddingTop: space['2'],
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minWidth: density.listRowHeight,
    minHeight: 44,
  },
  // 10px labels, per screen 01 at 375.
  tabLabel: { fontSize: 10, lineHeight: 13 },
  /** The centre slot rides 20px above the bar (screen 01 at 375). */
  addSlot: { alignItems: 'center', gap: space['1'], marginTop: -space['5'], minHeight: 44 },
  addButton: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    height: 56,
    paddingHorizontal: space['2'],
  },
});
