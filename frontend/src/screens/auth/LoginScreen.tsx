/**
 * `/login` (04 §4.1, screen 17): take the credentials, hand them to `AuthContext.login()`,
 * land on `?next=` (validated by `safeNext`) or on `/`, which the landing redirect resolves.
 *
 * Two error shapes get special treatment: 401 `invalid_credentials` renders under the
 * password field *and* raises a toast while leaving the form untouched, and 429
 * `login_rate_limited` arms a `Retry-After` countdown that keeps the button disabled.
 */
import React from 'react';
import { Pressable, StyleSheet, type TextInput, View } from 'react-native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';

import { isApiClientError } from '@/api/errors';
import { routes, safeNext } from '@/domain/routes';
import { errorMessage } from '@/i18n/errorCodes';
import { formatCountdown } from '@/i18n/format';
import { useAuth } from '@/store';
import { space } from '@/theme/tokens';
import { Button, Text, TextField, toast } from '@/ui';

import { AuthLayout, useRetryCountdown } from './AuthLayout';
import { loginSchema, type LoginFormValues, validationMessage } from './schemas';

/** Fallback wait when a 429 arrives without a usable `Retry-After` header. */
const DEFAULT_RETRY_AFTER = 30;

export default function LoginScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { login } = useAuth();
  const params = useLocalSearchParams<{ next?: string }>();
  const nextParam = Array.isArray(params.next) ? params.next[0] : params.next;

  const passwordRef = React.useRef<TextInput>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const countdown = useRetryCountdown();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const blocked = submitting || countdown.seconds > 0;

  const onSubmit = React.useCallback(
    async (values: LoginFormValues): Promise<void> => {
      setServerError(null);
      setSubmitting(true);
      try {
        await login({ email: values.email.trim(), password: values.password });
        router.replace((safeNext(nextParam) ?? '/') as Href);
      } catch (err) {
        // The form keeps its values on purpose (04 §4.1): the user usually mistyped
        // only the password.
        const message = errorMessage(t, err);
        setServerError(message);
        toast.error(message);
        if (isApiClientError(err) && err.status === 429) {
          countdown.start(err.retryAfter ?? DEFAULT_RETRY_AFTER);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [countdown, login, nextParam, router, t],
  );

  const submit = handleSubmit(onSubmit);

  // 04 §4.1: the server's verdict is about what was submitted, so the moment the user
  // changes anything it stops being true — and the message under the password field goes.
  const clearServerError = React.useCallback((): void => {
    setServerError((current) => (current === null ? current : null));
  }, []);

  const footer = (
    <>
      <Text variant="subheading" weight={400} tone="secondary">
        {t('auth:login.no_account')}
      </Text>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('auth:login.register_link')}
        testID="login-register-link"
        // One line of text; the slop is what makes it a 44 tap target.
        hitSlop={space['3']}
        onPress={() => router.push(routes.register(safeNext(nextParam) ?? undefined) as Href)}
      >
        <Text variant="subheading" weight={600}>
          {t('auth:login.register_link')}
        </Text>
      </Pressable>
    </>
  );

  return (
    <AuthLayout
      title={t('auth:login.title')}
      subtitle={t('auth:login.subtitle')}
      footer={footer}
      testID="login-screen"
    >
      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <TextField
            testID="login-email"
            label={t('auth:login.email_label')}
            accessibilityLabel={t('auth:login.email_label')}
            placeholder={t('auth:login.email_placeholder')}
            // Screen 17 sets the email field in mono: an address is read character by
            // character, the way a code is.
            mono
            value={field.value}
            onChangeText={(text) => {
              clearServerError();
              field.onChange(text);
            }}
            onBlur={field.onBlur}
            onSubmitEditing={() => passwordRef.current?.focus()}
            error={validationMessage(t, errors.email?.message)}
            disabled={blocked}
            autoComplete="email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            submitBehavior="submit"
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <TextField
            ref={passwordRef}
            testID="login-password"
            label={t('auth:login.password_label')}
            accessibilityLabel={t('auth:login.password_label')}
            placeholder={t('auth:login.password_placeholder')}
            value={field.value}
            onChangeText={(text) => {
              clearServerError();
              field.onChange(text);
            }}
            onBlur={field.onBlur}
            onSubmitEditing={() => void submit()}
            error={validationMessage(t, errors.password?.message) ?? serverError}
            disabled={blocked}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            secureToggle
            secureShowLabel={t('auth:login.show_password')}
            secureHideLabel={t('auth:login.hide_password')}
          />
        )}
      />

      <View style={styles.submitRow}>
        <Button
          testID="login-submit"
          label={t('auth:login.submit')}
          size="lg"
          onPress={() => void submit()}
          loading={submitting}
          disabled={blocked}
          // `flex: 1` and not `fullWidth`: the button shares a row with the countdown, and
          // in a row `alignSelf: stretch` only fills the cross axis.
          style={styles.submitButton}
        />
        {countdown.seconds > 0 ? (
          <Text variant="subheading" tone="muted" mono testID="login-countdown">
            {formatCountdown(countdown.seconds)}
          </Text>
        ) : null}
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  submitRow: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  submitButton: { flex: 1 },
});
