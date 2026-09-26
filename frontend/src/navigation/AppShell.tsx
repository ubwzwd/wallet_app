/**
 * The responsive shell of 04 §1.4. One breakpoint (1024, decision §0.6):
 *
 *   wide   → a `SIDEBAR_WIDTH` column beside the content area
 *   narrow → a top bar above the content and a five-slot tab bar below it
 *
 * Decision §14.64: this is the one shell of every signed-in page — the ledger pages,
 * my accounts (`/accounts*`, decision §14.62), `/ledgers*` (in practice `/ledgers/new` and `/ledgers/join`: `/ledgers` itself only
 * redirects to a ledger, §14.65 c) and `/settings` alike. Outside a ledger route it aims at the ledger the user
 * last had open (`useChromeLedger`), so the column, the tab bar and the sheets behave the
 * same everywhere.
 *
 * The narrow top bar takes one of two forms (§14.64 e): a top-level page gets the ledger
 * pill and the member disc (`TopBarSurface`); a sub-page gets a round back button and a
 * centred title (`SubPageTopBar`). `useBack` decides which page is which.
 *
 * The one state with less chrome is a user who belongs to no ledger at all. On `/ledgers*`
 * — 屏幕稿 15's onboarding and the new / join pages it leads to — there is no chrome at
 * either width (§14.59): every destination would point at nothing. On `/settings` the
 * column stays (it is the way back out), but there is no tab bar to aim at a ledger, and
 * the narrow bar is the sub-page form, leading back to the onboarding page.
 *
 * The form pages (记一笔, the edit forms, the account form — `isFormRoute`) have no tab bar
 * on a narrow screen (§14.65 f): screens 04 / 05 / 06 / 09 at 375 draw none. The wide
 * column is unaffected.
 *
 * The shell owns exactly one piece of state, the narrow ledger switcher sheet, which the
 * top bar's ledger pill opens (the sidebar's card opens its own anchored panel). Page
 * titles travel the other way, through `TopBarProvider`, and a form's leave guard through
 * `LeaveGuardProvider`: every page change the chrome makes asks it first (§14.65 g).
 */
import React from 'react';
import { View } from 'react-native';
import { usePathname } from 'expo-router';

import { routes } from '@/domain/routes';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';

import { BottomTabBar, TAB_BAR_HEIGHT } from './BottomTabBar';
import { isFormRoute } from './formRoute';
import { isActivePath } from './isActivePath';
import { LeaveGuardProvider } from './leaveGuard';
import { LedgerSwitcher } from './LedgerSwitcher';
import { Sidebar } from './Sidebar';
import {
  ShellTopBarContext,
  SubPageTopBar,
  TopBarProvider,
  TopBarSurface,
} from './TopBar';
import { useBack } from './useBack';
import { useHasNoLedgers } from './useChromeLedger';

// ------------------------------------------------ how much bar is at the bottom

interface BottomTabInsetState {
  height: number;
  publish(height: number): void;
}

const BottomTabInsetContext = React.createContext<BottomTabInsetState | null>(null);

/**
 * Published by the shell, read by whatever floats above the content (the toast host of
 * 04 §3.9): `TAB_BAR_HEIGHT` while a bottom tab bar is on screen, `0` everywhere else —
 * on a wide layout, on the pages outside the shell (login, register), and for a user with
 * no ledger at all.
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
}

function Chrome({ children }: AppShellProps): React.JSX.Element {
  const colors = useColors();
  const wide = useIsWide();
  const pathname = usePathname();
  const noLedgers = useHasNoLedgers();
  const back = useBack();
  const [switcherOpen, setSwitcherOpen] = React.useState(false);
  const openSwitcher = React.useCallback(() => setSwitcherOpen(true), []);
  const closeSwitcher = React.useCallback(() => setSwitcherOpen(false), []);

  const onLedgerPages = isActivePath(pathname, routes.ledgers(), false);
  // 屏幕稿 15 is full-bleed, and so are the two pages it sends a ledger-less user to.
  const bare = onLedgerPages && noLedgers;
  const showSidebar = wide && !bare;
  const showTopBar = !wide && !bare;
  // Every tab is ledger-scoped: with no ledger at all there is nothing for them to open.
  const narrowChrome = !wide && !noLedgers;
  // A form page keeps the narrow top bar but not the tabs (§14.65 f).
  const showTabs = narrowChrome && !isFormRoute(pathname);
  usePublishBottomTabInset(showTabs ? TAB_BAR_HEIGHT : 0);

  // `/ledgers*` is always a sub-page; new / join are one even while the ledger their
  // button returns to is still loading, so the bar keeps its shape through the cold load.
  // `/accounts` is one on a narrow screen for the same reason (its parent is that home).
  const onAccountPages = isActivePath(pathname, routes.accounts(), false);
  const subPage = back.show || onLedgerPages || (onAccountPages && !noLedgers);

  return (
    <View
      testID={wide ? 'app-shell-wide' : 'app-shell-narrow'}
      style={{
        flex: 1,
        flexDirection: wide ? 'row' : 'column',
        backgroundColor: colors['bg.canvas'],
      }}
    >
      {showSidebar ? <Sidebar /> : null}
      {showTopBar ? (
        subPage ? (
          <SubPageTopBar />
        ) : (
          <TopBarSurface onPressLedger={openSwitcher} />
        )
      ) : null}
      <View style={{ flex: 1 }}>
        <ShellTopBarContext.Provider value={showTopBar}>{children}</ShellTopBarContext.Provider>
      </View>
      {showTabs ? <BottomTabBar /> : null}
      {/* Wide layouts get mockup 01's dropdown, anchored under the sidebar's ledger card
          and owned by the sidebar; only the narrow chrome opens this sheet. */}
      {narrowChrome ? <LedgerSwitcher open={switcherOpen} onClose={closeSwitcher} /> : null}
    </View>
  );
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  return (
    <LeaveGuardProvider>
      <TopBarProvider>
        <Chrome>{children}</Chrome>
      </TopBarProvider>
    </LeaveGuardProvider>
  );
}
