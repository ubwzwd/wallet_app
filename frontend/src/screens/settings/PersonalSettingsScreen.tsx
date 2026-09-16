/**
 * `/settings` — 「我的」 (04 §4.13), rebuilt against 屏幕稿 14.
 *
 * Wide: a page head — 「我的」 + 「只影响你自己，不影响账本里的其他人」 + 「保存」 — over two
 * columns. Left is 关于我 (avatar, display name, default currency) and 语言; right is 外观,
 * the 关于 row and the 登录 card whose only control is the outlined 「退出登录」. Narrow
 * stacks profile → 偏好 (默认币种 / 外观 / 语言) → 入口 → 关于 → 退出登录.
 *
 * Three of the four preferences live on the server (`display_name`, `base_currency`,
 * `language`) and every `PATCH /me` carries only the field that changed. The fourth,
 * "appearance", is deliberately device-local: it is written through `ThemeProvider` and
 * never sent anywhere (decision §14.52 A23).
 */
import React from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { User } from '@/api/types';
import { routes } from '@/domain/routes';
import { applyLanguage, useLang, type Lang } from '@/i18n';
import { pickLandingLedger, useLastLedgerId, useTopBar } from '@/navigation';
import { useCurrencyNames } from '@/i18n/currencyNames';
import { useCurrencies, useLedgers, useMe, useUpdateMe } from '@/queries';
import { useAuth, useOptionalLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useColors, useTheme, type ThemePref } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  Button,
  Card,
  Icon,
  ListCard,
  ListRow,
  Page,
  PageHeader,
  SegmentedControl,
  Select,
  Text,
  toast,
} from '@/ui';

import { IconWell } from './IconWell';
import { LanguageCard, LanguageField, type LanguageChoice } from './LanguageCard';
import { DISPLAY_NAME_MAX_LENGTH, ProfileCard } from './ProfileCard';
import { SectionLabel } from './SectionLabel';

export { DISPLAY_NAME_MAX_LENGTH };

/** 屏幕稿 14: `minmax(0,1.15fr) minmax(0,1fr)`. */
const LEFT_FLEX = 1.15;

/** The version the 关于 row shows; `app.json` is the single source (04 §7.2). */
function appVersion(): string {
  return Constants.expoConfig?.version ?? '';
}

export default function PersonalSettingsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const wide = useIsWide();
  const colors = useColors();
  const router = useRouter();
  const { logout, setUser } = useAuth();
  const theme = useTheme();
  const currencies = useCurrencies();
  // 屏幕稿 14 reads 「CNY 人民币」, not the server's English ISO name (see `currencyNames`).
  const currencyNames = useCurrencyNames(currencies.names);
  const ledgerContext = useOptionalLedgerContext();
  // Outside a ledger route the chrome picks one from the preference plus the cached list;
  // the 「账本设置」 row has to agree with it, or the page would send the user somewhere
  // other than the ledger its own sidebar is showing.
  const lastLedgerId = useLastLedgerId();
  const ledgerList = useLedgers();
  const settingsLedgerId =
    pickLandingLedger(ledgerList.data?.items ?? [], lastLedgerId ?? null)?.id ?? null;
  const me = useMe();
  const update = useUpdateMe();
  // 04 §1.4: the narrow shell's top bar is the title (`AppShell` renders it for a page
  // outside any ledger too), so the page only prints one on a wide layout.
  useTopBar(t('settings:title'));

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
    // Re-picking what is already selected is a no-op, like the other two fields.
    if (!user || value === user.language) return;
    void applyLanguage(value);
    update.mutate({ language: value }, { onSuccess: (u) => setUser(u) });
  };

  const changeAppearance = (next: ThemePref): void => {
    void theme.setPref(next);
  };

  // 屏幕稿 14: the row opens 「账本设置」 for the ledger the sidebar beside it is naming —
  // which, off a ledger route, is the remembered one (the same answer `/` would land on).
  // Only a user with no ledger at all has nothing to open, and then the row leads to the
  // list, where they can make one.
  const goLedgerSettings = (): void => {
    const target = ledgerContext?.ledgerId ?? settingsLedgerId;
    router.push((target === null ? routes.ledgers() : routes.l(target).settings()) as Href);
  };

  const signOut = (): void => {
    void (async () => {
      await logout();
      router.replace(routes.login() as Href);
    })();
  };

  const languageValue: LanguageChoice = user?.language ?? 'system';
  const dirty = user !== undefined && (name.trim() === '' ? null : name.trim()) !== user.display_name;

  /**
   * 屏幕稿 14 prints 「CNY 人民币」 in the closed 默认币种 field, not the bare code —
   * `CurrencyPicker` hands the name to `Select` as the option's hint, and a hint only shows
   * inside the open list, so this page builds the options itself with the name folded into
   * the label. Everything else (the testIDs, the search, the sheet) is what `CurrencyPicker`
   * would have rendered: it is the same `Select` underneath.
   */
  const currencyOptions = currencies.codes.map((code) => {
    const name = currencyNames[code];
    return { value: code, label: name === undefined ? code : `${code} ${name}` };
  });

  const currencyField = (
    <View style={{ gap: space['1'] + 2 }}>
      <Select
        testID="settings-base-currency"
        label={t('settings:base_currency_label')}
        placeholder={t('settings:base_currency_label')}
        closeLabel={t('common:button.close')}
        searchable
        searchPlaceholder={t('settings:base_currency_label')}
        emptyLabel={t('common:status.none')}
        options={currencyOptions}
        value={user?.base_currency ?? null}
        onChange={(next) => {
          if (next !== null) changeCurrency(next);
        }}
        disabled={!user || update.isPending}
      />
      <Text variant="caption" tone="muted" testID="settings-base-currency-hint">
        {t('settings:base_currency_hint')}
      </Text>
    </View>
  );

  const appearanceControl = (
    <SegmentedControl<ThemePref>
      testID="settings-appearance"
      accessibilityLabel={t('settings:appearance_label')}
      value={theme.pref}
      onChange={changeAppearance}
      options={[
        { value: 'system', label: t('settings:appearance.system') },
        { value: 'light', label: t('settings:appearance.light') },
        { value: 'dark', label: t('settings:appearance.dark') },
      ]}
    />
  );

  const entriesCard = (
    <ListCard divided testID="entries-card">
      <ListRow
        testID="settings-ledger-settings"
        icon={<IconWell name="settings" tone="neutral" size={32} />}
        title={t('settings:entry.ledger_settings')}
        onPress={goLedgerSettings}
        trailing={<Icon name="chevron-right" size={16} color={colors['fg.muted']} />}
      />
      <ListRow
        testID="settings-switch-ledger"
        icon={<IconWell name="wallet" tone="neutral" size={32} />}
        title={t('settings:entry.switch_ledger')}
        onPress={() => router.push(routes.ledgers() as Href)}
        trailing={<Icon name="chevron-right" size={16} color={colors['fg.muted']} />}
      />
    </ListCard>
  );

  // 屏幕稿 14 draws a chevron here, but v3.0 has no 「关于」 page to open — the row states
  // the version and stays inert rather than promising a destination that does not exist.
  const aboutCard = (
    <ListCard testID="about-card">
      <ListRow
        testID="settings-about"
        icon={<IconWell name="info" tone="neutral" size={32} />}
        title={t('settings:about_label')}
        amount={appVersion()}
        amountTone="muted"
      />
    </ListCard>
  );

  const sessionCard = (
    <Card variant="raised" testID="session-card" style={{ padding: space['5'], gap: space['3'] }}>
      {wide ? (
        <Text variant="subheading" weight={700} accessibilityRole="header">
          {t('settings:section.session')}
        </Text>
      ) : null}
      <Text variant="body" tone="muted" testID="settings-logout-hint">
        {t('settings:logout_hint')}
      </Text>
      <Button
        testID="settings-logout"
        label={t('settings:entry.logout')}
        icon="log-out"
        variant="danger"
        size="lg"
        fullWidth
        onPress={signOut}
      />
    </Card>
  );

  const save = (
    <Button
      testID="settings-display-name-save"
      label={t('settings:save')}
      onPress={saveName}
      loading={update.isPending}
      disabled={!user || !dirty}
    />
  );

  // No subtitle and no header action (user's call 2026-09-16, §14.61): 「保存」 belongs to
  // the one field that needs it, so it sits under 显示名 inside the profile card.
  const header = <PageHeader testID="personal-settings" title={t('settings:title')} />;

  if (!wide) {
    return (
      <Page testID="personal-settings-screen">
        {header}
        <ProfileCard
          user={user}
          name={name}
          onNameChange={(next) => {
            setTouched(true);
            setName(next);
          }}
          disabled={!user || update.isPending}
          nameAction={save}
        />
        {/* 屏幕稿 14 · 375 sets a small 「偏好」 label above the card the way 屏幕稿 12 does. */}
        <View>
          <SectionLabel title={t('settings:section.prefs')} testID="settings-prefs-label" />
          <Card
            variant="raised"
            testID="device-card"
            style={{ padding: space['4'], gap: space['5'] }}
          >
            {currencyField}
            <View style={{ gap: space['2'] }}>
              <Text variant="caption" tone="secondary" weight={600}>
                {t('settings:appearance_label')}
              </Text>
              {appearanceControl}
              <Text variant="caption" tone="muted" testID="settings-appearance-hint">
                {t('settings:appearance_hint')}
              </Text>
            </View>
            <LanguageField value={languageValue} resolved={lang} onChange={changeLanguage} />
          </Card>
        </View>
        {entriesCard}
        {aboutCard}
        {sessionCard}
      </Page>
    );
  }

  return (
    <Page testID="personal-settings-screen">
      {header}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space['6'] }}>
        <View style={{ flexGrow: LEFT_FLEX, flexShrink: 1, flexBasis: 0, gap: space['5'] }}>
          <ProfileCard
            user={user}
            name={name}
            onNameChange={(next) => {
              setTouched(true);
              setName(next);
            }}
            disabled={!user || update.isPending}
          nameAction={save}
            currencyField={currencyField}
          />
          <LanguageCard value={languageValue} resolved={lang} onChange={changeLanguage} />
        </View>
        <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, gap: space['5'] }}>
          <Card
            variant="raised"
            testID="device-card"
            style={{ padding: space['5'], gap: space['3'] + 2 }}
          >
            <Text variant="subheading" weight={700} accessibilityRole="header">
              {t('settings:section.appearance')}
            </Text>
            {appearanceControl}
            <Text variant="body" tone="muted" testID="settings-appearance-hint">
              {t('settings:appearance_hint')}
            </Text>
          </Card>
          {entriesCard}
          {aboutCard}
          {sessionCard}
        </View>
      </View>
    </Page>
  );
}
