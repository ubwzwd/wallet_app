/**
 * The responsive shell of 04 §1.4. One breakpoint (1024, decision §0.6):
 *
 *   wide   → a 240px sidebar beside the content area
 *   narrow → a top bar above the content and a five-slot tab bar below it
 *
 * The shell also runs outside a ledger — `/settings` is reachable from the sidebar and
 * from the "me" sheet, and losing the chrome on the way there would strand the user. Then
 * there is no ledger switcher and no tab bar (every tab is ledger-scoped): the sidebar
 * links to the ledger list instead, and the narrow top bar carries a back button.
 *
 * The shell owns exactly one piece of state, the ledger switcher sheet, because three
 * different affordances open it (the sidebar header, the top bar's ledger line, and the
 * "me" sheet). Page titles travel the other way, through `TopBarProvider`.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useOptionalLedgerContext } from '@/store/LedgerContext';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon, Text } from '@/ui';

import { BottomTabBar, TAB_BAR_HEIGHT } from './BottomTabBar';
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
        {
          paddingTop: top + space['2'],
          backgroundColor: colors['bg.surface'],
          borderBottomColor: colors['border.default'],
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common:button.back')}
        onPress={() => router.back()}
        hitSlop={space['2']}
        testID="top-bar-back"
        style={styles.backButton}
      >
        <Icon name="chevron-left" size={20} color={colors['fg.secondary']} />
      </Pressable>
      <Text variant="title" numberOfLines={1} testID="top-bar-title">
        {title ?? ''}
      </Text>
    </View>
  );
}

function Chrome({ children }: AppShellProps): React.JSX.Element {
  const colors = useColors();
  const wide = useIsWide();
  const ledger = useOptionalLedgerContext();
  const [switcherOpen, setSwitcherOpen] = React.useState(false);
  const openSwitcher = React.useCallback(() => setSwitcherOpen(true), []);
  const closeSwitcher = React.useCallback(() => setSwitcherOpen(false), []);

  // Every tab is ledger-scoped, so outside a ledger there is no bottom bar at all.
  const showTabs = !wide && ledger !== null;
  usePublishBottomTabInset(showTabs ? TAB_BAR_HEIGHT : 0);

  return (
    <View
      testID={wide ? 'app-shell-wide' : 'app-shell-narrow'}
      style={{
        flex: 1,
        flexDirection: wide ? 'row' : 'column',
        backgroundColor: colors['bg.canvas'],
      }}
    >
      {wide ? (
        <Sidebar onOpenSwitcher={openSwitcher} />
      ) : ledger ? (
        <TopBarSurface onPressLedger={openSwitcher} />
      ) : (
        <PlainTopBar />
      )}
      <View style={{ flex: 1 }}>{children}</View>
      {showTabs ? <BottomTabBar onOpenSwitcher={openSwitcher} /> : null}
      {ledger ? <LedgerSwitcher open={switcherOpen} onClose={closeSwitcher} /> : null}
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

const styles = StyleSheet.create({
  // 04 §6.6: a touch target is never smaller than 44×44.
  backButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  plainBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['2'],
    paddingHorizontal: space['4'],
    paddingBottom: space['2'],
    borderBottomWidth: 1,
  },
});
