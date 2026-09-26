/**
 * `/l/:ledgerId/sources/new` and `/l/:ledgerId/sources/:sourceId/edit` (04 §4.9), drawn as
 * 屏幕稿 09 draws it: on wide screens a centred 620-wide dialog card (title + × back to the
 * list, the fields, an action bar) laid over the dimmed account list; on narrow ones the
 * same blocks full-width under the app's top bar.
 *
 * One component for both routes: the presence of the `sourceId` route parameter decides
 * whether it creates or edits. Three rules make this form different from the others:
 *
 *  - `default_currency` is chosen once and then **locked** (decision §14.50): on the edit
 *    screen it is a read-only row and never appears in the PATCH body.
 *  - a `credit` account's opening balance is typed as a positive "how much I owe" number
 *    and stored negative (decision §14.52 A13) — `openingBalanceForSubmit` /
 *    `openingBalanceForDisplay` own that conversion, and switching the type runs the
 *    stored value through `convertOpeningBalanceOnTypeChange`.
 *  - changing an existing opening balance rewrites every historical balance, so it takes a
 *    confirmation that previews net worth before and after (04 §4.9, §4.7).
 */
import React from 'react';
import { View } from 'react-native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';

import { isApiClientError } from '@/api/errors';
import type { FinanceSource, FinanceSourceUpdate, Money, SourceType } from '@/api/types';
import { addMoney, formatMoney4, normalizeAmountInput, parseMoney, subMoney } from '@/domain/money';
import { sumSources } from '@/domain/networth';
import { routes } from '@/domain/routes';
import {
  convertOpeningBalanceOnTypeChange,
  openingBalanceForDisplay,
  openingBalanceForSubmit,
} from '@/domain/sources';
import { errorMessage } from '@/i18n/errorCodes';
import { formatMoney } from '@/i18n/format';
import { useLang } from '@/i18n';
import { useCurrencyNames } from '@/i18n/currencyNames';
import { useTopBar } from '@/navigation';
import { useCreateSource, useCurrencies, useMySource, useMySources, useUpdateSource } from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Card, EmptyState, Page, Skeleton, Switch, confirm, toast } from '@/ui';
import { useLeaveGuard } from '@/screens/transactions/form/useLeaveGuard';

import { FormDialog } from './FormDialog';
import SourcesScreen from './SourcesScreen';
import { SourceFormFields } from './SourceFormFields';
import {
  openingBalanceInput,
  sourceFormSchema,
  trimTrailingZeros,
  type SourceFormValues,
} from './schemas';
import { useArchiveSource } from './useArchiveSource';

/** `'0.0000'` — what an empty opening-balance field submits (decision §3). */
const ZERO: Money = '0.0000';

/** How many currency shortcut chips the mockup puts under the picker. */
const QUICK_CURRENCIES = 3;

function valuesOf(source: FinanceSource): SourceFormValues {
  return {
    name: source.name,
    type: source.type,
    default_currency: source.default_currency,
    opening_balance: trimTrailingZeros(
      openingBalanceForDisplay(source.opening_balance ?? ZERO, source.type),
    ),
  };
}

/** The stored (signed) money a raw field value plus a type submit as. */
function storedValue(raw: string, type: SourceType): Money {
  return openingBalanceForSubmit(openingBalanceInput(raw), type) ?? ZERO;
}

/**
 * A delta in the account's own currency, expressed in the ledger's base currency, using
 * the same rate the balance was converted with. Without a rate there is nothing to show,
 * so the preview falls back to "no change" rather than inventing a number.
 */
function toBase(delta: Money, source: FinanceSource, baseCurrency: string): Money {
  if (source.default_currency === baseCurrency) return delta;
  if (source.balance_rate === null) return ZERO;
  return formatMoney4(BigInt(Math.round(Number(parseMoney(delta)) * Number(source.balance_rate))));
}

export default function SourceFormScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const router = useRouter();
  const wide = useIsWide();
  const { ledgerId, baseCurrency } = useLedgerContext();
  const params = useLocalSearchParams<{ sourceId?: string | string[] }>();
  const sourceId = Array.isArray(params.sourceId) ? params.sourceId[0] : params.sourceId;
  const isEdit = typeof sourceId === 'string' && sourceId !== '';

  const currencies = useCurrencies();
  // 屏幕稿 09 / 13 / 17 read 「CNY 人民币」, not the server's ISO English name.
  const currencyNames = useCurrencyNames(currencies.names);
  const list = useMySources({ include_archived: true });
  const detail = useMySource(isEdit ? sourceId : undefined);
  const create = useCreateSource({ silent: true });
  const update = useUpdateSource(isEdit ? sourceId : '', { silent: true });
  const archive = useArchiveSource(ledgerId, isEdit ? sourceId : '');

  const {
    control,
    handleSubmit,
    getValues,
    setValue,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<SourceFormValues>({
    resolver: zodResolver(sourceFormSchema),
    defaultValues: {
      name: '',
      type: 'checking',
      default_currency: isEdit ? '' : baseCurrency,
      opening_balance: '',
    },
  });

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

  /** Another account already carries this name — allowed, so it's only a hint (01-6). */
  const duplicateName = React.useMemo(() => {
    const trimmed = name.trim().toLowerCase();
    if (trimmed === '') return false;
    return (list.data?.items ?? []).some(
      (s) => s.id !== sourceId && s.name.trim().toLowerCase() === trimmed,
    );
  }, [list.data, name, sourceId]);

  /** The chips over the picker: the ledger's own currency first, then the ones its other
   *  accounts already use (屏幕稿 09 draws three). */
  const quickCurrencies = React.useMemo(() => {
    const seen = [baseCurrency, ...(list.data?.items ?? []).map((s) => s.default_currency)];
    return Array.from(new Set(seen)).slice(0, QUICK_CURRENCIES);
  }, [baseCurrency, list.data]);

  /** "Net worth ¥52,300 → ¥49,096" for the opening-balance confirmation (04 §4.9). */
  const netWorthPreview = React.useCallback(
    (source: FinanceSource, nextStored: Money): { from: string; to: string } => {
      const before = sumSources(list.data?.items ?? []).net;
      const delta = toBase(subMoney(nextStored, source.opening_balance ?? ZERO), source, baseCurrency);
      return {
        from: formatMoney(before, baseCurrency, lang),
        to: formatMoney(addMoney(before, delta), baseCurrency, lang),
      };
    },
    [baseCurrency, lang, list.data],
  );

  const goBack = React.useCallback(
    () => router.replace(routes.accounts() as Href),
    [router],
  );

  // Half-typed changes are asked about on every way out (04 §4.6.5, decision §14.65 g):
  // 取消 and × here, the shell's ‹ and chrome through the guard's registration.
  const busy = create.isPending || update.isPending;
  const leave = useLeaveGuard(isDirty && !busy);
  const onCancel = React.useCallback((): void => {
    void leave.confirmLeave().then((ok) => {
      if (!ok) return;
      leave.allowLeave();
      goBack();
    });
  }, [goBack, leave]);
  const leaveSaved = React.useCallback((): void => {
    leave.allowLeave();
    goBack();
  }, [goBack, leave]);

  const onSubmit = React.useCallback(
    async (values: SourceFormValues): Promise<void> => {
      const stored = storedValue(values.opening_balance, values.type);

      if (!isEdit) {
        create.mutate(
          {
            name: values.name.trim(),
            type: values.type,
            default_currency: values.default_currency,
            opening_balance: stored,
          },
          {
            onSuccess: (source) => {
              toast.success(t('source:form.created_toast', { name: source.name }));
              leaveSaved();
            },
            onError: (e) => toast.error(errorMessage(t, e)),
          },
        );
        return;
      }

      const current = baseline;
      if (!current) return;

      const body: FinanceSourceUpdate = { updated_at: current.updated_at };
      if (values.name.trim() !== current.name) body.name = values.name.trim();
      if (values.type !== current.type) body.type = values.type;
      const openingChanged = parseMoney(stored) !== parseMoney(current.opening_balance ?? ZERO);
      if (openingChanged) body.opening_balance = stored;

      if (openingChanged) {
        const preview = netWorthPreview(current, stored);
        const ok = await confirm({
          title: t('source:form.opening_balance_change_title'),
          body: `${t('source:form.net_worth_preview', preview)}\n${t(
            'source:form.opening_balance_change_confirm',
          )}`,
          confirmLabel: t('common:button.save'),
          tone: 'danger',
        });
        if (!ok) return;
      }

      update.mutate(body, {
        onSuccess: (source) => {
          toast.success(t('source:form.saved_toast', { name: source.name }));
          leaveSaved();
        },
        onError: (e) => {
          // A 409 `stale_update` is the global handler's business (04 §3.8): it has already
          // refetched the row and warned; the effect above merges it into the form.
          if (isApiClientError(e) && e.code === 'stale_update') return;
          toast.error(errorMessage(t, e));
        },
      });
    },
    [baseline, create, isEdit, leaveSaved, netWorthPreview, t, update],
  );

  const submit = handleSubmit((values) => void onSubmit(values));
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
