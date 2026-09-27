/**
 * `/ledgers/new` (04 §4.3): name (1–100, decision §14.13) plus the base currency, which
 * defaults to the user's own `base_currency` (decision §2).
 *
 * Screen 13 has no frame of its own for this page, so it borrows the join page's: the same
 * head (`LedgerPageHead` — for a user with ledgers a sub-page of 首页, §14.65 d: the wide
 * crumb 「首页 · 新建账本」, the narrow shell's top bar), the same centred white card, one
 * primary button at the bottom.
 *
 * `useCreateLedger` already invalidates the ledger list on success, so this screen only
 * has to enter the ledger it just made: it becomes the tab's current ledger and the page is
 * `/home` (`useEnterLedger`, decision §14.66).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/i18n/errorCodes';
import { useTopBar } from '@/navigation';
import { useCurrencyNames } from '@/i18n/currencyNames';
import { useCreateLedger, useCurrencies, useLedgers } from '@/queries';
import {
  LEDGER_NAME_MAX_LENGTH,
  ledgerCreateSchema,
  type LedgerCreateFormValues,
  validationMessage,
} from '@/screens/auth/schemas';
import { useAuth } from '@/store';
import { space } from '@/theme/tokens';
import { Button, Card, Page, Text, TextField, toast } from '@/ui';
import { CurrencyPicker } from '@/ui';

import { LedgerPageHead } from './LedgerPageHead';
import { MAX_LEDGERS } from './ledgerLimits';
import { useEnterLedger } from './useEnterLedger';

const CARD_MAX_WIDTH = 520;

export default function NewLedgerScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const enterLedger = useEnterLedger();
  const { user } = useAuth();
  const currencies = useCurrencies();
  // 屏幕稿 09 / 13 / 17 read 「CNY 人民币」, not the server's ISO English name.
  const currencyNames = useCurrencyNames(currencies.names);
  const ledgers = useLedgers();
  const create = useCreateLedger({ silent: true });

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm<LedgerCreateFormValues>({
    resolver: zodResolver(ledgerCreateSchema),
    defaultValues: { name: '', base_currency: user?.base_currency ?? '' },
  });

  // The profile may still be loading when the form mounts; fill the default in once.
  const userCurrency = user?.base_currency;
  const currencyTouched = dirtyFields.base_currency === true;
  React.useEffect(() => {
    if (currencyTouched || !userCurrency) return;
    setValue('base_currency', userCurrency);
  }, [currencyTouched, setValue, userCurrency]);

  const atLimit = (ledgers.data?.items.length ?? 0) >= MAX_LEDGERS;

  const onSubmit = React.useCallback(
    (values: LedgerCreateFormValues): void => {
      create.mutate(
        { name: values.name.trim(), base_currency: values.base_currency },
        {
          onSuccess: (ledger) => {
            toast.success(t('ledger:create.success_toast', { name: ledger.name }));
            enterLedger(ledger);
          },
          onError: (err) => toast.error(errorMessage(t, err)),
        },
      );
    },
    [create, enterLedger, t],
  );

  const submit = handleSubmit(onSubmit);
  const blocked = create.isPending || atLimit;
  const title = t('ledger:create.title');
  useTopBar(title);

  return (
    <Page testID="new-ledger-screen" contentStyle={styles.page}>
      <LedgerPageHead title={title} testID="new-ledger-header" />

      <View style={styles.centre}>
        <View style={[styles.column, { maxWidth: CARD_MAX_WIDTH }]}>
          <Text variant="body" tone="muted" style={styles.lead}>
            {t('ledger:create.subtitle')}
          </Text>
          <Card variant="raised" style={styles.card}>
            <Controller
              control={control}
              name="name"
              render={({ field }) => (
                <TextField
                  testID="new-ledger-name"
                  label={t('ledger:create.name_label')}
                  accessibilityLabel={t('ledger:create.name_label')}
                  placeholder={t('ledger:create.name_placeholder')}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  onSubmitEditing={() => void submit()}
                  error={validationMessage(t, errors.name?.message)}
                  disabled={blocked}
                  maxLength={LEDGER_NAME_MAX_LENGTH}
                  showCounter
                  returnKeyType="go"
                />
              )}
            />
            <View style={styles.pickerBlock}>
              <Controller
                control={control}
                name="base_currency"
                render={({ field }) => (
                  <CurrencyPicker
                    testID="new-ledger-currency"
                    label={t('ledger:create.base_currency_label')}
                    codes={currencies.codes}
                    names={currencyNames}
                    value={field.value === '' ? null : field.value}
                    onChange={field.onChange}
                    error={validationMessage(t, errors.base_currency?.message)}
                    disabled={blocked}
                  />
                )}
              />
              <Text variant="caption" tone="muted">
                {t('ledger:create.base_currency_hint')}
              </Text>
            </View>
            {atLimit ? (
              <Text variant="caption" tone="danger" testID="new-ledger-limit">
                {t('ledger:create.limit_reached')}
              </Text>
            ) : null}
            <Button
              testID="new-ledger-submit"
              label={t('ledger:create.submit')}
              size="lg"
              onPress={() => void submit()}
              loading={create.isPending}
              disabled={blocked}
              fullWidth
            />
          </Card>
        </View>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, gap: space['4'] },
  centre: { flex: 1, alignItems: 'center' },
  column: { width: '100%', gap: space['3'] },
  lead: { paddingHorizontal: space['1'] },
  card: { padding: space['5'], gap: space['4'] },
  pickerBlock: { gap: space['1'] },
});
