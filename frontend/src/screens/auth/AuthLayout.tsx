/**
 * The shell both `/login` and `/register` sit in (screen 17).
 *
 * Wide: a brand row pinned to the top-left of an otherwise empty canvas, and a 420 column
 * centred in what is left — title, one grey sentence, the white card, and the "switch to
 * the other page" line *under* the card, not inside it. Narrow: the same column, with the
 * brand mark stacked above the title instead of pinned to a top bar.
 *
 * `bg.canvas` comes from `Page`; nothing here draws chrome, because these two pages are
 * outside the app shell (04 §1.2).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Card, Page, Text } from '@/ui';

/** Card width on a wide screen; narrow screens take the full column. */
export const AUTH_CARD_MAX_WIDTH = 420;

/** Screen 17: 32 in the wide top bar, 44 stacked above a narrow page's title. */
export function BrandMark({ size = 32 }: { size?: number }): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  const glyph = t('auth:brand').trim().slice(0, 1);
  return (
    <View
      testID="brand-mark"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors['accent.solid'],
      }}
    >
      <Text
        weight={700}
        style={{
          fontSize: Math.round(size * 0.4),
          lineHeight: Math.round(size * 0.55),
          color: colors['accent.fg'],
        }}
      >
        {glyph}
      </Text>
    </View>
  );
}

/**
 * The wide top bar of screens 15 and 17: the brand on the left, and whatever the page
 * wants on the right (the onboarding page puts the signed-in email there; the auth pages
 * put nothing).
 */
export function BrandBar({ right }: { right?: React.ReactNode }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.brandBar} testID="brand-bar">
      <View style={styles.brandRow}>
        <BrandMark />
        <Text weight={600} style={styles.brandName} numberOfLines={1}>
          {t('auth:brand')}
        </Text>
      </View>
      {right ?? null}
    </View>
  );
}

export interface AuthLayoutProps {
  title: string;
  /** One sentence under the title. Omitted when the language pack has no copy for it. */
  subtitle?: string;
  children: React.ReactNode;
  /** The line under the card ("还没有账号？注册"). */
  footer?: React.ReactNode;
  testID?: string;
}

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  testID,
}: AuthLayoutProps): React.JSX.Element {
  const wide = useIsWide();

  return (
    <Page testID={testID} scroll contentStyle={styles.page}>
      {wide ? <BrandBar /> : null}
      <View style={styles.centre}>
        <View style={[styles.column, { maxWidth: AUTH_CARD_MAX_WIDTH }]}>
          {wide ? null : <BrandMark size={44} />}
          <View style={styles.heading}>
            <Text variant="title" accessibilityRole="header">
              {title}
            </Text>
            {subtitle !== undefined ? (
              <Text variant="subheading" weight={400} tone="secondary">
                {subtitle}
              </Text>
            ) : null}
          </View>
          <Card variant="raised" style={styles.card}>
            {children}
          </Card>
          {footer !== undefined ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  // The layout paints its own rhythm: the brand bar hugs the top, the column is centred
  // in everything below it.
  page: { flexGrow: 1, gap: 0, paddingTop: space['5'], paddingHorizontal: space['4'] },
  brandBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space['4'],
    paddingHorizontal: space['3'],
    paddingBottom: space['4'],
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandName: { fontSize: 15, lineHeight: 20 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: space['10'] },
  column: { width: '100%', gap: space['4'] },
  heading: { gap: space['2'] },
  card: { padding: space['6'], borderRadius: radius.lg, gap: space['4'] },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});

export interface RetryCountdown {
  /** Seconds still to wait; `0` means the control is free again. */
  seconds: number;
  /** Arm the countdown with `Retry-After` (04 §3.7 — 429 carries the header). */
  start(seconds: number): void;
}

/**
 * A one-second-tick countdown for 429 responses. `onElapsed` runs once, when the last
 * second is consumed — the join page uses it to retry the code the user already typed
 * (04 §4.3); the auth pages simply re-enable their submit button.
 */
export function useRetryCountdown(onElapsed?: () => void): RetryCountdown {
  const [seconds, setSeconds] = React.useState(0);
  const handler = React.useRef(onElapsed);
  handler.current = onElapsed;

  React.useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => {
      const next = seconds - 1;
      setSeconds(next);
      if (next === 0) handler.current?.();
    }, 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  return { seconds, start: setSeconds };
}
