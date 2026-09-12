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
import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';

import '@/pwa/registerSW';
import { APP_NAME } from '@/constants/config';
import { initI18n } from '@/i18n';
import { AppSkeleton, markLedgerGone, useSwUpdateToast } from '@/navigation';
import { queryClient, registerQueryHandlers } from '@/queries';
import { AuthProvider } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { useAppFonts } from '@/theme/fonts';
import { ConfirmHost, ToastHost } from '@/ui';

/** `true` once the language pack is live; `initI18n()` is idempotent. */
function useI18nReady(): boolean {
  const [ready, setReady] = React.useState(() => i18next.isInitialized);
  React.useEffect(() => {
    if (ready) return;
    let cancelled = false;
    void initI18n().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ready]);
  return ready;
}

/** The browser tab's name. Web-only by feature detection, never by a platform switch. */
function useDocumentTitle(title: string): void {
  React.useEffect(() => {
    const doc = (globalThis as { document?: { title: string } }).document;
    if (doc) doc.title = title;
  }, [title]);
}

/** Everything that needs the language pack, the query client and the session. */
function AppTree(): React.JSX.Element {
  const { t } = useTranslation();
  useSwUpdateToast();

  return (
    <AuthProvider queryClient={queryClient}>
      <Slot />
      <ToastHost
        closeLabel={t('common:button.close')}
        detailLabel={t('common:button.edit')}
      />
      <ConfirmHost
        labels={{
          confirm: t('common:button.confirm'),
          cancel: t('common:button.cancel'),
          confirmAgain: t('common:button.confirm'),
        }}
      />
    </AuthProvider>
  );
}

export default function RootLayout(): React.JSX.Element {
  const ready = useI18nReady();
  // Loaded, not awaited: the fallback stack renders until the real faces land.
  useAppFonts();
  useDocumentTitle(APP_NAME);

  // 04 §2.4 / §1.5 rule 4: a 404 on a ledger detail query flags that ledger as gone, and
  // `RequireLedger` picks the flag up. (The 401 handler is registered by `AuthProvider`.)
  React.useEffect(() => registerQueryHandlers({ onLedgerGone: markLedgerGone }), []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          {ready ? <AppTree /> : <AppSkeleton />}
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
