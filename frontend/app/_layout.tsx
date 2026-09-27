/**
 * The root layout: the whole provider tree of 04 §2, and nothing else.
 *
 * Order matters. Theme and safe area are outermost so even the pre-i18n skeleton is
 * painted correctly; i18next gates the tree because every string below it comes from the
 * language pack; the query client sits above `AuthProvider`, which clears it on a 401.
 * Fonts deliberately do **not** gate anything — tokens.json ships a fallback stack, so the
 * first paint happens immediately and the faces swap in when they arrive (04 §6.3).
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';

import '@/pwa/registerSW';
import { APP_NAME } from '@/constants/config';
import { initI18n } from '@/i18n';
import { AppSkeleton, markLedgerUnavailable, useSwUpdateToast } from '@/navigation';
import { BottomTabInsetProvider, useBottomTabInset } from '@/navigation/AppShell';
import { queryClient, registerQueryHandlers } from '@/queries';
import { AuthProvider } from '@/store';
import { radius, space } from '@/theme/tokens';
import { ThemeProvider, useColors } from '@/theme/ThemeProvider';
import { useAppFonts } from '@/theme/fonts';
import { ConfirmHost, Text, ToastHost } from '@/ui';

type I18nStatus = 'loading' | 'ready' | 'failed';

interface I18nState {
  status: I18nStatus;
  retry(): void;
}

/** `ready` once the language pack is live; `initI18n()` is idempotent. */
function useI18nReady(): I18nState {
  const [status, setStatus] = React.useState<I18nStatus>(() =>
    i18next.isInitialized ? 'ready' : 'loading',
  );
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (status === 'ready') return;
    let cancelled = false;
    void initI18n().then(
      () => {
        if (!cancelled) setStatus('ready');
      },
      () => {
        // Without the language pack there is nothing to render but an error: a permanent
        // skeleton would look like a hung app and offer no way out.
        if (!cancelled) setStatus('failed');
      },
    );
    return () => {
      cancelled = true;
    };
    // `attempt` re-runs the effect when the error state's retry button is pressed.
  }, [attempt, status]);

  const retry = React.useCallback(() => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  return { status, retry };
}

/**
 * The one screen whose copy cannot come from the language pack — the language pack is what
 * failed. Both languages are shown, since we do not know which one the user reads.
 */
function I18nFailed({ onRetry }: { onRetry(): void }): React.JSX.Element {
  const colors = useColors();
  return (
    <View
      testID="i18n-failed"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space['3'],
        padding: space['4'],
        backgroundColor: colors['bg.canvas'],
      }}
    >
      <Text variant="body" tone="secondary">
        加载失败，请重试 / Something went wrong while loading.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="重试 / Retry"
        onPress={onRetry}
        testID="i18n-retry"
        style={{
          paddingHorizontal: space['4'],
          paddingVertical: space['2'],
          borderRadius: radius.md,
          backgroundColor: colors['accent.solid'],
        }}
      >
        <Text variant="subheading" style={{ color: colors['accent.fg'] }}>
          重试 / Retry
        </Text>
      </Pressable>
    </View>
  );
}

/** The browser tab's name. Web-only by feature detection, never by a platform switch. */
function useDocumentTitle(title: string): void {
  React.useEffect(() => {
    const doc = (globalThis as { document?: { title: string } }).document;
    if (doc) doc.title = title;
  }, [title]);
}

/** The toast host, lifted clear of whatever bar the shell below has at the bottom. */
function Toasts(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <ToastHost
      bottomOffset={useBottomTabInset()}
      closeLabel={t('common:button.close')}
      detailLabel={t('common:toast.show_detail')}
    />
  );
}

/** Everything that needs the language pack, the query client and the session. */
function AppTree(): React.JSX.Element {
  const { t } = useTranslation();
  useSwUpdateToast();

  return (
    <BottomTabInsetProvider>
      <AuthProvider queryClient={queryClient}>
        <Slot />
        <Toasts />
        <ConfirmHost
          labels={{
            confirm: t('common:button.confirm'),
            cancel: t('common:button.cancel'),
            confirmAgain: t('common:button.confirm_again'),
          }}
        />
      </AuthProvider>
    </BottomTabInsetProvider>
  );
}

export default function RootLayout(): React.JSX.Element {
  const i18n = useI18nReady();
  // Loaded, not awaited: the fallback stack renders until the real faces land.
  useAppFonts();
  useDocumentTitle(APP_NAME);

  // 04 §2.4 / §1.5 rule 4: a 404 on a ledger detail query flags that ledger as unavailable,
  // and `CurrentLedgerProvider` moves the tab off it (§14.66 c). (The 401 handler is
  // registered by `AuthProvider`.)
  React.useEffect(() => registerQueryHandlers({ onLedgerGone: markLedgerUnavailable }), []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          {i18n.status === 'ready' ? (
            <AppTree />
          ) : i18n.status === 'failed' ? (
            <I18nFailed onRetry={i18n.retry} />
          ) : (
            <AppSkeleton />
          )}
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
