/**
 * The responsive shell of 04 §1.4. One breakpoint (1024, decision §0.6):
 *
 *   wide   → a 240px sidebar beside the content area
 *   narrow → a top bar above the content and a five-slot tab bar below it
 *
 * The shell owns exactly one piece of state, the ledger switcher sheet, because three
 * different affordances open it (the sidebar header, the top bar's ledger line, and the
 * "me" sheet). Page titles travel the other way, through `TopBarProvider`.
 */
import React from 'react';
import { View } from 'react-native';

import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';

import { BottomTabBar } from './BottomTabBar';
import { LedgerSwitcher } from './LedgerSwitcher';
import { Sidebar } from './Sidebar';
import { TopBarProvider, TopBarSurface } from './TopBar';

export interface AppShellProps {
  children: React.ReactNode;
}

function Chrome({ children }: AppShellProps): React.JSX.Element {
  const colors = useColors();
  const wide = useIsWide();
  const [switcherOpen, setSwitcherOpen] = React.useState(false);
  const openSwitcher = React.useCallback(() => setSwitcherOpen(true), []);
  const closeSwitcher = React.useCallback(() => setSwitcherOpen(false), []);

  return (
    <View
      testID={wide ? 'app-shell-wide' : 'app-shell-narrow'}
      style={{
        flex: 1,
        flexDirection: wide ? 'row' : 'column',
        backgroundColor: colors['bg.canvas'],
      }}
    >
      {wide ? <Sidebar onOpenSwitcher={openSwitcher} /> : <TopBarSurface onPressLedger={openSwitcher} />}
      <View style={{ flex: 1 }}>{children}</View>
      {wide ? null : <BottomTabBar onOpenSwitcher={openSwitcher} />}
      <LedgerSwitcher open={switcherOpen} onClose={closeSwitcher} />
    </View>
  );
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  return (
    <TopBarProvider>
      <Chrome>{children}</Chrome>
    </TopBarProvider>
  );
}
