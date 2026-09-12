/**
 * The transaction list's filter bar (04 §4.5).
 *
 * One set of controls, two placements: always on screen above the list on a wide layout,
 * behind a "筛选" button with a count badge in a `Sheet` on a narrow one. The split is by
 * viewport width (`useIsWide`), never by platform. Every control writes to the URL;
 * nothing here keeps a copy of the filter state — except the two amount boxes, which
 * commit on blur so a half-typed `12.` is not parsed as a filter.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { FinanceSource, TransactionListParams, TxKind, Uuid } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import { dateRangePreset } from '@/domain/dates';
import { filterChips, type FilterChip as DomainFilterChip } from '@/domain/filters';
import { KINDS } from '@/domain/kinds';
import { categoryName } from '@/i18n/category';
import { type Lang } from '@/i18n';
import { formatAmountPlain, formatDate } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  Button,
  Chip,
  DateField,
  FilterChips,
  MultiSelect,
  Select,
  Sheet,
  Text,
  TextField,
  type SelectOption,
} from '@/ui';

/** Everything the chip / suggestion labels need to turn a raw query value into words. */
export interface FilterLabelCtx {
  t: TFunction;
  lang: Lang;
  index: CategoryIndex | null;
  sourceName(id: Uuid): string;
  baseCurrency: string;
}

/** One active condition, rendered the way a person would say it (04 §4.5). */
export function filterChipLabel(chip: DomainFilterChip, ctx: FilterLabelCtx): string {
  const { t, lang } = ctx;
  switch (chip.key) {
    case 'q':
      return t('transaction:list.chip.q', { value: chip.value });
    case 'kind':
      return t('transaction:list.chip.kind', { value: t(`transaction:kind.${chip.value}`) });
    case 'source_id':
      return t('transaction:list.chip.source', { value: ctx.sourceName(chip.value) });
    case 'category_l1':
    case 'category_l2': {
      const category = ctx.index?.byCode[chip.value];
      return t('transaction:list.chip.category', {
        value: category ? categoryName(category, lang) : chip.value,
      });
    }
    case 'from':
      return t('transaction:list.chip.from', { value: formatDate(chip.value, lang) });
    case 'to':
      return t('transaction:list.chip.to', { value: formatDate(chip.value, lang) });
    case 'currency':
      return t('transaction:list.chip.currency', { value: chip.value });
    case 'min_amount':
      return t('transaction:list.chip.min_amount', {
        value: formatAmountPlain(chip.value, ctx.baseCurrency),
      });
    case 'max_amount':
      return t('transaction:list.chip.max_amount', {
        value: formatAmountPlain(chip.value, ctx.baseCurrency),
      });
    case 'import_batch_id':
      // Decision §14.46 (04-D-7): the batch is identified by its short number, not a UUID.
      return t('transaction:list.chip.from_batch', { batch: chip.value.slice(0, 6) });
    default:
      return chip.value;
  }
}

/**
 * Which category tree the level-1 column may offer (decision §1.3): the income tree only
 * when the kind filter says income and nothing else; the expense tree otherwise, which is
 * also what "no kind filter at all" gets.
 */
export function categoryKindOf(kinds: readonly TxKind[] | undefined): TxKind {
  if (kinds && kinds.length > 0 && kinds.every((k) => k === 'income')) return 'income';
  return 'expense';
}

type DatePreset = 'this_month' | 'last_month' | 'last_3_months' | 'this_year';
const DATE_PRESETS: readonly DatePreset[] = [
  'this_month',
  'last_month',
  'last_3_months',
  'this_year',
];

export interface FilterBarProps {
  filters: TransactionListParams;
  activeCount: number;
  qDraft: string;
  onQChange(value: string): void;
  onPatch(next: Partial<TransactionListParams>): void;
  onRemove(key: keyof TransactionListParams, value?: string): void;
  onClear(): void;
  sources: readonly FinanceSource[];
  index: CategoryIndex | null;
  currencyCodes: readonly string[];
  currencyNames?: Readonly<Record<string, string>>;
  baseCurrency: string;
  lang: Lang;
  testID?: string;
}

export function FilterBar(props: FilterBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const wide = useIsWide();
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const id = props.testID ?? 'tx-filter-bar';

  const sourceName = React.useCallback(
    (sid: Uuid): string => props.sources.find((s) => s.id === sid)?.name ?? sid.slice(0, 6),
    [props.sources],
  );

  const labelCtx: FilterLabelCtx = {
    t,
    lang: props.lang,
    index: props.index,
    sourceName,
    baseCurrency: props.baseCurrency,
  };

  const chips = filterChips(props.filters).map((chip) => ({
    key: chip.key as string,
    value: chip.value,
    label: filterChipLabel(chip, labelCtx),
  }));

  const controls = (
    <FilterControls
      {...props}
      onCloseSheet={() => setSheetOpen(false)}
      inSheet={!wide}
      testID={id}
    />
  );

  return (
    <View testID={id} style={{ gap: space['3'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space['2'] }}>
        <View style={{ flex: 1 }}>
          <TextField
            value={props.qDraft}
            onChangeText={props.onQChange}
            placeholder={t('transaction:list.filter.search_placeholder')}
            accessibilityLabel={t('transaction:list.filter.search_placeholder')}
            testID={`${id}-q`}
          />
        </View>
        {wide ? null : (
          <Button
            variant="secondary"
            icon="filter"
            label={
              props.activeCount > 0
                ? `${t('transaction:list.filter.open')} · ${props.activeCount}`
                : t('transaction:list.filter.open')
            }
            onPress={() => setSheetOpen(true)}
            testID={`${id}-open`}
          />
        )}
      </View>

      {wide ? (
        controls
      ) : (
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={t('transaction:list.filter.title')}
          closeLabel={t('common:button.close')}
          testID={`${id}-sheet`}
        >
          {controls}
        </Sheet>
      )}

      <FilterChips
        chips={chips}
        clearFrom={1}
        onRemove={(key, value) => props.onRemove(key as keyof TransactionListParams, value)}
        onClear={props.onClear}
        testID={`${id}-chips`}
      />
    </View>
  );
}

// --------------------------------------------------------------------- controls

interface FilterControlsProps extends FilterBarProps {
  inSheet: boolean;
  onCloseSheet(): void;
}

function FilterControls(props: FilterControlsProps): React.JSX.Element {
  const { t } = useTranslation();
  const { filters, onPatch, index, sources } = props;
  const id = props.testID ?? 'tx-filter-bar';

  const kinds = filters.kind ?? [];
  const categoryKind = categoryKindOf(kinds);

  const l1Options: SelectOption[] = (index?.kindAllows(categoryKind) ?? []).map((c) => ({
    value: c.code,
    label: categoryName(c, props.lang),
  }));
  const l2Options: SelectOption[] = (
    filters.category_l1 ? (index?.l2Of(filters.category_l1) ?? []) : []
  ).map((c) => ({ value: c.code, label: categoryName(c, props.lang) }));

  const sourceOptions: SelectOption[] = sources.map((s) => ({
    value: s.id,
    label: s.name,
    hint: s.default_currency,
  }));

  const currencyOptions: SelectOption[] = props.currencyCodes.map((code) => ({
    value: code,
    label: code,
    hint: props.currencyNames?.[code],
  }));

  // The amount boxes keep a draft: a filter must not be rebuilt (and refetched) on every
  // keystroke, and "12." is not a number yet.
  const [minDraft, setMinDraft] = React.useState(
    filters.min_amount === undefined ? '' : String(filters.min_amount),
  );
  const [maxDraft, setMaxDraft] = React.useState(
    filters.max_amount === undefined ? '' : String(filters.max_amount),
  );
  React.useEffect(() => {
    setMinDraft(filters.min_amount === undefined ? '' : String(filters.min_amount));
  }, [filters.min_amount]);
  React.useEffect(() => {
    setMaxDraft(filters.max_amount === undefined ? '' : String(filters.max_amount));
  }, [filters.max_amount]);

  const commitAmount = (which: 'min_amount' | 'max_amount', raw: string): void => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      if (filters[which] !== undefined) onPatch({ [which]: undefined });
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return;
    if (filters[which] === value) return;
    onPatch({ [which]: value });
  };

  function toggleKind(kind: TxKind): void {
    const next = kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind];
    // Switching to an income-only filter would leave an expense category behind, which
    // can never match anything (decision §1.3).
    const nextCategoryKind = categoryKindOf(next);
    const keepCategory = nextCategoryKind === categoryKind;
    onPatch({
      kind: next.length > 0 ? next : undefined,
      category_l1: keepCategory ? filters.category_l1 : undefined,
      category_l2: keepCategory ? filters.category_l2 : undefined,
    });
  }

  return (
    <View testID={`${id}-controls`} style={{ gap: space['4'] }}>
      <Field label={t('transaction:list.filter.kind_label')} hint={t('transaction:list.filter.kind_hint')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] }}>
          {KINDS.map((kind) => (
            <Chip
              key={kind}
              label={t(`transaction:kind.${kind}`)}
              selected={kinds.includes(kind)}
              onPress={() => toggleKind(kind)}
              testID={`${id}-kind-${kind}`}
            />
          ))}
        </View>
      </Field>

      <MultiSelect
        label={t('transaction:list.filter.source_label')}
        placeholder={t('transaction:list.filter.source_placeholder')}
        closeLabel={t('common:button.close')}
        options={sourceOptions}
        values={filters.source_id ?? []}
        selectedLabel={(count) => t('transaction:list.filter.source_selected', { count })}
        onChange={(next) => onPatch({ source_id: next.length > 0 ? next : undefined })}
        searchable
        testID={`${id}-source`}
      />

      <Field label={t('transaction:list.filter.date_range_label')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] }}>
          {DATE_PRESETS.map((preset) => (
            <Chip
              key={preset}
              label={t(`transaction:list.filter.date_preset.${preset}`)}
              onPress={() => onPatch(dateRangePreset(preset))}
              testID={`${id}-date-${preset}`}
            />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: space['2'] }}>
          <View style={{ flex: 1 }}>
            <DateField
              label={t('transaction:list.filter.date_from')}
              value={filters.from ?? ''}
              onChange={(next) => onPatch({ from: next === '' ? undefined : next })}
              testID={`${id}-from`}
            />
          </View>
          <View style={{ flex: 1 }}>
            <DateField
              label={t('transaction:list.filter.date_to')}
              value={filters.to ?? ''}
              onChange={(next) => onPatch({ to: next === '' ? undefined : next })}
              testID={`${id}-to`}
            />
          </View>
        </View>
      </Field>

      <Field label={t('transaction:list.filter.category_label')}>
        <Select
          label={t('transaction:form.category_l1')}
          placeholder={t('transaction:list.filter.category_l1_placeholder')}
          closeLabel={t('common:button.close')}
          options={l1Options}
          value={filters.category_l1 ?? null}
          onChange={(next) =>
            onPatch({ category_l1: next ?? undefined, category_l2: undefined })
          }
          searchable
          testID={`${id}-category-l1`}
        />
        <Select
          label={t('transaction:form.category_l2')}
          placeholder={t('transaction:list.filter.category_l2_placeholder')}
          closeLabel={t('common:button.close')}
          options={l2Options}
          value={filters.category_l2 ?? null}
          disabled={l2Options.length === 0}
          onChange={(next) => onPatch({ category_l2: next ?? undefined })}
          testID={`${id}-category-l2`}
        />
      </Field>

      <Field
        label={t('transaction:list.filter.amount_range_label')}
        hint={t('transaction:list.filter.amount_range_hint', { currency: props.baseCurrency })}
      >
        <View style={{ flexDirection: 'row', gap: space['2'] }}>
          <View style={{ flex: 1 }}>
            <TextField
              value={minDraft}
              onChangeText={setMinDraft}
              onBlur={() => commitAmount('min_amount', minDraft)}
              onSubmitEditing={() => commitAmount('min_amount', minDraft)}
              placeholder={t('transaction:list.filter.amount_min_placeholder')}
              accessibilityLabel={t('transaction:list.filter.amount_min_placeholder')}
              keyboardType="decimal-pad"
              inputMode="decimal"
              mono
              testID={`${id}-min-amount`}
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              value={maxDraft}
              onChangeText={setMaxDraft}
              onBlur={() => commitAmount('max_amount', maxDraft)}
              onSubmitEditing={() => commitAmount('max_amount', maxDraft)}
              placeholder={t('transaction:list.filter.amount_max_placeholder')}
              accessibilityLabel={t('transaction:list.filter.amount_max_placeholder')}
              keyboardType="decimal-pad"
              inputMode="decimal"
              mono
              testID={`${id}-max-amount`}
            />
          </View>
        </View>
      </Field>

      <Select
        label={t('transaction:list.filter.currency_label')}
        placeholder={t('transaction:list.filter.currency_placeholder')}
        closeLabel={t('common:button.close')}
        options={currencyOptions}
        value={filters.currency ?? null}
        onChange={(next) => onPatch({ currency: next ?? undefined })}
        searchable
        testID={`${id}-currency`}
      />

      <View style={{ flexDirection: 'row', gap: space['2'], flexWrap: 'wrap' }}>
        <Button
          variant="ghost"
          label={t('transaction:list.filter.clear_filters')}
          onPress={props.onClear}
          testID={`${id}-reset`}
        />
        {props.inSheet ? (
          <Button
            label={t('transaction:list.filter.done')}
            onPress={props.onCloseSheet}
            testID={`${id}-done`}
          />
        ) : null}
      </View>
    </View>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={{ gap: space['2'] }}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      {children}
      {hint ? (
        <Text variant="micro" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
