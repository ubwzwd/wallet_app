/**
 * The responsive shell of 04 §1.4. One breakpoint (1024, decision §0.6):
 *
 *   wide   → a `SIDEBAR_WIDTH` column beside the content area
 *   narrow → a top bar above the content and a five-slot tab bar below it
 *
 * The shell also runs outside a ledger — `/settings` is reachable from the sidebar and
 * from the "me" sheet, and losing the chrome on the way there would strand the user; and
 * `/ledgers*` is drawn with the sidebar in mockup 13. Then there is no ledger switcher and
 * no tab bar (every tab is ledger-scoped): the sidebar names the ledger list instead, and
 * the narrow top bar carries a back button.
 *
 * `narrowChrome={false}` keeps the wide column and drops that narrow bar, for pages whose
 * own 375 frame already draws a header (mockup 13's ledger list, new ledger, join).
 *
 * The one page with no chrome at either width is `/ledgers` with nothing to list: mockup
 * 15 「无账本引导」 is full-bleed, and `showSidebar` below takes the column away for it.
 *
 * The shell owns exactly one piece of state, the ledger switcher sheet, because three
 * different affordances open it (the sidebar header, the top bar's ledger line, and the
 * "me" sheet). Page titles travel the other way, through `TopBarProvider`.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { routes } from '@/domain/routes';
import { useAuth } from '@/store/AuthContext';
import { useOptionalLedgerContext } from '@/store/LedgerContext';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon, Text } from '@/ui';

import { BottomTabBar, TAB_BAR_HEIGHT } from './BottomTabBar';
import { isActivePath } from './isActivePath';
import { LedgerSwitcher } from './LedgerSwitcher';
import { Sidebar } from './Sidebar';
import { TopBarProvider, TopBarSurface, useTopBarTitle } from './TopBar';

// ------------------------------------------------ how much bar is at the bottom

interface BottomTabInsetState {
  height: number;
  publish(height: number): void;
}

const BottomTabInsetContext = React.createContext<BottomTabInsetState | null>(null);

/**
 * Published by the shell, read by whatever floats above the content (the toast host of
 * 04 §3.9): `TAB_BAR_HEIGHT` while a bottom tab bar is on screen, `0` everywhere else —
 * on a wide layout, and on the pages outside the ledger tree (login, register, `/ledgers`).
 */
export function BottomTabInsetProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [height, setHeight] = React.useState(0);
  const publish = React.useCallback((next: number) => setHeight(next), []);
  const value = React.useMemo<BottomTabInsetState>(() => ({ height, publish }), [height, publish]);
  return <BottomTabInsetContext.Provider value={value}>{children}</BottomTabInsetContext.Provider>;
}

/** Height of the bottom tab bar currently on screen; `0` when there is none. */
export function useBottomTabInset(): number {
  return React.useContext(BottomTabInsetContext)?.height ?? 0;
}

function usePublishBottomTabInset(height: number): void {
  const publish = React.useContext(BottomTabInsetContext)?.publish;
  React.useEffect(() => {
    if (!publish) return;
    publish(height);
    return () => publish(0);
  }, [height, publish]);
}

// --------------------------------------------------------------------- the shell

export interface AppShellProps {
  children: React.ReactNode;
  /** Whether the narrow layout gets the shell's own top bar. Default: yes. */
  narrowChrome?: boolean;
}

/** Narrow top bar for a page outside any ledger: the page title, and a way back. */
function PlainTopBar(): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const title = useTopBarTitle();
  const top = React.useContext(SafeAreaInsetsContext)?.top ?? 0;

  return (
    <View
      testID="top-bar"
      style={[
        styles.plainBar,
        { paddingTop: top + space['2'], backgroundColor: colors['bg.canvas'] },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common:button.back')}
        onPress={() => router.back()}
        hitSlop={space['2']}
        testID="top-bar-back"
        style={({ pressed }) => [
          styles.backButton,
          { backgroundColor: pressed ? colors['bg.hover'] : colors['bg.raised'] },
        ]}
      >
        <Icon name="chevron-left" size={20} color={colors['fg.secondary']} />
      </Pressable>
      <Text variant="heading" weight={700} numberOfLines={1} testID="top-bar-title">
        {title ?? ''}
      </Text>
    </View>
  );
}

function Chrome({ children, narrowChrome = true }: AppShellProps): React.JSX.Element {
  const colors = useColors();
  const wide = useIsWide();
  const ledger = useOptionalLedgerContext();
  const { user } = useAuth();
  const pathname = usePathname();
  const [switcherOpen, setSwitcherOpen] = React.useState(false);
  const openSwitcher = React.useCallback(() => setSwitcherOpen(true), []);
  const closeSwitcher = React.useCallback(() => setSwitcherOpen(false), []);

  // Every tab is ledger-scoped, so outside a ledger there is no bottom bar at all.
  const showTabs = !wide && ledger !== null;
  usePublishBottomTabInset(showTabs ? TAB_BAR_HEIGHT : 0);

  // Mockup 15 「无账本引导」 at 1440 has no column at all: on `/ledgers` with nothing to
  // list, every destination in the column points at nothing and its card would name an
  // empty list. The onboarding page draws its own brand bar and account pill instead, so
  // the shell steps out of the way and the page runs full-bleed. The `false` makes that the
  // whole `/ledgers*` subtree, `/ledgers/new` and `/ledgers/join` included, and that is
  // deliberate (§14.59): those two are exactly where 屏幕稿 15 sends a user with no ledger,
  // the column would be just as empty there, and both pages carry their own way back to the
  // list. 屏幕稿 13 draws them with a column, but only for a user who *has* ledgers — and
  // that user still gets one here. Personal settings keeps the column even with no ledger —
  // it is the only way back out of that page.
  const onLedgerList = isActivePath(pathname, routes.ledgers(), false);
  const showSidebar = wide && !(onLedgerList && user !== null && user.ledger_count === 0);

  return (
    <View
      testID={wide ? 'app-shell-wide' : 'app-shell-narrow'}
      style={{
        flex: 1,
        flexDirection: wide ? 'row' : 'column',
        backgroundColor: colors['bg.canvas'],
      }}
    >
      {showSidebar ? (
        <Sidebar />
      ) : wide || !narrowChrome ? null : ledger ? (
        <TopBarSurface onPressLedger={openSwitcher} />
      ) : (
        <PlainTopBar />
      )}
      <View style={{ flex: 1 }}>{children}</View>
      {showTabs ? <BottomTabBar onOpenSwitcher={openSwitcher} /> : null}
      {/* Wide layouts get mockup 01's dropdown, anchored under the sidebar's ledger card
          and owned by the sidebar; only the narrow chrome opens this sheet. */}
      {!wide && ledger ? <LedgerSwitcher open={switcherOpen} onClose={closeSwitcher} /> : null}
    </View>
  );
}

export function AppShell({ children, narrowChrome }: AppShellProps): React.JSX.Element {
  return (
    <TopBarProvider>
      <Chrome narrowChrome={narrowChrome}>{children}</Chrome>
    </TopBarProvider>
  );
}

const styles = StyleSheet.create({
  // 04 §6.6: a touch target is never smaller than 44×44.
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plainBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    paddingHorizontal: space['4'],
    paddingBottom: space['2'],
  },
});
