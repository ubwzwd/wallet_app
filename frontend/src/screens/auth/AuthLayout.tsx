/**
 * The shell both `/login` and `/register` sit in (screen 17): a vertically centred card,
 * capped at 420 on wide screens and full-width on narrow ones, with the page title and an
 * optional subtitle above it.
 */
import React from 'react';
import { View } from 'react-native';
import { space } from '@/theme/tokens';
import { Card, Page, Text } from '@/ui';

/** Card width on a wide screen; narrow screens take the full column. */
export const AUTH_CARD_MAX_WIDTH = 420;

export interface AuthLayoutProps {
  title: string;
  /** One sentence under the title. Omitted when the language pack has no copy for it. */
  subtitle?: string;
  children: React.ReactNode;
  testID?: string;
}

export function AuthLayout({
  title,
  subtitle,
  children,
  testID,
}: AuthLayoutProps): React.JSX.Element {
  return (
    <Page
      testID={testID}
      contentStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}
    >
      <View style={{ width: '100%', maxWidth: AUTH_CARD_MAX_WIDTH, gap: space['4'] }}>
        <View style={{ gap: space['1'] }}>
          <Text variant="title" accessibilityRole="header">
            {title}
          </Text>
          {subtitle !== undefined ? (
            <Text variant="body" tone="muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Card variant="raised" style={{ gap: space['3'] }}>
          {children}
        </Card>
      </View>
    </Page>
  );
}

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
