/**
 * `/l/:ledgerId/sources/new` and `/l/:ledgerId/sources/:sourceId/edit` (04 §4.9).
 *
 * One component for both: the presence of the `sourceId` route parameter decides whether
 * it creates or edits. Three rules make this form different from the others:
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
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';

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
import { useCreateSource, useCurrencies, useSource, useSources, useUpdateSource } from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import {
  AmountField,
  Button,
  CurrencyPicker,
  EmptyState,
  Page,
  SegmentedControl,
  Skeleton,
  Switch,
  Text,
  TextField,
  confirm,
  toast,
} from '@/ui';
import { SOURCE_TYPE_ICON } from '@/ui';

import {
  SOURCE_NAME_MAX_LENGTH,
  SOURCE_TYPES,
  openingBalanceInput,
  sourceFormSchema,
  sourceValidationMessage,
  trimTrailingZeros,
  type SourceFormValues,
} from './schemas';
import { useArchiveSource } from './useArchiveSource';

/** `'0.0000'` — what an empty opening-balance field submits (decision §3). */
const ZERO: Money = '0.0000';

function valuesOf(source: FinanceSource): SourceFormValues {
  return {
    name: source.name,
    type: source.type,
    default_currency: source.default_currency,
    opening_balance: trimTrailingZeros(
      openingBalanceForDisplay(source.opening_balance, source.type),
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
  const { ledgerId, baseCurrency } = useLedgerContext();
  const params = useLocalSearchParams<{ sourceId?: string | string[] }>();
  const sourceId = Array.isArray(params.sourceId) ? params.sourceId[0] : params.sourceId;
  const isEdit = typeof sourceId === 'string' && sourceId !== '';

  const currencies = useCurrencies();
  const list = useSources(ledgerId, { include_archived: true });
  const detail = useSource(ledgerId, isEdit ? sourceId : undefined);
  const create = useCreateSource(ledgerId, { silent: true });
  const update = useUpdateSource(ledgerId, isEdit ? sourceId : '', { silent: true });
  const archive = useArchiveSource(ledgerId, isEdit ? sourceId : '');

  const {
    control,
    handleSubmit,
    getValues,
    setValue,
    reset,
    watch,
    formState: { errors },
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

  /** "Net worth ¥52,300 → ¥49,096" for the opening-balance confirmation (04 §4.9). */
  const netWorthPreview = React.useCallback(
    (source: FinanceSource, nextStored: Money): { from: string; to: string } => {
      const before = sumSources(list.data?.items ?? []).net;
      const delta = toBase(subMoney(nextStored, source.opening_balance), source, baseCurrency);
      return {
        from: formatMoney(before, baseCurrency, lang),
        to: formatMoney(addMoney(before, delta), baseCurrency, lang),
      };
    },
    [baseCurrency, lang, list.data],
  );

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
              router.replace(routes.l(ledgerId).sources() as Href);
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
      const openingChanged = parseMoney(stored) !== parseMoney(current.opening_balance);
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
          router.replace(routes.l(ledgerId).sources() as Href);
        },
        onError: (e) => {
          // A 409 `stale_update` is the global handler's business (04 §3.8): it has already
          // refetched the row and warned; the effect above merges it into the form.
          if (
            e &&
            typeof e === 'object' &&
            (e as { code?: unknown }).code === 'stale_update'
          ) {
            return;
          }
          toast.error(errorMessage(t, e));
        },
      });
    },
    [baseline, create, isEdit, ledgerId, netWorthPreview, router, t, update],
  );

  const submit = handleSubmit((values) => void onSubmit(values));
  const busy = create.isPending || update.isPending;
  const title = isEdit ? t('source:form.edit_title') : t('source:form.new_title');

  if (isEdit && detail.isPending) {
    return (
      <Page testID="source-form-screen">
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        <Skeleton variant="card" testID="source-form-skeleton" />
      </Page>
    );
  }

  if (isEdit && detail.isError) {
    return (
      <Page testID="source-form-screen">
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        <EmptyState
          icon="alert-triangle"
          title={t('source:form.load_error')}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void detail.refetch() }}
          testID="source-form-error"
        />
      </Page>
    );
  }

  const isCredit = type === 'credit';

  return (
    <Page testID="source-form-screen">
      <Text variant="title" accessibilityRole="header">
        {title}
      </Text>
      <View style={{ gap: space['3'], maxWidth: 520, width: '100%' }}>
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <TextField
              testID="source-name"
              label={t('source:form.name_label')}
              accessibilityLabel={t('source:form.name_label')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={sourceValidationMessage(t, errors.name?.message)}
              hint={duplicateName ? t('source:form.name_duplicate_hint') : undefined}
              disabled={busy}
              maxLength={SOURCE_NAME_MAX_LENGTH}
              showCounter
            />
          )}
        />

        <View style={{ gap: space['2'] }}>
          <Text variant="caption" tone="secondary">
            {t('source:form.type_label')}
          </Text>
          <SegmentedControl<SourceType>
            testID="source-type"
            accessibilityLabel={t('source:form.type_label')}
            value={type}
            onChange={onTypeChange}
            options={SOURCE_TYPES.map((value) => ({
              value,
              label: t(`source:type.${value}`),
              icon: SOURCE_TYPE_ICON[value],
              disabled: busy,
            }))}
          />
        </View>

        <Controller
          control={control}
          name="default_currency"
          render={({ field }) => (
            <View style={{ gap: space['1'] }}>
              {isEdit ? (
                <Text variant="caption" tone="secondary">
                  {t('source:form.currency_label')}
                </Text>
              ) : null}
              <CurrencyPicker
                testID="source-currency"
                label={t('source:form.currency_label')}
                codes={currencies.codes}
                names={currencies.names}
                value={field.value === '' ? null : field.value}
                onChange={field.onChange}
                readOnly={isEdit}
                error={sourceValidationMessage(t, errors.default_currency?.message)}
                disabled={busy}
              />
              {isEdit ? (
                <Text variant="caption" tone="muted" testID="source-currency-locked">
                  {t('source:form.currency_locked_hint')}
                </Text>
              ) : null}
            </View>
          )}
        />

        <Controller
          control={control}
          name="opening_balance"
          render={({ field }) => (
            <View style={{ gap: space['1'] }}>
              <AmountField
                testID="source-opening-balance"
                label={
                  isCredit
                    ? t('source:form.credit_debt_label')
                    : t('source:form.opening_balance_label')
                }
                value={field.value}
                onChange={field.onChange}
                currency={watch('default_currency') || baseCurrency}
                hint={isCredit ? t('source:form.credit_debt_hint') : undefined}
                error={sourceValidationMessage(t, errors.opening_balance?.message)}
                disabled={busy}
              />
              <Text variant="caption" tone="muted" testID="source-opening-balance-hint">
                {t('source:form.opening_balance_hint')}
              </Text>
            </View>
          )}
        />

        {isEdit && baseline ? (
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
        ) : null}

        <Button
          testID="source-submit"
          label={isEdit ? t('source:form.submit_save') : t('source:form.submit_create')}
          onPress={() => void submit()}
          loading={busy}
          disabled={busy}
          fullWidth
        />
      </View>
    </Page>
  );
}
