/**
 * Account picker (04 §6.4, row height 56): name + type icon + currency + balance.
 *
 * The accounts come from `GET /ledgers/{id}/sources` (decision §14.62): my own, the ones other
 * members shared into this ledger, and any account the ledger's entries still reference. Only
 * the `usable` ones are offered, in two groups — 「我的」 then 「成员共享的」 — and someone
 * else's account shows no balance (the server sends none: balances are the owner's alone).
 *
 * Unusable accounts (archived, or no longer shared) are out, with a single exception — the
 * row being edited may already sit on one, and 04 §4.7 says that entry stays editable, so
 * `allowArchivedId` keeps exactly that one.
 */
import React from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { LedgerSource, Uuid } from '@/api/types';
import { type Lang, useLang } from '@/i18n';
import { formatMoney } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon, SOURCE_TYPE_ICON } from './Icon';
import { Select, type SelectOption } from './Select';
import { Text } from './Text';

export interface SourcePickerProps {
  sources: readonly LedgerSource[];
  value: Uuid | null;
  onChange(next: Uuid | null): void;
  /** Extra restriction, e.g. "credit cards only" for a card repayment (04 §4.6.4). */
  filter?(source: LedgerSource): boolean;
  /** Keeps this unusable (archived / unshared) account selectable (edit mode only). */
  allowArchivedId?: Uuid | null;
  lang?: Lang;
  label?: string;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The accounts a picker may offer, in the order they were given. */
export function selectableSources<T extends LedgerSource>(
  sources: readonly T[],
  filter?: (source: T) => boolean,
  allowArchivedId?: Uuid | null,
): T[] {
  return sources.filter((s) => {
    if (!s.usable && s.id !== allowArchivedId) return false;
    return filter ? filter(s) : true;
  });
}

export type SourceGroupKey = 'mine' | 'shared';

export interface SourceGroup<T> {
  key: SourceGroupKey;
  sources: T[];
}

/**
 * Splits a picker's accounts into 「我的」 and 「成员共享的」, each keeping the order it was
 * given; an empty group is left out.
 */
export function groupSources<T extends LedgerSource>(sources: readonly T[]): SourceGroup<T>[] {
  const mine = sources.filter((s) => s.mine);
  const shared = sources.filter((s) => !s.mine);
  const groups: SourceGroup<T>[] = [];
  if (mine.length > 0) groups.push({ key: 'mine', sources: mine });
  if (shared.length > 0) groups.push({ key: 'shared', sources: shared });
  return groups;
}

/**
 * Whether the group titles are worth drawing: a list of nothing but my own accounts reads
 * exactly as it did before accounts could be shared (屏幕稿 04 / 05 draw no title there).
 */
export function showsSourceGroups(groups: readonly SourceGroup<unknown>[]): boolean {
  return groups.some((g) => g.key === 'shared');
}

/** The small title over one group of a picker's list. */
export function SourceGroupLabel({
  group,
  testID,
}: {
  group: SourceGroupKey;
  testID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Text
      variant="micro"
      tone="muted"
      weight={600}
      style={styles.groupLabel}
      accessibilityRole="header"
      testID={testID}
    >
      {t(`transaction:picker.group_${group}`)}
    </Text>
  );
}

/** Pseudo-option values for the group titles inside `Select` (never a real account id). */
const GROUP_PREFIX = '__group-';

/** More accounts than this and `SourcePicker` shows a search box. */
const SEARCH_THRESHOLD = 8;

/** Whether a `Select` option is one of the group titles `sourceGroupOptions` inserts. */
export function isSourceGroupTitle(option: SelectOption): boolean {
  return option.value.startsWith(GROUP_PREFIX);
}

/**
 * Flattens grouped accounts into `Select` options. `Select` has no notion of sections, so
 * when `titled` each group's title rides along as a disabled pseudo-option ahead of its
 * accounts (it can never be picked); draw it with `renderSourceGroupTitle`.
 */
export function sourceGroupOptions<T extends LedgerSource>(
  groups: readonly SourceGroup<T>[],
  titled: boolean,
  toOption: (source: T) => SelectOption,
  title: (group: SourceGroupKey) => string,
): SelectOption[] {
  return groups.flatMap((g) => [
    ...(titled ? [{ value: `${GROUP_PREFIX}${g.key}`, label: title(g.key), disabled: true }] : []),
    ...g.sources.map(toOption),
  ]);
}

/** A group title pseudo-option's body inside a `Select` list. */
export function renderSourceGroupTitle(option: SelectOption): React.ReactNode {
  return (
    <Text variant="micro" tone="muted" weight={600} accessibilityRole="header">
      {option.label}
    </Text>
  );
}

export function SourcePicker({
  sources,
  value,
  onChange,
  filter,
  allowArchivedId,
  lang,
  label,
  placeholder,
  hint,
  error,
  disabled = false,
  style,
  testID,
}: SourcePickerProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const activeLang = useLang();
  const l = lang ?? activeLang;
  const fieldLabel = label ?? t('transaction:form.source');

  const groups = groupSources(selectableSources(sources, filter, allowArchivedId));
  const accountCount = groups.reduce((n, g) => n + g.sources.length, 0);
  const searchable = accountCount > SEARCH_THRESHOLD;
  // `Select`'s search filters option by option, so a title would either vanish or be left
  // standing over nothing; a searchable list goes untitled.
  const titled = showsSourceGroups(groups) && !searchable;

  const toOption = (s: LedgerSource): SelectOption => {
    const parts = [t(`source:type.${s.type}`), s.default_currency];
    // Someone else's account carries no balance (decision §14.62): say nothing rather than 0.
    if (s.balance !== null) parts.push(formatMoney(s.balance, s.default_currency, l));
    if (s.archived) parts.push(t('common:status.archived'));
    return {
      value: s.id,
      label: s.name,
      hint: parts.join(' · '),
      icon: SOURCE_TYPE_ICON[s.type],
    };
  };

  const options = sourceGroupOptions(groups, titled, toOption, (key) =>
    t(`transaction:picker.group_${key}`),
  );

  // A title is drawn as a caption; every account keeps the icon + two-line body.
  const renderOption = (option: SelectOption): React.ReactNode =>
    isSourceGroupTitle(option) ? (
      renderSourceGroupTitle(option)
    ) : (
      <View style={styles.option}>
        {option.icon ? <Icon name={option.icon} size={18} color={colors['fg.secondary']} /> : null}
        <View style={styles.optionText}>
          <Text variant="body" numberOfLines={1}>
            {option.label}
          </Text>
          {option.hint !== undefined ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {option.hint}
            </Text>
          ) : null}
        </View>
      </View>
    );

  return (
    <Select
      testID={testID ?? 'source'}
      label={fieldLabel}
      placeholder={placeholder ?? fieldLabel}
      closeLabel={t('common:button.close')}
      searchable={searchable}
      searchPlaceholder={fieldLabel}
      emptyLabel={t('common:status.none')}
      options={options}
      renderOption={titled ? renderOption : undefined}
      value={value}
      onChange={onChange}
      hint={hint}
      error={error}
      disabled={disabled}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  groupLabel: { paddingHorizontal: space['3'], paddingTop: space['2'], paddingBottom: space['1'] },
  option: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  optionText: { flex: 1, minWidth: 0 },
});
