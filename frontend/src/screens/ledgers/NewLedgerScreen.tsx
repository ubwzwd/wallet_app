/**
 * `/ledgers/new` (04 §4.3): name (1–100, decision §14.13) plus the base currency, which
 * defaults to the user's own `base_currency` (decision §2).
 *
 * `useCreateLedger` already invalidates the ledger list on success, so this screen only
 * has to navigate into the ledger it just made.
 */
import React from 'react';
import { View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';

import { routes } from '@/domain/routes';
import { errorMessage } from '@/i18n/errorCodes';
import { useCreateLedger, useCurrencies, useLedgers } from '@/queries';
import {
  LEDGER_NAME_MAX_LENGTH,
  ledgerCreateSchema,
  type LedgerCreateFormValues,
  validationMessage,
} from '@/screens/auth/schemas';
import { useAuth } from '@/store';
import { space } from '@/theme/tokens';
import { Button, Page, Text, TextField, toast } from '@/ui';
import { CurrencyPicker } from '@/ui/index2';

import { MAX_LEDGERS } from './LedgersScreen';

export default function NewLedgerScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const currencies = useCurrencies();
  const ledgers = useLedgers();
  const create = useCreateLedger();

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
          onSuccess: (ledger) => router.replace(routes.l(ledger.id).home() as Href),
          onError: (err) => toast.error(errorMessage(t, err)),
        },
      );
    },
    [create, router, t],
  );

  const submit = handleSubmit(onSubmit);
  const blocked = create.isPending || atLimit;

  return (
    <Page testID="new-ledger-screen">
      <Text variant="title" accessibilityRole="header">
        {t('ledger:create.title')}
      </Text>
      <View style={{ gap: space['3'], maxWidth: 520, width: '100%' }}>
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <TextField
              testID="new-ledger-name"
              label={t('ledger:create.name_label')}
              accessibilityLabel={t('ledger:create.name_label')}
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
        <Controller
          control={control}
          name="base_currency"
          render={({ field }) => (
            <CurrencyPicker
              testID="new-ledger-currency"
              label={t('ledger:create.base_currency_label')}
              codes={currencies.codes}
              names={currencies.names}
              value={field.value === '' ? null : field.value}
              onChange={field.onChange}
              error={validationMessage(t, errors.base_currency?.message)}
              disabled={blocked}
            />
          )}
        />
        {atLimit ? (
          <Text variant="caption" tone="danger" testID="new-ledger-limit">
            {t('ledger:create.limit_reached')}
          </Text>
        ) : null}
        <Button
          testID="new-ledger-submit"
          label={t('ledger:create.submit')}
          onPress={() => void submit()}
          loading={create.isPending}
          disabled={blocked}
          fullWidth
        />
      </View>
    </Page>
  );
}
