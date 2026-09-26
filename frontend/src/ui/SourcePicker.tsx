/**
 * Account picker (04 §6.4, row height 56): name + type icon + currency + balance.
 *
 * Archived accounts are out by default (decision §3: you can't book onto one), with a
 * single exception — the row being edited may already sit on an archived account, and
 * 04 §4.7 says that entry stays editable, so `allowArchivedId` keeps exactly that one.
 */
import React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { FinanceSource, Uuid } from '@/api/types';
import { type Lang, useLang } from '@/i18n';
import { formatMoney } from '@/i18n/format';
import { SOURCE_TYPE_ICON } from './Icon';
import { Select, type SelectOption } from './Select';

export interface SourcePickerProps {
  sources: readonly FinanceSource[];
  value: Uuid | null;
  onChange(next: Uuid | null): void;
  /** Extra restriction, e.g. "credit cards only" for a card repayment (04 §4.6.4). */
  filter?(source: FinanceSource): boolean;
  /** Keeps this archived account selectable (edit mode only). */
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
export function selectableSources(
  sources: readonly FinanceSource[],
  filter?: (source: FinanceSource) => boolean,
  allowArchivedId?: Uuid | null,
): FinanceSource[] {
  return sources.filter((s) => {
    if (s.archived && s.id !== allowArchivedId) return false;
    return filter ? filter(s) : true;
  });
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
  const activeLang = useLang();
  const l = lang ?? activeLang;
  const fieldLabel = label ?? t('transaction:form.source');

  const options: SelectOption[] = selectableSources(sources, filter, allowArchivedId).map((s) => {
    const parts = [
      t(`source:type.${s.type}`),
      s.default_currency,
      formatMoney(s.balance ?? '0', s.default_currency, l),
    ];
    if (s.archived) parts.push(t('common:status.archived'));
    return {
      value: s.id,
      label: s.name,
      hint: parts.join(' · '),
      icon: SOURCE_TYPE_ICON[s.type],
    };
  });

  return (
    <Select
      testID={testID ?? 'source'}
      label={fieldLabel}
      placeholder={placeholder ?? fieldLabel}
      closeLabel={t('common:button.close')}
      searchable={options.length > 8}
      searchPlaceholder={fieldLabel}
      emptyLabel={t('common:status.none')}
      options={options}
      value={value}
      onChange={onChange}
      hint={hint}
      error={error}
      disabled={disabled}
      style={style}
    />
  );
}
