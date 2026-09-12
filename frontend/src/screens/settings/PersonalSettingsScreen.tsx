/**
 * `/settings` — personal settings (04 §4.13).
 *
 * Three of the four preferences live on the server (`display_name`, `base_currency`,
 * `language`) and every `PATCH /me` carries only the field that changed. The fourth,
 * "appearance", is deliberately device-local: it is written through `ThemeProvider` and
 * never sent anywhere (decision §14.52 A23).
 */
import React from 'react';
import { View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { User } from '@/api/types';
import { routes } from '@/domain/routes';
import { applyLanguage, useLang, type Lang } from '@/i18n';
import { formatDateTime } from '@/i18n/format';
import { useCurrencies, useMe, useUpdateMe } from '@/queries';
import { useAuth, useOptionalLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useTheme, type ThemePref } from '@/theme/ThemeProvider';
import {
  Button,
  Card,
  CurrencyPicker,
  Page,
  SegmentedControl,
  Skeleton,
  Text,
  TextField,
  toast,
} from '@/ui';

/** Decision §14.6: a display name is at most 40 characters, and may be empty. */
export const DISPLAY_NAME_MAX_LENGTH = 40;

/** `null` is the server's spelling of "follow the system" (decision §14.6). */
type LanguageChoice = 'system' | Lang;

/** The part of an email before `@` — what an empty display name falls back to. */
function emailPrefix(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

export default function PersonalSettingsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const router = useRouter();
  const { logout, setUser } = useAuth();
  const theme = useTheme();
  const currencies = useCurrencies();
  const ledgerContext = useOptionalLedgerContext();
  const me = useMe();
  const update = useUpdateMe();

  const user: User | undefined = me.data;
  const serverName = user?.display_name ?? '';
  const [name, setName] = React.useState(serverName);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (touched) return;
    setName(serverName);
  }, [serverName, touched]);

  const onSaved = React.useCallback(
    (next: User, message: string): void => {
      setUser(next);
      toast.success(message);
    },
    [setUser],
  );

  const saveName = (): void => {
    if (!user) return;
    const trimmed = name.trim();
    // An empty box is an explicit `null`, not an empty string (04 §4.13).
    const value = trimmed === '' ? null : trimmed;
    if (value === user.display_name) return;
    update.mutate(
      { display_name: value },
      {
        onSuccess: (next) => {
          setTouched(false);
          onSaved(next, t('settings:display_name_saved_toast'));
        },
      },
    );
  };

  const changeCurrency = (next: string): void => {
    if (!user || next === user.base_currency) return;
    update.mutate(
      { base_currency: next },
      { onSuccess: (u) => onSaved(u, t('settings:base_currency_saved_toast')) },
    );
  };

  const changeLanguage = (choice: LanguageChoice): void => {
    const value: Lang | null = choice === 'system' ? null : choice;
    void applyLanguage(value);
    update.mutate({ language: value }, { onSuccess: (u) => setUser(u) });
  };

  const changeAppearance = (next: ThemePref): void => {
    void theme.setPref(next);
  };

  const goLedgerSettings = (): void => {
    router.push(
      (ledgerContext
        ? routes.l(ledgerContext.ledgerId).settings()
        : routes.ledgers()) as Href,
    );
  };

  const signOut = (): void => {
    void (async () => {
      await logout();
      router.replace(routes.login() as Href);
    })();
  };

  const languageValue: LanguageChoice = user?.language ?? 'system';

  return (
    <Page>
      <Text variant="title" accessibilityRole="header">
        {t('settings:title')}
      </Text>

      <Card variant="outlined" style={{ gap: space['3'] }} testID="profile-card">
        <Text variant="heading" accessibilityRole="header">
          {t('settings:section.profile')}
        </Text>
        {user ? (
          <View style={{ gap: space['1'] }}>
            <Text variant="caption" tone="secondary">
              {t('settings:email_label')}
            </Text>
            <Text testID="settings-email">{user.email}</Text>
            <Text variant="caption" tone="secondary">
              {t('settings:created_at_label')}
            </Text>
            <Text variant="caption" tone="muted" testID="settings-created-at">
              {formatDateTime(user.created_at, lang)}
            </Text>
          </View>
        ) : (
          <Skeleton variant="row" testID="settings-profile-skeleton" />
        )}

        <TextField
          testID="settings-display-name"
          label={t('settings:display_name_label')}
          accessibilityLabel={t('settings:display_name_label')}
          value={name}
          onChangeText={(next) => {
            setTouched(true);
            setName(next);
          }}
          hint={t('settings:display_name_hint', {
            fallback: user ? emailPrefix(user.email) : '',
          })}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          showCounter
          disabled={!user || update.isPending}
        />
        <Button
          testID="settings-display-name-save"
          label={t('settings:save')}
          size="sm"
          onPress={saveName}
          loading={update.isPending}
          disabled={!user}
        />

        <CurrencyPicker
          testID="settings-base-currency"
          label={t('settings:base_currency_label')}
          codes={currencies.codes}
          names={currencies.names}
          value={user?.base_currency ?? null}
          onChange={changeCurrency}
          disabled={!user || update.isPending}
        />
        <Text variant="caption" tone="muted" testID="settings-base-currency-hint">
          {t('settings:base_currency_hint')}
        </Text>
      </Card>

      <Card variant="outlined" style={{ gap: space['3'] }} testID="device-card">
        <Text variant="heading" accessibilityRole="header">
          {t('settings:section.device')}
        </Text>

        <Text variant="caption" tone="secondary">
          {t('settings:language_label')}
        </Text>
        <SegmentedControl<LanguageChoice>
          testID="settings-language"
          accessibilityLabel={t('settings:language_label')}
          value={languageValue}
          onChange={changeLanguage}
          options={[
            { value: 'system', label: t('settings:language.system') },
            { value: 'zh', label: t('settings:language.zh') },
            { value: 'en', label: t('settings:language.en') },
          ]}
        />

        <Text variant="caption" tone="secondary">
          {t('settings:appearance_label')}
        </Text>
        <SegmentedControl<ThemePref>
          testID="settings-appearance"
          accessibilityLabel={t('settings:appearance_label')}
          value={theme.pref}
          onChange={changeAppearance}
          options={[
            { value: 'system', label: t('settings:appearance.system'), icon: 'monitor' },
            { value: 'light', label: t('settings:appearance.light'), icon: 'sun' },
            { value: 'dark', label: t('settings:appearance.dark'), icon: 'moon' },
          ]}
        />
      </Card>

      <Card variant="outlined" style={{ gap: space['2'] }} testID="entries-card">
        <Text variant="heading" accessibilityRole="header">
          {t('settings:section.entries')}
        </Text>
        <Button
          testID="settings-ledger-settings"
          label={t('settings:entry.ledger_settings')}
          variant="secondary"
          size="sm"
          icon="settings"
          onPress={goLedgerSettings}
        />
        <Button
          testID="settings-switch-ledger"
          label={t('settings:entry.switch_ledger')}
          variant="secondary"
          size="sm"
          icon="wallet"
          onPress={() => router.push(routes.ledgers() as Href)}
        />
        <Button
          testID="settings-logout"
          label={t('settings:entry.logout')}
          variant="secondary"
          size="sm"
          icon="log-out"
          onPress={signOut}
        />
      </Card>
    </Page>
  );
}
