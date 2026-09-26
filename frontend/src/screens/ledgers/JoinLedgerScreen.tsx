/**
 * `/ledgers/join` (04 §4.3, screen 13): six digits in six big squares, submitted the moment
 * the last one lands — the 「加入」 button is the same action for anyone who pastes and then
 * reaches for a button.
 *
 * Screen 13's wide frame is named 「1440 · Dialog」: on a wide screen this is a modal laid
 * over the ledger list, with 取消 / 加入 in the foot band on the right, so the list is
 * rendered behind it and the page draws no header of its own. Narrow keeps the standalone
 * page of the 375 frame (a round back button, the title, the card, the benefits card); inside
 * the shell that back button and title are the shell's sub-page top bar (§14.64 e).
 *
 * There is deliberately **no preview** of the ledger behind a code (decision §14.52 B17,
 * and screen 13's own note: nothing about a ledger is shown before the code is spent).
 * `invite_invalid` / `invite_expired` / `already_member` shake the cells and turn them red
 * while **keeping the digits** — screen 13 · 失效 shows the rejected code still in place, so
 * the user can see what was refused; 「重新输入」 is what clears it. 429 `invite_rate_limited`
 * is an endpoint-level 1 QPS limit rather than a per-user counter (decision §14.35), so the
 * code survives, the copy says so, and the same code is retried once when the countdown ends.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { isApiClientError } from '@/api/errors';
import { routes } from '@/domain/routes';
import { errorMessage } from '@/i18n/errorCodes';
import { useBack, useShellDrawsTopBar, useTopBar } from '@/navigation';
import { useJoinLedger } from '@/queries';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Card, Icon, Page, Text } from '@/ui';
import { toast } from '@/ui';

import { CODE_LENGTH, CodeInput } from './CodeInput';
import { JoinBenefits } from './JoinBenefits';
import { JoinDialogFrame } from './JoinDialogFrame';
import { StandaloneHeader } from './StandaloneHeader';

/** Used when a 429 arrives without a usable `Retry-After` header; the limit is 1 QPS. */
const DEFAULT_RETRY_AFTER = 5;

/** Screen 13's wide frame: a 520 dialog. */
const CARD_MAX_WIDTH = 520;
const KEY_TILE = 48;

export default function JoinLedgerScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const router = useRouter();
  const { mutate, isPending } = useJoinLedger({ silent: true });

  const [code, setCode] = React.useState('');
  const [message, setMessage] = React.useState<string | null>(null);
  const [shakeToken, setShakeToken] = React.useState(0);
  const [retrySeconds, setRetrySeconds] = React.useState(0);
  /** The code a rate-limited attempt was carrying, retried once when the wait is over. */
  const queued = React.useRef<string | null>(null);

  const submit = React.useCallback(
    (value: string): void => {
      setMessage(null);
      mutate(
        { code: value },
        {
          onSuccess: (ledger) => {
            toast.success(t('ledger:join.success_toast', { name: ledger.name }));
            router.replace(routes.l(ledger.id).home() as Href);
          },
          onError: (err) => {
            setMessage(errorMessage(t, err));
            if (isApiClientError(err) && err.status === 429) {
              queued.current = value;
              setRetrySeconds(err.retryAfter ?? DEFAULT_RETRY_AFTER);
              return;
            }
            // The digits stay: screen 13 · 失效 turns the six cells red around the code
            // that was refused. The next keystroke only clears the red (`handleChange`);
            // 「重新输入」 is the one thing that empties the row.
            setShakeToken((n) => n + 1);
          },
        },
      );
    },
    [mutate, router, t],
  );

  // Kept in a ref so the countdown effect does not restart whenever `submit`'s closure
  // is rebuilt.
  const submitRef = React.useRef(submit);
  submitRef.current = submit;

  React.useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = setTimeout(() => {
      const next = retrySeconds - 1;
      setRetrySeconds(next);
      if (next > 0) return;
      const pending = queued.current;
      queued.current = null;
      if (pending) submitRef.current(pending);
    }, 1000);
    return () => clearTimeout(timer);
  }, [retrySeconds]);

  const waiting = retrySeconds > 0;
  // A rate limit is not a verdict on the code, so the row stays neutral and keeps counting
  // down; anything else the server refused turns it red.
  const rejected = message !== null && !waiting;
  const complete = code.length === CODE_LENGTH;

  const restart = React.useCallback((): void => {
    setMessage(null);
    setCode('');
  }, []);

  const handleChange = React.useCallback((next: string): void => {
    setCode(next);
    setMessage((current) => (current === null ? current : null));
  }, []);

  const title = t('ledger:join.title');
  useTopBar(title);
  const back = useBack();
  const goBack = back.goBack;
  const shellBar = useShellDrawsTopBar();

  const intro = (
    <View
      style={[
        styles.intro,
        wide ? { borderBottomColor: colors['border.default'], borderBottomWidth: 1 } : null,
      ]}
    >
      <View style={[styles.keyTile, { backgroundColor: colors['accent.subtle'] }]}>
        <Icon name="key-round" size={22} color={colors['accent.solid']} />
      </View>
      <Text variant="heading" weight={700} style={styles.centred}>
        {t('ledger:join.card_title')}
      </Text>
      <Text variant="body" tone="muted" style={styles.centred}>
        {t('ledger:join.code_hint')}
      </Text>
    </View>
  );

  const cells = (
    <CodeInput
      testID="join-code"
      accessibilityLabel={t('ledger:join.card_title')}
      value={code}
      onChange={handleChange}
      onComplete={submit}
      shakeToken={shakeToken}
      state={rejected ? 'error' : complete ? 'success' : 'default'}
      disabled={isPending || waiting}
      autoFocus
    />
  );

  const verdict = rejected ? (
    <View style={[styles.alert, { backgroundColor: colors['status.danger.bg'] }]}>
      <Icon name="alert-triangle" color={colors['status.danger.fg']} />
      <View style={styles.alertText}>
        <Text variant="body" weight={700}>
          {t('ledger:join.error_title')}
        </Text>
        <Text variant="caption" tone="danger" testID="join-error">
          {message}
        </Text>
      </View>
    </View>
  ) : (
    <Text variant="caption" tone="muted" style={styles.centred}>
      {t('ledger:join.paste_hint')}
    </Text>
  );

  const countdown = waiting ? (
    <View style={styles.waitBlock}>
      <Text variant="caption" tone="danger" testID="join-error" style={styles.centred}>
        {message}
      </Text>
      <Text variant="caption" tone="muted" testID="join-countdown" style={styles.centred}>
        {t('ledger:join.rate_limited_countdown', { seconds: retrySeconds })}
      </Text>
    </View>
  ) : null;

  const action = rejected ? (
    <Button
      testID="join-restart"
      label={t('ledger:join.retry_button')}
      variant="soft"
      size={wide ? 'md' : 'lg'}
      onPress={restart}
      fullWidth={!wide}
    />
  ) : (
    <Button
      testID="join-submit"
      label={t('ledger:join.submit')}
      size={wide ? 'md' : 'lg'}
      onPress={() => submit(code)}
      loading={isPending}
      disabled={!complete || waiting}
      fullWidth={!wide}
    />
  );

  // ------------------------------------------------------------- 1440 · Dialog
  if (wide) {
    return (
      <JoinDialogFrame
        maxWidth={CARD_MAX_WIDTH}
        onDismiss={goBack}
        foot={
          <>
            <Button
              testID="join-cancel"
              label={t('common:button.cancel')}
              variant="soft"
              onPress={goBack}
            />
            {action}
          </>
        }
      >
        {intro}
        {cells}
        {verdict}
        {countdown}
        <JoinBenefits variant="inline" />
      </JoinDialogFrame>
    );
  }

  // ------------------------------------------------------------------- 375 页
  return (
    <Page testID="join-ledger-screen" contentStyle={styles.page}>
      {shellBar ? null : <StandaloneHeader title={title} onBack={goBack} testID="join-header" />}

      <View style={styles.centre}>
        <View style={[styles.column, { maxWidth: CARD_MAX_WIDTH }]}>
          <Card variant="raised" style={styles.card}>
            {intro}
            {cells}
            {verdict}
            {countdown}
            {action}
          </Card>
          <JoinBenefits variant="card" />
        </View>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, gap: space['4'] },
  centre: { flex: 1, alignItems: 'center' },
  column: { width: '100%', gap: space['3'] },
  card: { padding: space['5'], gap: space['4'] },
  intro: { alignItems: 'center', gap: space['2'], paddingBottom: space['4'] },
  centred: { textAlign: 'center' },
  keyTile: {
    width: KEY_TILE,
    height: KEY_TILE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space['3'],
    padding: space['3'],
    borderRadius: radius.md,
  },
  alertText: { flex: 1, gap: space['1'] },
  waitBlock: { gap: space['1'] },
});

export { CODE_LENGTH };
