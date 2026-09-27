/**
 * The transaction list's filter fields (屏幕稿 02).
 *
 * One set of controls, two frames: `FilterBar` lays them out as the three-column grid of
 * the wide 「筛选」 card, `FilterSheet` stacks them in a bottom sheet. Every control writes
 * straight to the filter state — nothing here keeps a copy of it except the two
 * amount boxes, which commit on blur so a half-typed `12.` is not parsed as a filter.
 * Neither the category selects nor the account list carries a search box (decision §14.57
 * and 屏幕稿 02: the lists are short enough to read at a glance).
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { LedgerSource, TransactionListParams, TxKind } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import { dateRangePreset } from '@/domain/dates';
import { KINDS } from '@/domain/kinds';
import { categoryName } from '@/i18n/category';
import { type Lang } from '@/i18n';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Chip, DateField, Icon, KIND_ICON, Select, Text, TextField, type SelectOption } from '@/ui';

export type DatePreset = 'this_month' | 'last_month' | 'last_3_months' | 'this_year';
export const DATE_PRESETS: readonly DatePreset[] = [
  'this_month',
  'last_month',
  'last_3_months',
  'this_year',
];

/**
 * Which category tree the level-1 column may offer (decision §1.3): the income tree only
 * when the kind filter says income and nothing else; the expense tree otherwise, which is
 * also what "no kind filter at all" gets.
 */
export function categoryKindOf(kinds: readonly TxKind[] | undefined): TxKind {
  if (kinds && kinds.length > 0 && kinds.every((k) => k === 'income')) return 'income';
  return 'expense';
}

/** Everything every field below needs; the caller (`FilterBar`) owns all of it. */
export interface FilterFieldProps {
  filters: TransactionListParams;
  onPatch(next: Partial<TransactionListParams>): void;
  index: CategoryIndex | null;
  sources: readonly LedgerSource[];
  currencyCodes: readonly string[];
  baseCurrency: string;
  lang: Lang;
  /** testID prefix, e.g. `tx-filter-bar`. */
  id: string;
}

/** 屏幕稿 02: a 12/600 label, an optional mono hint next to it, then the control. */
export function FilterField({
  label,
  hint,
  action,
  children,
}: {
  label: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={{ gap: space['2'] - 2 }}>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'], flexWrap: 'wrap' }}
      >
        <Text variant="caption" tone="secondary" weight={600}>
          {label}
        </Text>
        {hint !== undefined ? (
          <Text variant="micro" tone="muted" mono>
            {hint}
          </Text>
        ) : null}
        {action}
      </View>
      {children}
    </View>
  );
}

/** The two boxes of a range, with the mockups' 「→」 between them. */
export function RangeRow({
  left,
  right,
  arrow,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  arrow: string;
}): React.JSX.Element {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
      <View style={{ flex: 1 }}>{left}</View>
      <Text variant="body" tone="muted">
        {arrow}
      </Text>
      <View style={{ flex: 1 }}>{right}</View>
    </View>
  );
}

export function KeywordField({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange(next: string): void;
  id: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <FilterField label={t('transaction:list.filter.keyword_label')}>
      <TextField
        value={value}
        onChangeText={onChange}
        placeholder={t('transaction:list.filter.keyword_placeholder')}
        accessibilityLabel={t('transaction:list.filter.keyword_label')}
        prefix={<Icon name="search" size={18} color={colors['fg.muted']} />}
        testID={id}
      />
    </FilterField>
  );
}

/**
 * The currencies worth offering are the ones the ledger's accounts actually hold (屏幕稿
 * 02 draws CNY / SGD / USD). `currency` is repeatable (decision §14.60), so the pills are a
 * multi-select like the kind pills: none selected means every currency.
 */
export function CurrencyChips(props: FilterFieldProps): React.JSX.Element {
  const { t } = useTranslation();
  const selected = props.filters.currency ?? [];
  function toggle(code: string): void {
    const next = selected.includes(code)
      ? selected.filter((c) => c !== code)
      : [...selected, code];
    props.onPatch({ currency: next.length > 0 ? next : undefined });
  }
  return (
    <FilterField
      label={t('transaction:list.filter.currency_label')}
      hint={t('transaction:list.filter.currency_hint')}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] }}>
        {props.currencyCodes.map((code) => (
          <Chip
            key={code}
            label={code}
            selected={selected.includes(code)}
            onPress={() => toggle(code)}
            testID={`${props.id}-currency-${code}`}
          />
        ))}
      </View>
    </FilterField>
  );
}

export function KindChips(props: FilterFieldProps): React.JSX.Element {
  const { t } = useTranslation();
  const kinds = props.filters.kind ?? [];
  const categoryKind = categoryKindOf(kinds);

  function toggle(kind: TxKind): void {
    const next = kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind];
    // Switching to an income-only filter would leave an expense category behind, which can
    // never match anything (decision §1.3).
    const keepCategory = categoryKindOf(next) === categoryKind;
    props.onPatch({
      kind: next.length > 0 ? next : undefined,
      category_l1: keepCategory ? props.filters.category_l1 : undefined,
      category_l2: keepCategory ? props.filters.category_l2 : undefined,
    });
  }

  return (
    <FilterField
      label={t('transaction:list.table.kind')}
      hint={t('transaction:list.filter.kind_hint')}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] }}>
        {KINDS.map((kind) => (
          <Chip
            key={kind}
            icon={KIND_ICON[kind]}
            label={t(`transaction:kind.${kind}`)}
            selected={kinds.includes(kind)}
            onPress={() => toggle(kind)}
            testID={`${props.id}-kind-${kind}`}
          />
        ))}
      </View>
    </FilterField>
  );
}

/**
 * One of the two cascading category boxes. Level 1 offers the tree the kind filter allows
 * (decision §1.3) and clears level 2 when it changes; level 2 stays disabled until a level
 * 1 is chosen. Neither has a search box (decision §14.57).
 */
export function CategoryField(props: FilterFieldProps & { level: 1 | 2 }): React.JSX.Element {
  const { t } = useTranslation();
  const l1 = props.level === 1;
  const source = l1
    ? (props.index?.kindAllows(categoryKindOf(props.filters.kind)) ?? [])
    : props.filters.category_l1
      ? (props.index?.l2Of(props.filters.category_l1) ?? [])
      : [];
  const options: SelectOption[] = source.map((c) => ({
    value: c.code,
    label: categoryName(c, props.lang),
  }));

  return (
    <FilterField
      label={t(`transaction:list.filter.category_l${props.level}_label`)}
      hint={l1 ? undefined : t('transaction:list.filter.optional_hint')}
    >
      <Select
        placeholder={t(`transaction:list.filter.category_l${props.level}_placeholder`)}
        closeLabel={t('common:button.close')}
        options={options}
        value={(l1 ? props.filters.category_l1 : props.filters.category_l2) ?? null}
        disabled={!l1 && options.length === 0}
        onChange={(next) =>
          props.onPatch(
            l1
              ? { category_l1: next ?? undefined, category_l2: undefined }
              : { category_l2: next ?? undefined },
          )
        }
        testID={`${props.id}-category-l${props.level}`}
      />
    </FilterField>
  );
}

/**
 * The four quick ranges. Next to the 日期区间 label on the wide card they are small accent
 * links (决策 §14.56), so the label row stays one line high and the seven grid cells keep a
 * common baseline; in the drawer 屏幕稿 02 draws them as pills under the boxes.
 */
export function DatePresets(
  props: FilterFieldProps & { compact?: boolean },
): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['3'] }}>
      {DATE_PRESETS.map((preset) => {
        const label = t(`transaction:list.filter.date_preset.${preset}`);
        const onPress = (): void => props.onPatch(dateRangePreset(preset));
        const testID = `${props.id}-date-${preset}`;
        return props.compact === true ? (
          // touch-target-exempt: a text link; hitSlop takes it to 44 without moving the row
          <Pressable
            key={preset}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            hitSlop={{ top: 14, bottom: 14, left: space['2'], right: space['2'] }}
            testID={testID}
          >
            <Text variant="caption" tone="accent" weight={600}>
              {label}
            </Text>
          </Pressable>
        ) : (
          <Chip key={preset} label={label} onPress={onPress} testID={testID} />
        );
      })}
    </View>
  );
}

export function DateRangeField(
  props: FilterFieldProps & { presetsInLabel?: boolean },
): React.JSX.Element {
  const { t } = useTranslation();
  const inLabel = props.presetsInLabel === true;
  return (
    <FilterField
      label={t('transaction:list.filter.date_range_label')}
      action={inLabel ? <DatePresets {...props} compact /> : undefined}
    >
      <RangeRow
        arrow={t('transaction:list.filter.range_arrow')}
        left={
          <DateField
            // 屏幕稿 02 labels the pair once, above both boxes; `DateField` would otherwise
            // fall back to its own 「日期」 and repeat it twice inside one field.
            label=""
            value={props.filters.from ?? ''}
            onChange={(next) => props.onPatch({ from: next === '' ? undefined : next })}
            testID={`${props.id}-from`}
          />
        }
        right={
          <DateField
            label=""
            value={props.filters.to ?? ''}
            onChange={(next) => props.onPatch({ to: next === '' ? undefined : next })}
            testID={`${props.id}-to`}
          />
        }
      />
      {inLabel ? null : <DatePresets {...props} />}
    </FilterField>
  );
}

/**
 * The amount boxes keep a draft: a filter must not be rebuilt (and refetched) on every
 * keystroke, and `12.` is not a number yet. Both ends compare in the ledger's base
 * currency (decision §14.49), which is what the hint next to the label says.
 */
export function AmountRangeField(
  props: FilterFieldProps & { longHint?: boolean },
): React.JSX.Element {
  const { t } = useTranslation();
  const { filters, onPatch } = props;

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

  const commit = (which: 'min_amount' | 'max_amount', raw: string): void => {
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

  const box = (end: 'min' | 'max'): React.JSX.Element => {
    const which = `${end}_amount` as const;
    const draft = end === 'min' ? minDraft : maxDraft;
    return (
      <TextField
        value={draft}
        onChangeText={end === 'min' ? setMinDraft : setMaxDraft}
        onBlur={() => commit(which, draft)}
        onSubmitEditing={() => commit(which, draft)}
        placeholder={t(`transaction:list.filter.amount_${end}_placeholder`)}
        accessibilityLabel={t(`transaction:list.filter.amount_${end}_label`)}
        keyboardType="decimal-pad"
        inputMode="decimal"
        mono
        testID={`${props.id}-${end}-amount`}
      />
    );
  };

  return (
    <FilterField
      label={t('transaction:list.filter.amount_range_label')}
      hint={
        props.longHint === true
          ? undefined
          : t('transaction:list.filter.amount_converted_hint', { currency: props.baseCurrency })
      }
    >
      <RangeRow
        arrow={t('transaction:list.filter.range_arrow')}
        left={box('min')}
        right={box('max')}
      />
      {props.longHint === true ? (
        <Text variant="micro" tone="muted">
          {t('transaction:list.filter.amount_range_hint', { currency: props.baseCurrency })}
        </Text>
      ) : null}
    </FilterField>
  );
}
