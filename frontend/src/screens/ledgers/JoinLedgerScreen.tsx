/**
 * `/ledgers/join` (04 §4.3): six digits, submitted the moment the last one lands.
 *
 * There is deliberately **no preview** of the ledger behind a code (decision §14.52 B17 —
 * no endpoint for it, and none is planned). `invite_invalid` / `invite_expired` /
 * `already_member` shake the cells and clear them; 429 `invite_rate_limited` is an
 * endpoint-level 1 QPS limit rather than a per-user counter (decision §14.35), so the code
 * survives, the copy says so, and the same code is retried once when the countdown ends.
 */
import React from 'react';
import { View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { isApiClientError } from '@/api/errors';
import { routes } from '@/domain/routes';
import { errorMessage } from '@/i18n/errorCodes';
import { useJoinLedger } from '@/queries';
import { space } from '@/theme/tokens';
import { Page, Text, toast } from '@/ui';

import { CODE_LENGTH, CodeInput } from './CodeInput';

/** Used when a 429 arrives without a usable `Retry-After` header; the limit is 1 QPS. */
const DEFAULT_RETRY_AFTER = 5;

export default function JoinLedgerScreen(): React.JSX.Element {
  const { t } = useTranslation();
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
            setShakeToken((n) => n + 1);
            setCode('');
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

  return (
    <Page testID="join-ledger-screen">
      <Text variant="title" accessibilityRole="header">
        {t('ledger:join.title')}
      </Text>
      <View style={{ gap: space['3'], maxWidth: 420, width: '100%' }}>
        <Text variant="body" tone="secondary">
          {t('ledger:join.code_hint')}
        </Text>
        <CodeInput
          testID="join-code"
          accessibilityLabel={t('ledger:join.code_hint')}
          value={code}
          onChange={setCode}
          onComplete={submit}
          shakeToken={shakeToken}
          disabled={isPending || waiting}
          autoFocus
        />
        {message !== null ? (
          <Text variant="caption" tone="danger" testID="join-error">
            {message}
          </Text>
        ) : null}
        {waiting ? (
          <Text variant="caption" tone="muted" testID="join-countdown">
            {t('ledger:join.rate_limited_countdown', { seconds: retrySeconds })}
          </Text>
        ) : null}
      </View>
    </Page>
  );
}

export { CODE_LENGTH };
