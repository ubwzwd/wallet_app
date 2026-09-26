/**
 * The narrow-layout top bar (04 §1.4), in the two forms decision §14.64 e gives it:
 *
 *   top-level page → `TopBarSurface`: the ledger as a tappable pill on the left, the
 *                    signed-in member as a round disc on the right, the page title beneath
 *                    (screen 01 at 375). Outside a ledger (`/settings`) the pill names the
 *                    ledger the chrome aims at (`useChromeLedger`).
 *   sub-page       → `SubPageTopBar`: a round ‹ on the left, the page title centred, and a
 *                    spacer of the button's width on the right (screens 07 / 08 / 09 / 12 /
 *                    13 at 375).
 *
 * The title belongs to the page, not to the shell, so pages publish it through the tiny
 * context below: either declaratively (`<TopBar title={...} />`) or from a hook
 * (`useTopBar(title)`). Both are harmless on wide layouts, where there is no top bar at all.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { routes } from '@/domain/routes';
import { density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Avatar, BACK_BUTTON_SIZE, BackButton, Icon, Text } from '@/ui';
import { useAuth } from '@/store/AuthContext';

import { userLabel } from './Sidebar';
import { useBack } from './useBack';
import { useChromeLedger } from './useChromeLedger';

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

/**
 * Whether the shell is drawing a narrow top bar above the page right now. A page that
 * would otherwise draw its own back button and title (`/ledgers/new`, `/ledgers/join`)
 * asks this, so the two never appear stacked (§14.64 e). `false` outside the shell.
 */
export const ShellTopBarContext = React.createContext(false);

export function useShellDrawsTopBar(): boolean {
  return React.useContext(ShellTopBarContext);
}

/** Reads the safe area without throwing when no provider is mounted (tests, plain web). */
function useTopInset(): number {
  return React.useContext(SafeAreaInsetsContext)?.top ?? 0;
}

export interface TopBarSurfaceProps {
  /** Opens the ledger switcher sheet. */
  onPressLedger(): void;
}

/** The top-level form — rendered by `AppShell` on narrow layouts only. */
export function TopBarSurface({ onPressLedger }: TopBarSurfaceProps): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const title = useTopBarTitle();
  const { ledger } = useChromeLedger();
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
            { backgroundColor: pressed ? colors['bg.hover'] : colors['bg.raised'] },
          ]}
        >
          {/* Empty only for the frame or two a cold `/settings` spends learning the ledger. */}
          <Text weight={700} style={styles.pillLabel} numberOfLines={1}>
            {ledger?.name ?? ''}
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
          <Avatar name={me} size={40} shape="circle" tone="surface" />
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

/**
 * The sub-page form: round ‹, centred title, and a spacer as wide as the button so the
 * title lands dead centre. The button goes where `useBack` says; on `/ledgers` while the
 * ledger it would return to is still loading, the slot is held empty rather than letting
 * the bar change shape a frame later.
 */
export function SubPageTopBar(): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  const title = useTopBarTitle();
  const back = useBack();
  const top = useTopInset();

  return (
    <View
      testID="top-bar"
      style={[styles.subBar, { paddingTop: top + space['2'], backgroundColor: colors['bg.canvas'] }]}
    >
      {back.show ? (
        <BackButton label={t('common:button.back')} onPress={back.goBack} testID="top-bar-back" />
      ) : (
        <View style={styles.spacer} />
      )}
      <Text
        variant="heading"
        weight={700}
        accessibilityRole="header"
        numberOfLines={1}
        testID="top-bar-title"
        style={styles.subTitle}
      >
        {title ?? ''}
      </Text>
      <View style={styles.spacer} />
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
  // Screens 08 / 12 at 375: the 40 circle and the centred title share one line.
  subBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    paddingHorizontal: space['4'],
    paddingBottom: space['2'],
  },
  subTitle: { flex: 1, textAlign: 'center', fontSize: 17, lineHeight: 24 },
  spacer: { width: BACK_BUTTON_SIZE, height: BACK_BUTTON_SIZE },
});
