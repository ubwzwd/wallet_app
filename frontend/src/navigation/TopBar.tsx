/**
 * The narrow-layout top bar (04 §1.4, screen 01 at 375): the current ledger as a tappable
 * pill on the left, the signed-in member as a round disc on the right, and — until every
 * page carries its own header (§14.56, wave two) — the page title underneath.
 *
 * The title belongs to the page, not to the shell, so pages publish it through the tiny
 * context below: either declaratively (`<TopBar title={...} />`) or from a hook
 * (`useTopBar(title)`). Both are no-ops on wide layouts, where there is no top bar at all.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { routes } from '@/domain/routes';
import { density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon, Text } from '@/ui';
import { useAuth } from '@/store/AuthContext';
import { useLedgerContext } from '@/store/LedgerContext';

import { LetterAvatar } from './LetterAvatar';
import { userLabel } from './Sidebar';

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
  const router = useRouter();
  const title = useTopBarTitle();
  const { ledger } = useLedgerContext();
  const { user } = useAuth();
  const top = useTopInset();
  const me = userLabel(user);

  return (
    <View
      testID="top-bar"
      style={[styles.bar, { paddingTop: top + space['2'], backgroundColor: colors['bg.canvas'] }]}
    >
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common:nav.switch_ledger')}
          onPress={onPressLedger}
          testID="top-bar-ledger"
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: pressed ? colors['bg.hover'] : colors['bg.surface'] },
          ]}
        >
          <Text weight={700} style={styles.pillLabel} numberOfLines={1}>
            {ledger.name}
          </Text>
          <Icon name="chevron-down" size={16} color={colors['fg.secondary']} />
        </Pressable>

        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('common:nav.me')}
          onPress={() => router.navigate(routes.settings())}
          testID="top-bar-me"
          style={({ pressed }) => [styles.me, pressed ? { opacity: 0.7 } : null]}
        >
          <LetterAvatar name={me} size={40} shape="round" tone="surface" />
        </Pressable>
      </View>

      {title === null ? null : (
        <Text variant="heading" weight={700} numberOfLines={1} testID="top-bar-title">
          {title}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: space['4'],
    paddingBottom: space['2'],
    gap: space['2'],
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['1'],
    height: 44,
    paddingLeft: density.rowInnerPadding,
    paddingRight: space['3'],
    borderRadius: radius.pill,
  },
  pillLabel: { fontSize: 17, lineHeight: 24 },
  me: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
