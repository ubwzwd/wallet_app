/**
 * The narrow-layout top bar (04 §1.4): page title on the first line, the current ledger
 * name — tappable, opening the switcher — on the second.
 *
 * The title belongs to the page, not to the shell, so pages publish it through the tiny
 * context below: either declaratively (`<TopBar title={...} />`) or from a hook
 * (`useTopBar(title)`). Both are no-ops on wide layouts, where there is no top bar.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon, Text } from '@/ui';
import { useLedgerContext } from '@/store/LedgerContext';

interface TopBarState {
  title: string | null;
  setTitle(title: string | null): void;
}

const TopBarContext = React.createContext<TopBarState | null>(null);

export function TopBarProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [title, setTitle] = React.useState<string | null>(null);
  const value = React.useMemo<TopBarState>(() => ({ title, setTitle }), [title]);
  return <TopBarContext.Provider value={value}>{children}</TopBarContext.Provider>;
}

/** The title the mounted page published, or `null`. Used by the shell. */
export function useTopBarTitle(): string | null {
  return React.useContext(TopBarContext)?.title ?? null;
}

/** Publish this page's title for as long as the calling component is mounted. */
export function useTopBar(title: string | null | undefined): void {
  const setTitle = React.useContext(TopBarContext)?.setTitle;
  React.useEffect(() => {
    if (!setTitle) return;
    setTitle(title ?? null);
    return () => setTitle(null);
  }, [setTitle, title]);
}

/** Declarative form of `useTopBar`; renders nothing. */
export function TopBar({ title }: { title: string }): null {
  useTopBar(title);
  return null;
}

/** Reads the safe area without throwing when no provider is mounted (tests, plain web). */
function useTopInset(): number {
  return React.useContext(SafeAreaInsetsContext)?.top ?? 0;
}

export interface TopBarSurfaceProps {
  /** Opens the ledger switcher sheet. */
  onPressLedger(): void;
}

/** The bar itself — rendered by `AppShell` on narrow layouts only. */
export function TopBarSurface({ onPressLedger }: TopBarSurfaceProps): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  const title = useTopBarTitle();
  const { ledger } = useLedgerContext();
  const top = useTopInset();

  return (
    <View
      testID="top-bar"
      style={[
        styles.bar,
        {
          paddingTop: top + space['2'],
          backgroundColor: colors['bg.surface'],
          borderBottomColor: colors['border.default'],
        },
      ]}
    >
      <Text variant="title" numberOfLines={1} testID="top-bar-title">
        {title ?? ''}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common:nav.switch_ledger')}
        onPress={onPressLedger}
        hitSlop={space['2']}
        testID="top-bar-ledger"
        style={styles.ledgerRow}
      >
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {ledger.name}
        </Text>
        <Icon name="chevron-down" size={16} color={colors['fg.secondary']} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: space['4'],
    paddingBottom: space['2'],
    borderBottomWidth: 1,
    gap: space['1'],
  },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', gap: space['1'] },
});
