/**
 * `/register` (04 §4.2, screen 17). `GET /config` is read on mount (decision §14.46): while
 * it is in flight the form is a skeleton, and `registration_open === false` replaces the
 * whole form with one explanatory card — never a disabled form.
 *
 * Fields are exactly the four of decision §14.54: email, password, confirmation and the
 * default currency. No display name (it is NULL at registration, 03 §5.1 — screen 17 draws
 * one, but §14.54 is the later word) and no "locked after N failures" copy: the server only
 * rate-limits.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';

import { isApiClientError } from '@/api/errors';
import { deviceLanguage } from '@/i18n';
import { useCurrencyNames } from '@/i18n/currencyNames';
import { errorMessage } from '@/i18n/errorCodes';
import { formatCountdown } from '@/i18n/format';
import { qk, useConfig, useCurrencies } from '@/queries';
import { routes, safeNext } from '@/domain/routes';
import { useAuth } from '@/store';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button, Icon, Skeleton, Text, TextField, toast } from '@/ui';
import { CurrencyPicker } from '@/ui';
import { PREF_NAMES, setPref } from '@/utils/prefs';

import { AuthLayout, useRetryCountdown } from './AuthLayout';
import { registerSchema, type RegisterFormValues, validationMessage } from './schemas';

const DEFAULT_RETRY_AFTER = 30;

/** The neutral tile of screen 17's "registration is closed" card — grey, never error red. */
const TILE_SIZE = 48;

/** Decision §2 / 04 §4.2: guess from the device language, `zh-*` → CNY, else USD. */
export function guessBaseCurrency(deviceLang: string | null, codes: readonly string[]): string {
  const guess = deviceLang && deviceLang.toLowerCase().startsWith('zh') ? 'CNY' : 'USD';
  if (codes.length === 0) return guess;
  return codes.includes(guess) ? guess : codes[0];
}

export default function RegisterScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const qc = useQueryClient();
  const { register } = useAuth();
  // `/register?next=…` comes from the login page's "register" link: the destination the
  // user was originally bounced off survives the detour through registration (04 §1.5).
  const params = useLocalSearchParams<{ next?: string }>();
  const next = safeNext(params.next);
  const config = useConfig();
  const currencies = useCurrencies();
  // 屏幕稿 09 / 13 / 17 read 「CNY 人民币」, not the server's ISO English name.
  const currencyNames = useCurrencyNames(currencies.names);

  const [closedAfterSubmit, setClosedAfterSubmit] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const countdown = useRetryCountdown();

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', confirm_password: '', base_currency: '' },
  });

  // The currency list arrives after the first paint, so the default is filled in once it
  // lands — unless the user already picked something.
  const codes = currencies.codes;
  const currencyTouched = dirtyFields.base_currency === true;
  React.useEffect(() => {
    if (currencyTouched || codes.length === 0) return;
    setValue('base_currency', guessBaseCurrency(deviceLanguage(), codes));
  }, [codes, currencyTouched, setValue]);

  const blocked = submitting || countdown.seconds > 0;

  const onSubmit = React.useCallback(
    async (values: RegisterFormValues): Promise<void> => {
      setEmailError(null);
      setSubmitting(true);
      try {
        await register({
          email: values.email.trim(),
          password: values.password,
          base_currency: values.base_currency,
        });
        await setPref(PREF_NAMES.onboardingHint, '1');
        // '/' is the landing redirect, which sends the user into the ledger the server
        // just created for them (decision §2).
        router.replace('/' as Href);
      } catch (err) {
        const message = errorMessage(t, err);
        if (isApiClientError(err)) {
          if (err.code === 'registration_closed') {
            setClosedAfterSubmit(true);
            void qc.invalidateQueries({ queryKey: qk.global.config() });
            toast.error(message);
            return;
          }
          if (err.code === 'email_exists') {
            setEmailError(message);
            toast.error(message);
            return;
          }
          if (err.status === 429) countdown.start(err.retryAfter ?? DEFAULT_RETRY_AFTER);
        }
        toast.error(message);
      } finally {
        setSubmitting(false);
      }
    },
    [countdown, qc, register, router, t],
  );

  const submit = handleSubmit(onSubmit);
  const goToLogin = React.useCallback(
    () => router.replace(routes.login(next ?? undefined) as Href),
    [next, router],
  );

  const registrationClosed = closedAfterSubmit || config.data?.registration_open === false;

  if (registrationClosed) {
    return (
      // Screen 17 · 注册已关闭 drops the grey subtitle: 「注册后会自动为你建一本…」 describes
      // something that cannot happen here, so the frame is the title and the card alone.
      <AuthLayout title={t('auth:register.title')} testID="register-screen">
        {/* Screen 17: the same card in the same place as the form, holding one paragraph
            instead. The tile is neutral grey — this is not something the user did wrong. */}
        <View style={[styles.tile, { backgroundColor: colors['bg.subtle'] }]}>
          <Icon name="info" size={22} color={colors['fg.secondary']} />
        </View>
        <View style={styles.closedText}>
          <Text variant="heading" weight={700}>
            {t('auth:register.closed.title')}
          </Text>
          <Text variant="subheading" weight={400} tone="secondary" testID="register-closed-body">
            {t('auth:register.closed.body')}
          </Text>
        </View>
        <Button
          testID="register-closed-login"
          label={t('auth:register.closed.login_button')}
          variant="soft"
          size="lg"
          onPress={goToLogin}
          fullWidth
        />
      </AuthLayout>
    );
  }

  if (config.isPending) {
    return (
      <AuthLayout
        title={t('auth:register.title')}
        subtitle={t('auth:register.subtitle')}
        testID="register-screen"
      >
        <Text variant="caption" tone="muted">
          {t('auth:register.config_loading')}
        </Text>
        <Skeleton variant="table" rows={4} testID="register-skeleton" />
      </AuthLayout>
    );
  }

  const footer = (
    <>
      <Text variant="subheading" weight={400} tone="secondary">
        {t('auth:register.has_account')}
      </Text>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('auth:register.login_link')}
        testID="register-login-link"
        hitSlop={space['3']}
        onPress={goToLogin}
      >
        <Text variant="subheading" weight={600}>
          {t('auth:register.login_link')}
        </Text>
      </Pressable>
    </>
  );

  return (
    <AuthLayout
      title={t('auth:register.title')}
      subtitle={t('auth:register.subtitle')}
      footer={footer}
      testID="register-screen"
    >
      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <TextField
            testID="register-email"
            label={t('auth:register.email_label')}
            accessibilityLabel={t('auth:register.email_label')}
            placeholder={t('auth:register.email_placeholder')}
            mono
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={validationMessage(t, errors.email?.message) ?? emailError}
            disabled={blocked}
            autoComplete="email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <TextField
            testID="register-password"
            label={t('auth:register.password_label')}
            accessibilityLabel={t('auth:register.password_label')}
            placeholder={t('auth:register.password_placeholder')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={validationMessage(t, errors.password?.message)}
            disabled={blocked}
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect={false}
            secureToggle
            secureShowLabel={t('auth:login.show_password')}
            secureHideLabel={t('auth:login.hide_password')}
          />
        )}
      />
      <Controller
        control={control}
        name="confirm_password"
        render={({ field }) => (
          <TextField
            testID="register-confirm-password"
            label={t('auth:register.confirm_password_label')}
            accessibilityLabel={t('auth:register.confirm_password_label')}
            placeholder={t('auth:register.confirm_password_placeholder')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            onSubmitEditing={() => void submit()}
            error={validationMessage(t, errors.confirm_password?.message)}
            disabled={blocked}
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            secureToggle
            secureShowLabel={t('auth:login.show_password')}
            secureHideLabel={t('auth:login.hide_password')}
          />
        )}
      />
      <View style={styles.pickerBlock}>
        <Controller
          control={control}
          name="base_currency"
          render={({ field }) => (
            <CurrencyPicker
              testID="register-currency"
              label={t('auth:register.base_currency_label')}
              codes={codes}
              names={currencyNames}
              value={field.value === '' ? null : field.value}
              onChange={field.onChange}
              error={validationMessage(t, errors.base_currency?.message)}
              disabled={blocked}
            />
          )}
        />
        <Text variant="caption" tone="muted">
          {t('auth:register.base_currency_hint')}
        </Text>
      </View>

      <View style={styles.submitRow}>
        <Button
          testID="register-submit"
          label={t('auth:register.submit')}
          size="lg"
          onPress={() => void submit()}
          loading={submitting}
          disabled={blocked}
          // `flex: 1` and not `fullWidth`: the button shares a row with the countdown, and
          // in a row `alignSelf: stretch` only fills the cross axis.
          style={styles.submitButton}
        />
        {countdown.seconds > 0 ? (
          <Text variant="subheading" tone="muted" mono testID="register-countdown">
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
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closedText: { gap: space['1'] },
  pickerBlock: { gap: space['1'] },
});
