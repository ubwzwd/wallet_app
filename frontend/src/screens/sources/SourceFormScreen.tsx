/**
 * `/accounts/new[?ledger=<id>]` and `/accounts/:sourceId/edit` (04 §4.9, decision §14.62),
 * drawn as 屏幕稿 09 draws it: on wide screens a centred 620-wide dialog card (title + × back
 * to the list, the fields, an action bar) laid over the dimmed account list; on narrow ones
 * the same blocks full-width under the app's top bar.
 *
 * One component for both routes: the presence of the `sourceId` route parameter decides
 * whether it creates or edits. The rules that make this form different from the others:
 *
 *  - `default_currency` is chosen once and then **locked** (decision §14.50): on the edit
 *    screen it is a read-only row and never appears in the PATCH body. A new account starts
 *    in *my* base currency — an account belongs to a person, not a ledger (§14.62).
 *  - a `credit` account's opening balance is typed as a positive "how much I owe" number
 *    and stored negative (decision §14.52 A13) — `openingBalanceForSubmit` /
 *    `openingBalanceForDisplay` own that conversion, and switching the type runs the
 *    stored value through `convertOpeningBalanceOnTypeChange`.
 *  - changing an existing opening balance rewrites every historical balance, so it takes a
 *    confirmation that previews net worth before and after (04 §4.9, §4.7).
 *  - 「共享到」 is one chip per ledger I belong to. `?ledger=<id>` (the home page's 「建第一个
 *    账户」) ticks that ledger up front; on edit the chips start at `shared_to` and their
 *    diff is sent after the PATCH. `useSourceSubmit` owns the requests.
 */
import React from 'react';
import { View } from 'react-native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';

import type { FinanceSource, Ledger, SourceType } from '@/api/types';
import { normalizeAmountInput } from '@/domain/money';
import { routes } from '@/domain/routes';
import { convertOpeningBalanceOnTypeChange, openingBalanceForDisplay } from '@/domain/sources';
import { formatMoney } from '@/i18n/format';
import { useLang } from '@/i18n';
import { useCurrencyNames } from '@/i18n/currencyNames';
import { useTopBar } from '@/navigation';
import { useCurrencies, useLedgers, useMySource, useMySources } from '@/queries';
import { useAuth } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Card, EmptyState, Page, Skeleton, Switch, toast } from '@/ui';
import { useLeaveGuard } from '@/screens/transactions/form/useLeaveGuard';

import { FormDialog } from './FormDialog';
import SourcesScreen from './SourcesScreen';
import { SourceFormFields } from './SourceFormFields';
import { storedValue, valuesOf } from './formValues';
import {
  openingBalanceInput,
  sourceFormSchema,
  trimTrailingZeros,
  type SourceFormValues,
} from './schemas';
import { useArchiveSource } from './useArchiveSource';
import { useSourceSubmit } from './useSourceSubmit';

/** How many currency shortcut chips the mockup puts under the picker. */
const QUICK_CURRENCIES = 3;

const NO_LEDGERS: readonly Ledger[] = [];

/** A route parameter, whichever shape expo-router hands it over in. */
function single(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v !== '' ? v : undefined;
}

export default function SourceFormScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const router = useRouter();
  const wide = useIsWide();
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    sourceId?: string | string[];
    ledger?: string | string[];
  }>();
  const sourceId = single(params.sourceId);
  const presetLedger = single(params.ledger);
  const isEdit = sourceId !== undefined;

  const currencies = useCurrencies();
  // 屏幕稿 09 / 13 / 17 read 「CNY 人民币」, not the server's ISO English name.
  const currencyNames = useCurrencyNames(currencies.names);
  const list = useMySources({ include_archived: true });
  const detail = useMySource(sourceId);
  const ledgers = useLedgers().data?.items ?? NO_LEDGERS;
  const ledgerIds = React.useMemo(() => new Set(ledgers.map((l) => l.id)), [ledgers]);
  // An account is mine, so it starts in — and is previewed in — my base currency.
  const userBase = user?.base_currency ?? '';
  const baseCurrency = list.data?.base_currency ?? userBase;
  const archive = useArchiveSource(sourceId ?? '', baseCurrency);

  const {
    control,
    handleSubmit,
    getValues,
    setValue,
    reset,
    resetField,
    watch,
    formState: { errors, isDirty },
  } = useForm<SourceFormValues>({
    resolver: zodResolver(sourceFormSchema),
    defaultValues: {
      name: '',
      type: 'checking',
      default_currency: isEdit ? '' : userBase,
      opening_balance: '',
      share_to: !isEdit && presetLedger !== undefined ? [presetLedger] : [],
    },
  });

  // `/me` may land after the first frame: fill the default in then, as a *default*, so the
  // untouched form stays clean for the leave guard.
  React.useEffect(() => {
    if (isEdit || userBase === '' || getValues('default_currency') !== '') return;
    resetField('default_currency', { defaultValue: userBase });
  }, [getValues, isEdit, resetField, userBase]);

  // The server row the form was last synchronised with: the source of `updated_at` for the
  // PATCH, and the baseline "what changed?" is measured against.
  const [baseline, setBaseline] = React.useState<FinanceSource | null>(null);
  const server = detail.data;

  React.useEffect(() => {
    if (!isEdit || !server) return;
    if (baseline === null) {
      reset(valuesOf(server));
      setBaseline(server);
      return;
    }
    if (server.updated_at === baseline.updated_at) return;
    // 04 §3.8 step 3: someone else changed the row (the 409 handler refetched it). Take the
    // server's values for every field the user hasn't touched, keep the ones they have, and
    // never resend on their behalf.
    reset(valuesOf(server), { keepDirtyValues: true });
    setBaseline(server);
  }, [baseline, isEdit, reset, server]);

  const type = watch('type');
  const name = watch('name');
  const currency = watch('default_currency') || baseCurrency;

  /** Switching the type moves the stored value across the credit sign boundary
   *  (decision §14.52 A13) and says so. */
  const onTypeChange = React.useCallback(
    (next: SourceType): void => {
      const from = getValues('type');
      setValue('type', next, { shouldDirty: true });
      if (from === next) return;
      const raw = getValues('opening_balance');
      if (raw.trim() === '' || normalizeAmountInput(openingBalanceInput(raw)) === null) return;
      const converted = convertOpeningBalanceOnTypeChange(storedValue(raw, from), from, next);
      const shown = trimTrailingZeros(openingBalanceForDisplay(converted, next));
      setValue('opening_balance', shown, { shouldDirty: true });
      if ((from === 'credit') !== (next === 'credit')) {
        toast.info(
          t('source:form.type_change_converted', {
            amount: formatMoney(converted, getValues('default_currency') || baseCurrency, lang),
          }),
        );
      }
    },
    [baseCurrency, getValues, lang, setValue, t],
  );

  /** Another of my accounts already carries this name — allowed, so only a hint (01-6). */
  const duplicateName = React.useMemo(() => {
    const trimmed = name.trim().toLowerCase();
    if (trimmed === '') return false;
    return (list.data?.items ?? []).some(
      (s) => s.id !== sourceId && s.name.trim().toLowerCase() === trimmed,
    );
  }, [list.data, name, sourceId]);

  /** The chips over the picker: my own currency first, then the ones my other accounts
   *  already use (屏幕稿 09 draws three). */
  const quickCurrencies = React.useMemo(() => {
    const seen = [baseCurrency, ...(list.data?.items ?? []).map((s) => s.default_currency)];
    return Array.from(new Set(seen.filter((c) => c !== ''))).slice(0, QUICK_CURRENCIES);
  }, [baseCurrency, list.data]);

  const goBack = React.useCallback(
    () => router.replace(routes.accounts() as Href),
    [router],
  );

  // The guard is created after the submit hook (it needs `busy`), so "saved — leave" reaches
  // it through a ref.
  const savedRef = React.useRef<() => void>(() => undefined);
  const onSaved = React.useCallback(() => savedRef.current(), []);
  const saver = useSourceSubmit({
    sourceId,
    baseline,
    ledgerIds,
    baseCurrency,
    netWorth: list.data?.net_worth ?? null,
    onSaved,
  });

  // Half-typed changes are asked about on every way out (04 §4.6.5, decision §14.65 g):
  // 取消 and × here, the shell's ‹ and chrome through the guard's registration.
  const busy = saver.busy;
  const leave = useLeaveGuard(isDirty && !busy);
  const onCancel = React.useCallback((): void => {
    void leave.confirmLeave().then((ok) => {
      if (!ok) return;
      leave.allowLeave();
      goBack();
    });
  }, [goBack, leave]);
  savedRef.current = () => {
    leave.allowLeave();
    goBack();
  };

  const submit = handleSubmit((values) => void saver.submit(values));
  const title = isEdit ? t('source:form.edit_title') : t('source:form.new_title');
  // 04 §1.4: the narrow layout's top bar carries the title, so the page does not repeat it.
  useTopBar(title);

  if (isEdit && detail.isPending) {
    return (
      <Page testID="source-form-screen">
        <Skeleton variant="card" testID="source-form-skeleton" />
      </Page>
    );
  }

  if (isEdit && detail.isError) {
    return (
      <Page testID="source-form-screen">
        <EmptyState
          icon="alert-triangle"
          title={t('source:form.load_error')}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void detail.refetch() }}
          testID="source-form-error"
        />
      </Page>
    );
  }

  const fields = (
    <SourceFormFields
      control={control}
      errors={errors}
      isEdit={isEdit}
      busy={busy}
      wide={wide}
      type={type}
      onTypeChange={onTypeChange}
      duplicateName={duplicateName}
      currencyCodes={currencies.codes}
      currencyNames={currencyNames}
      currency={currency}
      quickCurrencies={quickCurrencies}
      ledgers={ledgers}
      archivedSwitch={
        isEdit && baseline ? (
          <Switch
            testID="source-archived"
            label={t('source:form.archived_toggle')}
            accessibilityLabel={t('source:form.archived_toggle')}
            value={server?.archived ?? baseline.archived}
            disabled={archive.pending}
            onChange={(next) => {
              void archive.setArchived(server ?? baseline, next);
            }}
          />
        ) : undefined
      }
    />
  );

  const actions = (
    <>
      <Button
        testID="source-cancel"
        label={t('common:button.cancel')}
        variant="soft"
        onPress={onCancel}
        disabled={busy}
        style={wide ? undefined : { flex: 1 }}
      />
      <Button
        testID="source-submit"
        label={isEdit ? t('source:form.submit_save') : t('source:form.submit_create')}
        onPress={() => void submit()}
        loading={busy}
        disabled={busy}
        style={wide ? undefined : { flex: 1.6 }}
      />
    </>
  );

  if (!wide) {
    return (
      <Page testID="source-form-screen">
        <Card variant="raised" style={{ padding: space['4'] }}>
          {fields}
        </Card>
        <View style={{ flexDirection: 'row', gap: space['2'] + 2 }}>{actions}</View>
      </Page>
    );
  }

  // 屏幕稿 09 draws the wide form as a modal over the dimmed account list, not as a page
  // of its own; `FormDialog` owns that overlay and takes the list behind as a prop.
  return (
    <View style={{ flex: 1 }} testID="source-form-screen">
      <FormDialog
        testID="source-form"
        title={title}
        closeLabel={t('source:form.close_label')}
        onClose={onCancel}
        actions={actions}
        behind={<SourcesScreen />}
      >
        {fields}
      </FormDialog>
    </View>
  );
}
